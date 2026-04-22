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
const { sendEvent } = require('./email-send');

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

    // Email owner on payment events
    try {
      const { data: listing } = await sb().from('listings').select('slug,name,plan,claimed_by_email,tenant_id').eq('square_subscription_id', subId).maybeSingle();
      if (listing?.claimed_by_email) {
        const first = (listing.name || '').split(/\s+/)[0] || 'there';
        const billingUrl = `https://thedoctordirectory.com/billing?slug=${encodeURIComponent(listing.slug)}`;

        if (type === 'invoice.payment_made') {
          const invoice = obj.invoice || {};
          const amount = invoice.payment_requests?.[0]?.computed_amount_money?.amount || invoice.next_payment_amount_money?.amount;
          const amountStr = amount ? '$' + (amount / 100).toFixed(2) : '';
          await sendEvent({
            to: listing.claimed_by_email, tenantId: listing.tenant_id, event: 'billing.payment_made',
            subject: `Payment received | The Doctor Directory`,
            html: `<p>Hi ${first},</p>
                   <p>Your payment ${amountStr ? 'of <strong>' + amountStr + '</strong> ' : ''}has been processed successfully. Your ${listing.plan.toUpperCase()} listing is active.</p>
                   ${invoice.public_url ? `<p><a href="${invoice.public_url}">View invoice</a></p>` : ''}
                   <p><a href="${billingUrl}">Manage billing</a></p>`
          });
        } else if (type === 'invoice.failed') {
          await sendEvent({
            to: listing.claimed_by_email, tenantId: listing.tenant_id, event: 'billing.payment_failed',
            subject: `Payment failed - action required | The Doctor Directory`,
            html: `<p>Hi ${first},</p>
                   <p>We weren't able to process your last payment. Your listing will remain active for a short grace period while we retry.</p>
                   <p>Please update your card to avoid interruption: <a href="${billingUrl}">Update payment method</a></p>`
          });
        } else if (type === 'invoice.canceled' || type === 'subscription.updated' && newStatus === 'canceled') {
          await sendEvent({
            to: listing.claimed_by_email, tenantId: listing.tenant_id, event: 'billing.subscription_canceled',
            subject: `Your subscription has been canceled | The Doctor Directory`,
            html: `<p>Hi ${first},</p>
                   <p>Your subscription has been canceled. Your listing has reverted to the free plan.</p>
                   <p>You can resubscribe any time at <a href="https://thedoctordirectory.com/upgrade?slug=${encodeURIComponent(listing.slug)}">Upgrade</a>.</p>`
          });
        }
      }
    } catch (e) { console.error('owner billing email:', e.message); }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
