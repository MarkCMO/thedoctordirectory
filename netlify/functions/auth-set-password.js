/**
 * POST /api/auth-set-password
 * Two modes:
 *   (a) {token, email, newPassword}  - via reset link
 *   (b) {currentPassword, newPassword} - via logged-in session
 */
const { sb } = require('./db');
const {
  parseCookies, hashPassword, verifyPassword, audit, getIp, json
} = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }

  const newPassword = String(body.newPassword || '');
  if (newPassword.length < 8) return json(400, { error: 'password must be 8+ chars' });

  const ip = getIp(event);

  // Mode A: reset token
  if (body.token) {
    const email = String(body.email || '').trim().toLowerCase();
    const token = String(body.token);
    const { data: cred } = await sb().from('admin_credentials').select('*').eq('email', email).single();
    if (!cred || cred.reset_token !== token) return json(400, { error: 'invalid token' });
    if (!cred.reset_token_expires || new Date(cred.reset_token_expires).getTime() < Date.now()) {
      return json(400, { error: 'token expired' });
    }
    const hash = await hashPassword(newPassword);
    await sb().from('admin_credentials').update({
      password_hash: hash, reset_token: null, reset_token_expires: null,
      last_password_change: new Date().toISOString(), failed_login_count: 0, locked_until: null
    }).eq('email', email);
    // Revoke all sessions
    await sb().from('auth_sessions').update({
      revoked_at: new Date().toISOString(), revoked_reason: 'password_reset'
    }).eq('user_email', email).is('revoked_at', null);
    await audit(email, 'password_reset_via_token', 'admin_credentials', email, {}, ip, null);
    return json(200, { ok: true, message: 'password updated' });
  }

  // Mode B: logged-in session + current password
  const cookies = parseCookies(event);
  const sessionToken = cookies.session;
  if (!sessionToken) return json(401, { error: 'not logged in' });

  const { data: session } = await sb().from('auth_sessions').select('*').eq('token', sessionToken).single();
  if (!session || session.revoked_at || new Date(session.expires_at).getTime() < Date.now()) {
    return json(401, { error: 'session expired' });
  }

  const currentPassword = String(body.currentPassword || '');
  if (!currentPassword) return json(400, { error: 'currentPassword required' });

  const { data: cred } = await sb().from('admin_credentials').select('*').eq('email', session.user_email).single();
  if (!cred) return json(404, { error: 'no credentials' });
  if (!(await verifyPassword(currentPassword, cred.password_hash))) {
    return json(401, { error: 'wrong current password' });
  }

  const hash = await hashPassword(newPassword);
  await sb().from('admin_credentials').update({
    password_hash: hash, last_password_change: new Date().toISOString()
  }).eq('email', session.user_email);

  // Revoke OTHER sessions, keep current
  await sb().from('auth_sessions').update({
    revoked_at: new Date().toISOString(), revoked_reason: 'password_change'
  }).eq('user_email', session.user_email).neq('token', sessionToken).is('revoked_at', null);

  await audit(session.user_email, 'password_change', 'admin_credentials', session.user_email, {}, ip, session.tenant_id);
  return json(200, { ok: true, message: 'password updated' });
};
