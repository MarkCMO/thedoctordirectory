/**
 * Auth helpers: bcrypt, session cookies, audit log, rate-limit.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sb } = require('./db');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;  // 24h
const ADMIN_KEY = process.env.ADMIN_KEY;

function parseCookies(event) {
  const raw = event.headers?.cookie || event.headers?.Cookie || '';
  const out = {};
  raw.split(/;\s*/).forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1));
  });
  return out;
}

function sessionCookie(token, opts = {}) {
  const parts = [`session=${token}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax'];
  if (!opts.noExpire) {
    parts.push(`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
  } else {
    parts.push('Max-Age=0');
  }
  return parts.join('; ');
}

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function verifyPassword(password, hash) {
  if (!hash) return false;
  try { return await bcrypt.compare(password, hash); } catch { return false; }
}

function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create an auth session row and return token.
 */
async function createSession({ userType, userEmail, userRole, tenantId, ip, userAgent }) {
  const token = genToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await sb().from('auth_sessions').insert({
    token, user_type: userType, user_email: userEmail, user_role: userRole,
    tenant_id: tenantId, expires_at: expiresAt, ip_address: ip, user_agent: userAgent
  });
  return { token, expiresAt };
}

/**
 * Read auth from cookie session, falling back to X-Admin-Key header.
 * Returns { ok, email, role, tenantId, sessionToken } or { reject: {statusCode, body} }.
 */
async function resolveAuth(event) {
  // ADMIN_KEY break-glass
  const adminKeyHeader = event.headers?.['x-admin-key'] || event.headers?.['X-Admin-Key'];
  if (ADMIN_KEY && adminKeyHeader && adminKeyHeader === ADMIN_KEY) {
    return { ok: true, email: 'admin-key@system', role: 'super-admin', tenantId: null, permissions: ['*'] };
  }

  const cookies = parseCookies(event);
  const token = cookies.session;
  if (!token) return { reject: json(401, { error: 'unauthenticated' }) };

  const { data: session } = await sb().from('auth_sessions').select('*').eq('token', token).single();
  if (!session || session.revoked_at || new Date(session.expires_at).getTime() < Date.now()) {
    return { reject: json(401, { error: 'session expired' }) };
  }

  // Look up admin user for permissions + role
  if (session.user_type === 'admin') {
    const { data: u } = await sb().from('admin_users').select('*').eq('email', session.user_email).single();
    if (!u || !u.active) return { reject: json(403, { error: 'admin disabled' }) };
    return {
      ok: true, email: session.user_email, role: u.role, tenantId: session.tenant_id,
      permissions: u.permissions || [], scopedTenantIds: u.scoped_tenant_ids || [],
      sessionToken: token
    };
  }

  return { ok: true, email: session.user_email, role: session.user_role, tenantId: session.tenant_id, sessionToken: token };
}

/**
 * DEFAULT_PERMISSIONS: permissions granted by role automatically.
 */
const DEFAULT_PERMISSIONS = {
  'super-admin': ['*'],
  'general-manager': [
    'listings.view', 'listings.edit', 'listings.delete',
    'outreach.view', 'outreach.edit', 'outreach.assign', 'outreach.viewAll',
    'reps.view', 'reps.edit',
    'payouts.view', 'payouts.edit',
    'reviews.moderate', 'claims.moderate', 'submissions.moderate',
    'subscribers.view', 'subscribers.export',
    'tickets.view', 'tickets.respond'
  ],
  'sales-manager': [
    'listings.view', 'outreach.view', 'outreach.edit',
    'reps.view', 'payouts.view', 'tickets.view', 'tickets.respond'
  ],
  'sales-associate': [
    'listings.view', 'outreach.view', 'outreach.edit'
  ],
  'listing-owner': []
};

function hasPermission(auth, perm) {
  if (!auth?.ok) return false;
  if (auth.permissions?.includes('*')) return true;
  if (auth.permissions?.includes(perm)) return true;
  const defaults = DEFAULT_PERMISSIONS[auth.role] || [];
  return defaults.includes('*') || defaults.includes(perm);
}

async function requirePermission(event, perm) {
  const auth = await resolveAuth(event);
  if (auth.reject) return auth;
  if (!hasPermission(auth, perm)) {
    return { reject: json(403, { error: 'forbidden', required: perm }) };
  }
  return auth;
}

/**
 * Append-only audit log entry.
 */
async function audit(actorEmail, action, targetType, targetId, detail, ip, tenantId) {
  try {
    await sb().from('admin_audit_log').insert({
      actor_email: actorEmail, action, target_type: targetType, target_id: String(targetId || ''),
      detail, ip, tenant_id: tenantId
    });
  } catch (e) { console.error('audit log failed:', e.message); }
}

/**
 * Rate limit check: counts failed_login_count in admin_credentials.
 */
async function checkRateLimit(email) {
  const { data } = await sb().from('admin_credentials').select('failed_login_count,locked_until').eq('email', email).single();
  if (!data) return { ok: true };
  if (data.locked_until && new Date(data.locked_until).getTime() > Date.now()) {
    return { ok: false, until: data.locked_until };
  }
  return { ok: true };
}

async function recordFailedLogin(email) {
  const { data } = await sb().from('admin_credentials').select('failed_login_count').eq('email', email).single();
  const count = (data?.failed_login_count || 0) + 1;
  const lockedUntil = count >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
  await sb().from('admin_credentials').update({
    failed_login_count: count, locked_until: lockedUntil
  }).eq('email', email);
}

async function clearFailedLogin(email) {
  await sb().from('admin_credentials').update({ failed_login_count: 0, locked_until: null }).eq('email', email);
}

/** JSON response helper. */
function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body)
  };
}

/** Extract client IP. */
function getIp(event) {
  return event.headers?.['x-nf-client-connection-ip']
    || event.headers?.['x-forwarded-for']?.split(',')[0].trim()
    || 'unknown';
}

module.exports = {
  parseCookies, sessionCookie, hashPassword, verifyPassword, genToken,
  createSession, resolveAuth, hasPermission, requirePermission,
  audit, checkRateLimit, recordFailedLogin, clearFailedLogin,
  json, getIp, DEFAULT_PERMISSIONS, SESSION_TTL_MS
};
