/**
 * POST /api/square-create-subscription
 * body: { slug, planKey, cardNonce, buyerVerificationToken?, email, name }
 *
 * Flow:
 *   1. Authenticated owner must match listing.email
 *   2. Create/reuse Square customer for this email
 *   3. Create card on file using cardNonce (tokenized in browser by Web Payments SDK)
 *   4. Create subscription linked to plan variation
 *   5. Update listing.plan + subscription_id + plan_started_at
 */
const { sb } = require('./db');
const { resolveAuth, audit, getIp, json } = require('./_auth');
const { sq } = require('./_square');

const PLAN_VARIATIONS = {
  PREMIUM: process.env.SQUARE_PLAN_VARIATION_PREMIUM,
  ELITE:   process.env.SQUARE_PLAN_VARIATION_ELITE,
  SPONSOR: process.env.SQUARE_PLAN_VARIATION_SPONSOR
};

const PLAN_NAMES = { PREMIUM: 'premium', ELITE: 'elite', SPONSOR: 'sponsor' };

function uid() { return 'tdd-sub-' + Math.random().toString(36).slice(2, 12) + Date.now(); }

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  const auth = await resolveAuth(event);
  if (auth.reject) return auth.reject;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }

  const slug = String(body.slug || '').trim();
  const planKey = String(body.planKey || '').trim().toUpperCase();
  const cardNonce = String(body.cardNonce || '').trim();
  const buyerVerificationToken = body.buyerVerificationToken ? String(body.buyerVerificationToken) : null;
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim();

  if (!slug || !cardNonce || !email) return json(400, { error: 'slug, cardNonce, email required' });
  if (!PLAN_VARIATIONS[planKey]) return json(400, { error: 'invalid plan' });

  const variationId = PLAN_VARIATIONS[planKey];
  if (!variationId) return json(500, { error: 'plan variation not configured' });

  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!locationId) return json(500, { error: 'SQUARE_LOCATION_ID not configured' });

  const tenantId = auth.tenantId || 'doctordir';

  // Verify listing + ownership
  const { data: listing } = await sb().from('listings')
    .select('id,slug,email,name,plan,square_subscription_id')
    .eq('tenant_id', tenantId).eq('slug', slug).single();
  if (!listing) return json(404, { error: 'listing not found' });
  if (auth.role !== 'super-admin' && auth.role !== 'general-manager' && auth.email !== listing.email) {
    return json(403, { error: 'not your listing' });
  }
  if (listing.square_subscription_id) return json(409, { error: 'already subscribed', subscriptionId: listing.square_subscription_id });

  try {
    // 1. Create or fetch customer
    let customerId;
    const search = await sq('/v2/customers/search', 'POST', {
      query: { filter: { email_address: { exact: email } } },
      limit: 1
    });
    if (search.customers && search.customers.length) {
      customerId = search.customers[0].id;
    } else {
      const parts = name.split(/\s+/);
      const cust = await sq('/v2/customers', 'POST', {
        idempotency_key: uid(),
        given_name: parts[0] || 'Owner',
        family_name: parts.slice(1).join(' ') || '',
        email_address: email
      });
      customerId = cust.customer.id;
    }

    // 2. Create card on file
    const cardRes = await sq('/v2/cards', 'POST', {
      idempotency_key: uid(),
      source_id: cardNonce,
      verification_token: buyerVerificationToken || undefined,
      card: {
        customer_id: customerId,
        cardholder_name: name || email
      }
    });
    const cardId = cardRes.card.id;

    // 3. Create subscription
    const subRes = await sq('/v2/subscriptions', 'POST', {
      idempotency_key: uid(),
      location_id: locationId,
      plan_variation_id: variationId,
      customer_id: customerId,
      card_id: cardId,
      timezone: 'America/New_York'
    });
    const sub = subRes.subscription;

    // 4. Update listing
    const planName = PLAN_NAMES[planKey];
    await sb().from('listings').update({
      plan: planName,
      square_subscription_id: sub.id,
      square_customer_id: customerId,
      subscription_status: sub.status || 'active',
      plan_started_at: new Date().toISOString()
    }).eq('id', listing.id);

    // 5. Log transaction
    await sb().from('square_transactions_cache').insert({
      tenant_id: tenantId, slug,
      square_object_id: sub.id, object_type: 'subscription',
      status: sub.status, raw: sub
    }).then(() => {}).catch(() => {});

    await audit(auth.email, 'subscription.created', 'listing', slug, { plan: planName, subId: sub.id }, getIp(event), tenantId);

    return json(200, { ok: true, subscriptionId: sub.id, plan: planName });
  } catch (e) {
    console.error('Square subscription error:', e.message, e.squareErrors);
    return json(400, { error: e.message || 'subscription failed', details: e.squareErrors });
  }
};
