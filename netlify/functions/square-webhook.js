/**
 * POST /api/square-webhook
 * Receives Square webhook events. Verifies HMAC-SHA256 signature, logs to
 * square_webhook_log, updates listing subscription_status on relevant events.
 *
 * Configure the webhook endpoint in Square Dashboard:
 *   https://thedoctordirectory.com/api/square-webhook
 * Subscribe to: subscription.created, subscription.updated, invoice.payment_made,
 *              invoice.canceled, invoice.failed
 * Copy the "Signature key" to env: SQUARE_WEBHOOK_SIGNATURE_KEY
 */
const crypto = require('crypto');
const { sb } = require('./db');

const SIG_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
const WEBHOOK_URL = process.env.SQUARE_WEBHOOK_URL || 'https://thedoctordirectory.com/api/square-webhook';

function verifySignature(body, signature) {
  if (!SIG_KEY) return false;
  const hmac = crypto.createHmac('sha256', SIG_KEY);
  hmac.update(WEBHOOK_URL + body);
  const expected = hmac.digest('base64');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || '')); }
  catch { return false; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'method not allowed' };

  const rawBody = event.body || '';
  const signature = event.headers?.['x-square-hmacsha256-signature'] || event.headers?.['X-Square-Hmacsha256-Signature'] || '';

  if (SIG_KEY && !verifySignature(rawBody, signature)) {
    console.warn('square-webhook: signature verification failed');
    return { statusCode: 401, body: 'bad signature' };
  }

  let evt;
  try { evt = JSON.parse(rawBody); } catch { return { statusCode: 400, body: 'bad json' }; }

  const type = evt.type || evt.event_type || '';
  const data = evt.data || {};
  const obj = data.object || {};

  // Log every webhook
  try {
    await sb().from('square_webhook_log').insert({
      event_id: evt.event_id || null,
      event_type: type,
      merchant_id: evt.merchant_id || null,
      raw: evt
    });
  } catch (e) { console.error('webhook log failed:', e.message); }

  // Handle subscription events
  const sub = obj.subscription || obj;
  const subId = sub?.id || data.id;

  if (subId && (type.startsWith('subscription.') || type.startsWith('invoice.'))) {
    let newStatus = null;
    if (type === 'subscription.created') newStatus = sub.status || 'active';
    else if (type === 'subscription.updated') newStatus = sub.status;
    else if (type === 'invoice.payment_made') newStatus = 'active';
    else if (type === 'invoice.canceled') newStatus = 'canceled';
    else if (type === 'invoice.failed') newStatus = 'past_due';

    if (newStatus) {
      const update = { subscription_status: newStatus };
      if (newStatus === 'canceled') update.plan = 'free';
      await sb().from('listings').update(update).eq('square_subscription_id', subId);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
