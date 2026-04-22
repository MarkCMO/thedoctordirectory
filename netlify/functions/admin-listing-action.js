/**
 * POST /api/admin-listing-action
 * body: {slug, action: 'set-plan'|'delete'|'reset-password'|'update-poc'|'update-field', ...}
 */
const crypto = require('crypto');
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { requirePermission, audit, getIp, json } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });
  const auth = await requirePermission(event, 'listings.edit');
  if (auth.reject) return auth.reject;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
  const { slug, action } = body;
  if (!slug || !action) return json(400, { error: 'slug + action required' });

  let tenant;
  try { tenant = await resolveTenant(event); } catch { tenant = { id: 'doctordir' }; }

  const { data: listing } = await sb().from('listings').select('*').eq('tenant_id', tenant.id).eq('slug', slug).single();
  if (!listing) return json(404, { error: 'listing not found' });

  if (action === 'set-plan') {
    const plan = body.plan;
    if (!['free', 'premium', 'elite', 'sponsor'].includes(plan)) return json(400, { error: 'bad plan' });
    const update = { plan };
    if (plan === 'free') { update.subscription_status = null; update.billing_cycle = null; }
    else { update.plan_started_at = listing.plan_started_at || new Date().toISOString(); }
    const { error } = await sb().from('listings').update(update).eq('tenant_id', tenant.id).eq('slug', slug);
    if (error) return json(500, { error: error.message });
    await audit(auth.email, 'listing.set-plan', 'listing', slug, { plan }, getIp(event), tenant.id);
    return json(200, { ok: true });
  }

  if (action === 'delete') {
    const auth2 = await requirePermission(event, 'listings.delete');
    if (auth2.reject) return auth2.reject;
    await sb().from('listings').delete().eq('tenant_id', tenant.id).eq('slug', slug);
    await audit(auth.email, 'listing.delete', 'listing', slug, {}, getIp(event), tenant.id);
    return json(200, { ok: true });
  }

  if (action === 'reset-password') {
    const newToken = crypto.randomUUID();
    await sb().from('listings').update({
      password_hash: null, access_token: newToken
    }).eq('tenant_id', tenant.id).eq('slug', slug);
    await audit(auth.email, 'listing.reset-password', 'listing', slug, {}, getIp(event), tenant.id);
    return json(200, { ok: true, accessToken: newToken });
  }

  if (action === 'update-poc') {
    await sb().from('listings').update({
      poc_name: body.poc_name || null,
      poc_title: body.poc_title || null,
      poc_phone: body.poc_phone || null,
      poc_email: body.poc_email || null,
      poc_best_time: body.poc_best_time || null,
      poc_notes: body.poc_notes || null,
      poc_updated_at: new Date().toISOString(),
      poc_updated_by: auth.email
    }).eq('tenant_id', tenant.id).eq('slug', slug);
    await audit(auth.email, 'listing.update-poc', 'listing', slug, body, getIp(event), tenant.id);
    return json(200, { ok: true });
  }

  if (action === 'update-field') {
    const ALLOWED = ['phone', 'email', 'website', 'bio', 'address1', 'city', 'state', 'zip',
                     'specialty', 'sub_specialty', 'featured', 'will_travel', 'crm_status', 'status'];
    const update = {};
    for (const k of ALLOWED) if (k in body) update[k] = body[k];
    if (!Object.keys(update).length) return json(400, { error: 'no fields' });
    await sb().from('listings').update(update).eq('tenant_id', tenant.id).eq('slug', slug);
    await audit(auth.email, 'listing.update-field', 'listing', slug, update, getIp(event), tenant.id);
    return json(200, { ok: true });
  }

  return json(400, { error: 'unknown action' });
};
