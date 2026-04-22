/**
 * Daily 5am UTC cron - reconcile drift.
 * Deletes expired sessions, etc.
 */
const { sb } = require('./db');

exports.handler = async () => {
  const start = Date.now();
  try {
    // Delete sessions that expired or were revoked >30 days ago
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    await sb().from('auth_sessions').delete().or(`expires_at.lt.${thirtyDaysAgo},revoked_at.lt.${thirtyDaysAgo}`);

    // Clean up very old system_log rows
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    await sb().from('system_log').delete().lt('created_at', ninetyDaysAgo);

    await sb().from('system_log').insert({
      source: 'cleanup-cron', level: 'info', event: 'cron_run',
      message: 'cleanup ok', duration_ms: Date.now() - start
    });
    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    await sb().from('system_log').insert({
      source: 'cleanup-cron', level: 'error', event: 'cron_run',
      message: e.message, duration_ms: Date.now() - start
    }).catch(() => {});
    return { statusCode: 500, body: String(e.message) };
  }
};
