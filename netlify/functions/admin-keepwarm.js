/**
 * Scheduled cron (every 5 min) - keeps the function warm.
 */
const { sb } = require('./db');
exports.handler = async () => {
  try {
    await sb().from('tenants').select('id').limit(1);
    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    return { statusCode: 500, body: String(e.message || e) };
  }
};
