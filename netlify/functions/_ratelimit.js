/**
 * Lightweight IP-based rate limit backed by Supabase.
 * Uses doctordirectory.rate_limit_buckets (created inline if missing is NOT safe,
 * so migration 2026-04-24 adds the table).
 *
 * Usage:
 *   const { checkRate } = require('./_ratelimit');
 *   const res = await checkRate({ key: 'submit-review:' + ip, limit: 5, windowMs: 60000 });
 *   if (!res.ok) return json(429, { error: 'rate limit exceeded' });
 */
const { sb } = require('./db');

async function checkRate({ key, limit = 10, windowMs = 60000 }) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs).toISOString();
  try {
    // Count hits in window
    const { count } = await sb().from('rate_limit_buckets')
      .select('*', { count: 'exact', head: true })
      .eq('key', key).gte('created_at', windowStart);
    if ((count || 0) >= limit) return { ok: false, count: count || 0, limit };

    // Insert this hit
    await sb().from('rate_limit_buckets').insert({ key, created_at: now.toISOString() });

    // Opportunistic cleanup (1% of the time) - delete buckets older than 1 day
    if (Math.random() < 0.01) {
      const dayAgo = new Date(Date.now() - 86400000).toISOString();
      await sb().from('rate_limit_buckets').delete().lt('created_at', dayAgo);
    }
    return { ok: true, count: (count || 0) + 1, limit };
  } catch {
    // Fail open: if the limiter fails (e.g. table missing), don't block traffic
    return { ok: true, count: 0, limit, error: true };
  }
}

module.exports = { checkRate };
