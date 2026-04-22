/**
 * GET /api/rep-dashboard
 * Returns the authenticated rep's queue (outreach rows), recent contacts,
 * weekly stats, tier info, and pending lead requests.
 */
const { sb } = require('./db');
const { requirePermission, json } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'method not allowed' });

  const auth = await requirePermission(event, 'outreach.view');
  if (auth.reject) return auth.reject;

  const email = auth.email;
  const tenantId = auth.tenantId || 'doctordir';

  const { data: rep } = await sb().from('reps').select('*').eq('tenant_id', tenantId).eq('email', email).single();

  // My outreach queue (active - not converted or declined)
  const { data: outreachRows } = await sb().from('outreach')
    .select('id,slug,facility_name,status,first_contacted_at,rep_claimed_at,notes,updated_at')
    .eq('tenant_id', tenantId).eq('rep', email)
    .in('status', ['sent', 'contacted', 'pitched'])
    .order('updated_at', { ascending: true, nullsFirst: true })
    .limit(50);

  // Enrich with listing data
  const slugs = (outreachRows || []).map(o => o.slug);
  let listingsMap = {};
  if (slugs.length) {
    const { data: listings } = await sb().from('listings')
      .select('slug,name,specialty,city,state,phone,email')
      .eq('tenant_id', tenantId).in('slug', slugs);
    for (const l of (listings || [])) listingsMap[l.slug] = l;
  }
  const queue = (outreachRows || []).map(o => ({ ...o, listing: listingsMap[o.slug] || null }));

  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { count: weeklyContacts } = await sb().from('rep_contact_log')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq('rep_email', email).gte('contacted_at', weekAgo);

  const { data: recentContacts } = await sb().from('rep_contact_log')
    .select('*').eq('tenant_id', tenantId).eq('rep_email', email)
    .order('contacted_at', { ascending: false }).limit(20);

  const { data: pendingRequests } = await sb().from('rep_lead_requests')
    .select('*').eq('tenant_id', tenantId).eq('rep_email', email).eq('status', 'pending')
    .order('created_at', { ascending: false });

  const { count: conversions } = await sb().from('outreach')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq('locked_rep', email).eq('status', 'converted');

  return json(200, {
    rep: rep ? {
      name: rep.name, email: rep.email, tier: rep.commission_tier,
      vestedCitySponsors: rep.vested_city_sponsors, quota: rep.daily_lead_quota,
      highestTier: rep.highest_tier_reached, manager: rep.manager_email,
      preferredCategories: rep.preferred_categories
    } : { email, name: email, tier: 30, quota: 25 },
    queue,
    stats: { weeklyContacts: weeklyContacts || 0, conversions: conversions || 0 },
    recentContacts: recentContacts || [],
    pendingRequests: pendingRequests || []
  });
};
