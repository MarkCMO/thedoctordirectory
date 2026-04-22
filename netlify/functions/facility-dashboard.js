/**
 * GET /api/facility-dashboard?slug=X&token=Y
 *   OR POST /api/facility-dashboard {slug, email, password}
 *
 * Returns listing + leads + stats for owner portal.
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { verifyPassword, json } = require('./_auth');

async function authedListing(event, tenant) {
  // Magic link: ?slug=X&token=Y
  if (event.httpMethod === 'GET') {
    const slug = event.queryStringParameters?.slug;
    const token = event.queryStringParameters?.token;
    if (!slug || !token) return { error: 'slug + token required' };
    const { data } = await sb().from('listings').select('*')
      .eq('tenant_id', tenant.id).eq('slug', slug).eq('access_token', token).single();
    if (!data) return { error: 'invalid token' };
    return { listing: data };
  }

  // POST with email+password
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { error: 'bad json' }; }
  const slug = String(body.slug || '');
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!slug || !email || !password) return { error: 'slug + email + password required' };

  const { data: listing } = await sb().from('listings').select('*')
    .eq('tenant_id', tenant.id).eq('slug', slug).single();
  if (!listing) return { error: 'listing not found' };
  if (!listing.password_hash) return { error: 'listing not claimed' };
  if (listing.email?.toLowerCase() !== email && listing.claimed_by?.toLowerCase() !== email) {
    return { error: 'invalid credentials' };
  }
  if (!(await verifyPassword(password, listing.password_hash))) return { error: 'invalid credentials' };
  return { listing };
}

exports.handler = async (event) => {
  let tenant;
  try { tenant = await resolveTenant(event); }
  catch { return json(400, { error: 'unknown tenant' }); }

  const res = await authedListing(event, tenant);
  if (res.error) return json(401, { error: res.error });
  const listing = res.listing;

  // Fetch leads (last 100)
  const { data: leads } = await sb().from('leads').select('*')
    .eq('tenant_id', tenant.id).eq('slug', listing.slug)
    .order('created_at', { ascending: false }).limit(100);

  // Stats
  const now = Date.now();
  const month = 30 * 24 * 60 * 60 * 1000;
  const recentLeads = (leads || []).filter(l => now - new Date(l.created_at).getTime() < month);
  const newLeads = (leads || []).filter(l => l.status === 'new').length;

  return json(200, {
    ok: true,
    listing: {
      slug: listing.slug, name: listing.name, specialty: listing.specialty,
      subSpecialty: listing.sub_specialty, city: listing.city, state: listing.state,
      zip: listing.zip, phone: listing.phone, email: listing.email, website: listing.website,
      bio: listing.bio, photos: listing.photos, socials: listing.socials,
      plan: listing.plan, subscriptionStatus: listing.subscription_status,
      billingCycle: listing.billing_cycle, planStartedAt: listing.plan_started_at,
      accountCreditCents: listing.account_credit_cents,
      rating: listing.rating, reviews: listing.reviews,
      willTravel: listing.will_travel, featured: listing.featured,
      claimedAt: listing.claimed_at, accessToken: listing.access_token
    },
    leads: leads || [],
    stats: {
      totalLeads: (leads || []).length,
      newLeads,
      recentLeads: recentLeads.length,
      conversionRate: leads?.length ? (leads.filter(l => l.status === 'scheduled').length / leads.length * 100).toFixed(1) : 0
    }
  });
};
