/**
 * Resolves the active tenant from the request Host header.
 * Every handler calls this first; all DB queries scope by tenant.id.
 */
const { sb } = require('./db');

let _cache = null;
let _cacheTs = 0;
const TTL_MS = 60_000;

async function resolveTenant(event) {
  const host = String(
    event.headers?.host || event.headers?.['x-forwarded-host'] || ''
  ).toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');

  const now = Date.now();
  if (!_cache || (now - _cacheTs) > TTL_MS) {
    const { data } = await sb().from('tenants').select('*').eq('active', true);
    _cache = data || [];
    _cacheTs = now;
  }

  // Exact match first, then subdomain match, then localhost fallback
  let tenant = _cache.find(t => t.domain === host);
  if (!tenant) tenant = _cache.find(t => host.endsWith('.' + t.domain));
  if (!tenant && (host === 'localhost' || host === '' || host.endsWith('.netlify.app'))) {
    tenant = _cache.find(t => t.id === 'doctordir') || _cache[0];
  }
  if (!tenant) throw new Error('Unknown tenant for host: ' + host);
  return tenant;
}

module.exports = { resolveTenant };
