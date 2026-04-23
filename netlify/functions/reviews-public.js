/**
 * GET /api/reviews-public?slug=...
 * Returns approved reviews for a listing (public).
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { json } = require('./_auth');

exports.handler = async (event) => {
  const slug = (event.queryStringParameters?.slug || '').trim();
  if (!slug) return json(400, { error: 'slug required' });

  let tenant;
  try { tenant = await resolveTenant(event); } catch { tenant = { id: 'doctordir' }; }

  const { data } = await sb().from('reviews')
    .select('reviewer_name,rating,title,body,featured,created_at,verified_patient')
    .eq('tenant_id', tenant.id).eq('slug', slug).eq('status', 'approved')
    .order('featured', { ascending: false }).order('created_at', { ascending: false }).limit(100);

  const reviews = data || [];
  const n = reviews.length;
  const avg = n ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / n) * 10) / 10 : null;

  return json(200, { ok: true, reviews, count: n, avg });
};
