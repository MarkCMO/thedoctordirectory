#!/usr/bin/env node
/**
 * Scrapes NPI Registry for doctors and upserts directly to Supabase.
 * Runs from GitHub Actions weekly. Focuses on a single state+specialty
 * per invocation (controlled by STATE + SPECIALTY env vars, or iterates all).
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional:
 *   STATE (2-letter code, default: rotates weekly)
 *   LIMIT (max new doctors per run, default 500)
 */
const https = require('https');
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: 'doctordirectory' }
});

const LIMIT = parseInt(process.env.LIMIT || '500', 10);
const RATE_MS = 400;

// Full state list - one is rotated per weekly run by ISO week number
const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

const SPECIALTIES = [
  'Orthopaedic Surgery', 'Cardiovascular Disease', 'Dermatology', 'Neurology',
  'Urology', 'Gastroenterology', 'Plastic Surgery', 'Ophthalmology',
  'Psychiatry', 'Endocrinology', 'Rheumatology', 'Oncology',
  'Pulmonary Disease', 'Nephrology', 'Pain Medicine', 'Sports Medicine',
  'Emergency Medicine', 'Family Medicine', 'Internal Medicine', 'Pediatrics'
];

function pickState() {
  if (process.env.STATE) return process.env.STATE.toUpperCase();
  // Rotate by ISO week so each week hits different states
  const now = new Date();
  const onejan = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil((((now - onejan) / 86400000) + onejan.getDay() + 1) / 7);
  return STATES[week % STATES.length];
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'TheDoctorDirectory-Scraper/1.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('bad json')); }
      });
    }).on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function slugify(name, npi) {
  const base = 'dr-' + String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const suffix = String(npi || '').slice(-4);
  return base + '-' + suffix;
}

function mapToRow(p) {
  if (!p?.basic || !p?.number) return null;
  const b = p.basic;
  const addr = (p.addresses || []).find(a => a.address_purpose === 'LOCATION') || p.addresses?.[0] || {};
  const taxonomy = (p.taxonomies || []).find(t => t.primary) || p.taxonomies?.[0] || {};
  const first = (b.first_name || '').trim();
  const last = (b.last_name || '').trim();
  if (!first || !last || !addr.state) return null;
  const fullName = `Dr. ${first} ${last}${b.credential ? ', ' + b.credential : ''}`;
  return {
    tenant_id: 'doctordir',
    slug: slugify(first + ' ' + last, p.number),
    npi: String(p.number),
    name: fullName,
    first_name: first,
    last_name: last,
    credential: b.credential || null,
    gender: b.gender || null,
    specialty: taxonomy.desc || 'General Practice',
    sub_specialty: null,
    conditions: [],
    city: (addr.city || '').trim(),
    state: addr.state,
    state_code: addr.state,
    county: null,
    bio: null,
    years_exp: null, rating: null, peer_rating: null,
    reviews: 0, publications: 0, patents: 0, surgeries: 0,
    board_certs: [], awards: [], hospitals: [],
    will_travel: false, featured: false, backlinks: {},
    plan: 'free', status: 'active', crm_status: 'cold',
    source: 'npi_registry', scraped_at: new Date().toISOString()
  };
}

async function main() {
  const state = pickState();
  console.log(`[scraper] State: ${state}, limit: ${LIMIT}`);

  // Find already-scraped NPIs for this state to skip
  const { data: existing } = await sb.from('listings')
    .select('npi').eq('tenant_id', 'doctordir').eq('state_code', state).not('npi', 'is', null);
  const existingNpis = new Set((existing || []).map(r => r.npi));
  console.log(`[scraper] ${existingNpis.size} existing NPIs in ${state}`);

  const newRows = [];
  let spIdx = 0;

  while (newRows.length < LIMIT && spIdx < SPECIALTIES.length) {
    const sp = SPECIALTIES[spIdx++];
    // NPI API: 200 results/page max, skip=0..n
    for (let skip = 0; skip < 1200 && newRows.length < LIMIT; skip += 200) {
      const url = `https://npiregistry.cms.hhs.gov/api/?version=2.1&state=${state}&taxonomy_description=${encodeURIComponent(sp)}&limit=200&skip=${skip}`;
      let resp;
      try { resp = await httpGet(url); }
      catch (e) { console.error(`[scraper] fetch error ${state}/${sp}@${skip}:`, e.message); break; }
      const results = resp.results || [];
      if (results.length === 0) break;
      for (const p of results) {
        if (existingNpis.has(String(p.number))) continue;
        const row = mapToRow(p);
        if (row) { newRows.push(row); existingNpis.add(row.npi); }
        if (newRows.length >= LIMIT) break;
      }
      console.log(`[scraper] ${state}/${sp} skip=${skip} -> ${results.length} fetched, ${newRows.length} new total`);
      await sleep(RATE_MS);
    }
  }

  if (newRows.length === 0) {
    console.log('[scraper] No new doctors to add');
    return;
  }

  console.log(`[scraper] Upserting ${newRows.length} new rows...`);
  // Dedupe by slug (in case two NPIs happen to collide on slug)
  const bySlug = new Map();
  for (const r of newRows) bySlug.set(r.slug, r);
  const uniq = Array.from(bySlug.values());

  const BATCH = 200;
  let added = 0;
  for (let i = 0; i < uniq.length; i += BATCH) {
    const slice = uniq.slice(i, i + BATCH);
    const { error } = await sb.from('listings').upsert(slice, { onConflict: 'tenant_id,slug', ignoreDuplicates: true });
    if (error) console.error(`[scraper] batch ${i} error:`, error.message);
    else added += slice.length;
  }

  console.log(`[scraper] Done. Added ${added}/${uniq.length} new doctors for ${state}.`);

  // Record in scrape_queue
  await sb.from('scrape_queue').insert({
    tenant_id: 'doctordir',
    source: 'npi_registry',
    state: state,
    status: 'completed',
    results_count: added,
    completed_at: new Date().toISOString()
  }).then(() => {}).catch(() => {});
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
