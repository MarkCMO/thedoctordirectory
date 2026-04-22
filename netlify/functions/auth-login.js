/**
 * POST /api/auth-login {email, password}
 * Creates auth session; returns session cookie.
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const {
  verifyPassword, createSession, sessionCookie, audit, getIp,
  checkRateLimit, recordFailedLogin, clearFailedLogin, json
} = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) return json(400, { error: 'email + password required' });

  const ip = getIp(event);
  const userAgent = event.headers?.['user-agent'] || '';

  // Rate limit check
  const rl = await checkRateLimit(email);
  if (!rl.ok) return json(429, { error: 'too many attempts', locked_until: rl.until });

  // Look up credentials
  const { data: cred } = await sb().from('admin_credentials').select('*').eq('email', email).single();
  if (!cred) {
    // Constant-time-ish: dummy verify to avoid timing enum
    await verifyPassword(password, '$2a$12$0000000000000000000000000000000000000000000000000000');
    await recordFailedLogin(email);
    return json(401, { error: 'invalid credentials' });
  }

  const ok = await verifyPassword(password, cred.password_hash);
  if (!ok) {
    await recordFailedLogin(email);
    return json(401, { error: 'invalid credentials' });
  }

  // Load admin_users
  const { data: user } = await sb().from('admin_users').select('*').eq('email', email).single();
  if (!user || !user.active) return json(403, { error: 'account disabled' });

  await clearFailedLogin(email);

  let tenant = null;
  try { tenant = await resolveTenant(event); } catch {}

  const { token } = await createSession({
    userType: 'admin', userEmail: email, userRole: user.role,
    tenantId: tenant?.id || null, ip, userAgent
  });

  await audit(email, 'login', 'admin_user', email, { role: user.role }, ip, tenant?.id);

  return json(200, {
    ok: true, email, role: user.role, name: user.name || email
  }, { 'Set-Cookie': sessionCookie(token) });
};
