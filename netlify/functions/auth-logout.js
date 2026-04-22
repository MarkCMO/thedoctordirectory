/**
 * POST /api/auth-logout
 * Revokes current session.
 */
const { sb } = require('./db');
const { parseCookies, sessionCookie, audit, getIp, json } = require('./_auth');

exports.handler = async (event) => {
  const cookies = parseCookies(event);
  const token = cookies.session;
  if (token) {
    const { data: s } = await sb().from('auth_sessions').select('user_email').eq('token', token).single();
    await sb().from('auth_sessions').update({
      revoked_at: new Date().toISOString(), revoked_reason: 'user_logout'
    }).eq('token', token);
    if (s?.user_email) await audit(s.user_email, 'logout', 'session', token.slice(0, 8), {}, getIp(event), null);
  }
  return json(200, { ok: true }, { 'Set-Cookie': sessionCookie('', { noExpire: true }) });
};
