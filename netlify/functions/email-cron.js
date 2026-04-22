/**
 * Hourly cron - placeholder for drip campaigns.
 * Logs to system_log so you can see it's running.
 */
const { sb } = require('./db');

exports.handler = async () => {
  const start = Date.now();
  try {
    // TODO: implement drip campaigns (cold outreach, unclaimed_d1, etc.)
    await sb().from('system_log').insert({
      source: 'email-cron', level: 'info', event: 'cron_run',
      message: 'drip runner placeholder', duration_ms: Date.now() - start
    });
    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    return { statusCode: 500, body: String(e.message) };
  }
};
