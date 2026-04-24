/**
 * GET  /api/referral?code=...                  - resolve code (click tracking + redirect info)
 * GET  /api/referral?mine=1&slug=...&token=... - owner: get or create their code + stats
 * POST /api/referral {action:'track-click'|'track-signup'|'track-conversion', code, ...}
 */
const crypto = require('crypto');
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { getIp, json } = require('./_auth');

function genCode(slug) {
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  const stem = String(slug || 'DOC').replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase();
  return `${stem}${rand}`;
}

async function getOrCreateForOwner(tenantId, slug) {
  const { data: listing } = await sb().from('listings').select('slug,email,claimed_by_email,access_token')
    .eq('tenant_id', tenantId).eq('slug', slug).single();
  if (!listing) return null;

  let { data: code } = await sb().from('referral_codes').select('*')
    .eq('tenant_id', tenantId).eq('owner_slug', slug).single();
  if (code) return { listing, code };

  const newCode = genCode(slug);
  const ownerEmail = listing.claimed_by_email || listing.email || '';
  const { data: created } = await sb().from('referral_codes').insert({
    code: newCode, tenant_id: tenantId, owner_slug: slug, owner_email: ownerEmail
  }).select().single();
  return { listing, code: created };
}

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  let tenant;
  try { tenant = await resolveTenant(event); } catch { tenant = { id: 'doctordir' }; }

  if (event.httpMethod === 'GET' && qs.mine === '1') {
    if (!qs.slug || !qs.token) return json(400, { error: 'slug + token required' });
    const { data: listing } = await sb().from('listings').select('slug,access_token')
      .eq('tenant_id', tenant.id).eq('slug', qs.slug).eq('access_token', qs.token).single();
    if (!listing) return json(401, { error: 'invalid token' });
    const res = await getOrCreateForOwner(tenant.id, qs.slug);
    if (!res) return json(404, { error: 'not found' });
    const { data: events } = await sb().from('referral_events').select('event_type,plan,credit_cents,created_at')
      .eq('code', res.code.code).order('created_at', { ascending: false }).limit(100);
    return json(200, { ok: true, code: res.code, events: events || [] });
  }

  if (event.httpMethod === 'GET' && qs.code) {
    const code = String(qs.code).toUpperCase();
    const { data: row } = await sb().from('referral_codes').select('code,owner_slug,tenant_id').eq('code', code).single();
    if (!row) return json(404, { error: 'invalid code' });
    // increment clicks + log event
    await sb().from('referral_codes').update({ clicks: (row.clicks || 0) + 1 }).eq('code', code);
    await sb().from('referral_events').insert({
      tenant_id: row.tenant_id, code, event_type: 'click',
      ip_address: getIp(event), user_agent: event.headers?.['user-agent'] || null
    });
    return json(200, { ok: true, code, referrer_slug: row.owner_slug });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
    const { action, code, referred_slug, referred_email, plan, credit_cents } = body;
    if (!code || !action) return json(400, { error: 'code + action required' });
    const { data: row } = await sb().from('referral_codes').select('*').eq('code', code).single();
    if (!row) return json(404, { error: 'invalid code' });

    const evt = {
      tenant_id: row.tenant_id, code, event_type: action.replace(/^track-/, ''),
      referred_slug: referred_slug || null, referred_email: referred_email || null,
      plan: plan || null, credit_cents: credit_cents || 0,
      ip_address: getIp(event), user_agent: event.headers?.['user-agent'] || null
    };
    await sb().from('referral_events').insert(evt);

    const update = {};
    if (action === 'track-signup') update.signups = (row.signups || 0) + 1;
    else if (action === 'track-conversion') {
      update.conversions = (row.conversions || 0) + 1;
      update.credit_earned_cents = (row.credit_earned_cents || 0) + (credit_cents || 0);
      // Apply credit to owner's listing
      if (credit_cents && row.owner_slug) {
        const { data: owner } = await sb().from('listings').select('account_credit_cents')
          .eq('tenant_id', row.tenant_id).eq('slug', row.owner_slug).single();
        await sb().from('listings').update({
          account_credit_cents: (owner?.account_credit_cents || 0) + credit_cents
        }).eq('tenant_id', row.tenant_id).eq('slug', row.owner_slug);
      }
    }
    if (Object.keys(update).length) await sb().from('referral_codes').update(update).eq('code', code);
    return json(200, { ok: true });
  }

  return json(405, { error: 'method not allowed' });
};
