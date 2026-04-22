/**
 * POST /api/square-update-card
 * body: { slug, cardNonce, buyerVerificationToken?, cardholder? }
 * Creates a new card on the listing's customer and swaps the subscription's payment source.
 */
const { sb } = require('./db');
const { sq } = require('./_square');
const { resolveAuth, json, audit, getIp } = require('./_auth');
const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });
  const auth = await resolveAuth(event);
  if (auth.reject) return auth.reject;

  let body; try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
  const { slug, cardNonce, buyerVerificationToken, cardholder } = body;
  if (!slug || !cardNonce) return json(400, { error: 'slug and cardNonce required' });

  const { data: l } = await sb().from('listings').select('*').eq('slug', slug).single();
  if (!l) return json(404, { error: 'listing not found' });

  const isAdmin = auth.permissions?.includes('*');
  if (!isAdmin && (!auth.email || (l.claimed_by_email || '').toLowerCase() !== auth.email.toLowerCase())) {
    return json(403, { error: 'not your listing' });
  }
  if (!l.square_customer_id || !l.square_subscription_id) return json(400, { error: 'no active subscription on this listing' });

  // Create new card on customer
  let newCardId;
  try {
    const cardResp = await sq('/v2/cards', 'POST', {
      idempotency_key: crypto.randomUUID(),
      source_id: cardNonce,
      verification_token: buyerVerificationToken,
      card: {
        customer_id: l.square_customer_id,
        cardholder_name: cardholder || l.claimed_by_email || ''
      }
    });
    newCardId = cardResp.card?.id;
    if (!newCardId) throw new Error('Card creation returned no id');
  } catch (e) {
    return json(400, { error: 'Card create failed: ' + e.message });
  }

  // Update subscription to new card
  try {
    await sq('/v2/subscriptions/' + encodeURIComponent(l.square_subscription_id), 'PUT', {
      subscription: { card_id: newCardId }
    });
  } catch (e) {
    return json(400, { error: 'Subscription update failed: ' + e.message });
  }

  await audit(auth.email || 'system', 'billing.card-updated', 'listing', slug, { cardId: newCardId }, getIp(event), l.tenant_id);
  return json(200, { ok: true });
};
