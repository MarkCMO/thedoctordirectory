/**
 * GET /api/admin-listings?q=&state=&city=&plan=&claimed=&page=&limit=
 * Returns paginated listings for admin table.
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { requirePermission, json } = require('./_auth');

exports.handler = async (event) => {
  const auth = await requirePermission(event, 'listings.view');
  if (auth.reject) return auth.reject;

  let tenant;
  try { tenant = await resolveTenant(event); } catch { tenant = { id: 'doctordir' }; }

  const qp = event.queryStringParameters || {};
  const q = String(qp.q || '').trim();
  const state = qp.state;
  const city = qp.city;
  const plan = qp.plan;
  const claimed = qp.claimed;
  const specialty = qp.specialty;
  const page = Math.max(1, parseInt(qp.page || '1'));
  const limit = Math.min(200, Math.max(10, parseInt(qp.limit || '50')));
  const offset = (page - 1) * limit;

  let query = sb().from('listings').select(
    'slug,name,specialty,sub_specialty,city,state,zip,phone,email,plan,status,rating,reviews,claimed_at,crm_status,poc_name,poc_phone,poc_email,last_contact_at',
    { count: 'exact' }
  ).eq('tenant_id', tenant.id);

  if (q) query = query.or(`name.ilike.%${q}%,slug.ilike.%${q}%,city.ilike.%${q}%,email.ilike.%${q}%`);
  if (state) query = query.eq('state', state);
  if (city) query = query.ilike('city', city);
  if (plan) query = query.eq('plan', plan);
  if (specialty) query = query.eq('specialty', specialty);
  if (claimed === 'yes') query = query.not('claimed_at', 'is', null);
  if (claimed === 'no') query = query.is('claimed_at', null);

  const { data, count, error } = await query.order('updated_at', { ascending: false }).range(offset, offset + limit - 1);
  if (error) return json(500, { error: error.message });

  return json(200, {
    ok: true, listings: data || [], total: count || 0, page, limit,
    totalPages: count ? Math.ceil(count / limit) : 0
  });
};
