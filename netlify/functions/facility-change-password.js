/**
 * POST /api/facility-change-password
 * Owner changes their listing password.
 * body: {slug, accessToken, currentPassword, newPassword}
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { hashPassword, verifyPassword, audit, getIp, json } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }

  const slug = String(body.slug || '');
  const accessToken = String(body.accessToken || '');
  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');
  if (!slug || !accessToken) return json(400, { error: 'slug + accessToken required' });
  if (newPassword.length < 8) return json(400, { error: 'password must be 8+ chars' });
  if (!currentPassword) return json(400, { error: 'currentPassword required' });

  let tenant;
  try { tenant = await resolveTenant(event); }
  catch { return json(400, { error: 'unknown tenant' }); }

  const { data: listing } = await sb().from('listings').select('*')
    .eq('tenant_id', tenant.id).eq('slug', slug).eq('access_token', accessToken).single();
  if (!listing) return json(401, { error: 'invalid token' });
  if (!listing.password_hash) return json(400, { error: 'listing not claimed' });

  if (!(await verifyPassword(currentPassword, listing.password_hash))) {
    return json(401, { error: 'wrong current password' });
  }

  const hash = await hashPassword(newPassword);
  const { error } = await sb().from('listings').update({
    password_hash: hash, last_password_change: new Date().toISOString()
  }).eq('tenant_id', tenant.id).eq('slug', slug);

  if (error) return json(500, { error: error.message });

  await audit(listing.claimed_by_email || listing.email, 'owner.password_change', 'listing', slug, {}, getIp(event), tenant.id);
  return json(200, { ok: true, message: 'password updated' });
};
