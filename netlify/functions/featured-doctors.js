/**
 * GET  /api/featured-doctors?limit=6       - public: curated featured doctors
 * POST /api/featured-doctors {slug, featured: true|false}  - admin toggle
 *   Uses listings.featured boolean; returns top-N sorted by plan tier.
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { requirePermission, audit, getIp, json } = require('./_auth');

const PLAN_WEIGHT = { sponsor: 4, elite: 3, premium: 2, free: 1 };

exports.handler = async (event) => {
  let tenant;
  try { tenant = await resolveTenant(event); } catch { tenant = { id: 'doctordir' }; }

  if (event.httpMethod === 'GET') {
    const limit = Math.min(24, parseInt(event.queryStringParameters?.limit, 10) || 6);
    const { data } = await sb().from('listings')
      .select('slug,name,specialty,city,state,rating,reviews,plan,photos,bio')
      .eq('tenant_id', tenant.id).eq('status', 'active').eq('featured', true).limit(50);
    const sorted = (data || []).map(l => ({ ...l, _w: PLAN_WEIGHT[l.plan] || 0 }))
      .sort((a, b) => b._w - a._w || (b.rating || 0) - (a.rating || 0))
      .slice(0, limit).map(({ _w, ...r }) => r);
    return json(200, { ok: true, featured: sorted });
  }

  if (event.httpMethod === 'POST') {
    const auth = await requirePermission(event, 'listings.edit');
    if (auth.reject) return auth.reject;
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
    const slug = String(body.slug || '');
    const featured = !!body.featured;
    if (!slug) return json(400, { error: 'slug required' });
    const { error } = await sb().from('listings').update({ featured })
      .eq('tenant_id', tenant.id).eq('slug', slug);
    if (error) return json(500, { error: error.message });
    await audit(auth.email, featured ? 'listing.featured' : 'listing.unfeatured', 'listing', slug, {}, getIp(event), tenant.id);
    return json(200, { ok: true });
  }

  return json(405, { error: 'method not allowed' });
};
