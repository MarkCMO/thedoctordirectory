/**
 * GET /api/search?q=&state=&specialty=&condition=&city=&plan=&limit=&offset=
 * Public doctor search. Returns paginated results sorted by plan weight + rating.
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { json } = require('./_auth');

const PLAN_WEIGHT = { sponsor: 400, elite: 300, premium: 200, free: 100 };

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const q = String(qs.q || '').trim();
  const state = String(qs.state || '').trim();
  const specialty = String(qs.specialty || '').trim();
  const condition = String(qs.condition || '').trim();
  const city = String(qs.city || '').trim();
  const plan = String(qs.plan || '').trim();
  const limit = Math.min(50, parseInt(qs.limit, 10) || 20);
  const offset = Math.max(0, parseInt(qs.offset, 10) || 0);

  let tenant;
  try { tenant = await resolveTenant(event); } catch { tenant = { id: 'doctordir' }; }

  let query = sb().from('listings')
    .select('slug,name,specialty,sub_specialty,city,state,conditions,plan,featured,rating,reviews,bio,photos,years_exp,will_travel,subscription_status', { count: 'exact' })
    .eq('tenant_id', tenant.id).eq('status', 'active');

  if (state) query = query.or(`state.ilike.${state},state_code.ilike.${state}`);
  if (city) query = query.ilike('city', city);
  if (specialty) query = query.ilike('specialty', '%' + specialty + '%');
  if (plan) query = query.eq('plan', plan);
  if (q) query = query.or(`name.ilike.%${q}%,city.ilike.%${q}%,specialty.ilike.%${q}%`);
  if (condition) query = query.contains('conditions', [condition]);

  // Pull a larger page then re-sort client-side so we can mix featured/plan/rating
  const hardLimit = Math.min(500, limit * 5 + offset);
  const { data, count, error } = await query.order('featured', { ascending: false }).limit(hardLimit);
  if (error) return json(500, { error: error.message });

  const scored = (data || []).map(l => {
    const planWeight = PLAN_WEIGHT[l.plan] || 0;
    const featuredBoost = l.featured ? 50 : 0;
    const ratingBoost = (l.rating || 0) * 3;
    const reviewBoost = Math.min((l.reviews || 0) * 0.1, 20);
    return { ...l, _score: planWeight + featuredBoost + ratingBoost + reviewBoost };
  }).sort((a, b) => b._score - a._score);

  const page = scored.slice(offset, offset + limit).map(({ _score, ...r }) => r);

  return json(200, { ok: true, results: page, total: count ?? scored.length, offset, limit });
};
