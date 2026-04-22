/**
 * Owner billing info.
 * GET  /api/owner-billing?slug=...   - returns subscription summary + invoices + card on file
 * POST /api/owner-billing            - actions:
 *   { slug, action: 'updateCardLink' }   - returns a Square-hosted card update URL (Customer card-on-file flow)
 */
const { sb } = require('./db');
const { sq } = require('./_square');
const { resolveAuth, json } = require('./_auth');

async function ownerOf(auth, slug) {
  const { data: l } = await sb().from('listings').select('*').eq('slug', slug).single();
  if (!l) return { error: 'listing not found' };
  // Super-admin bypass
  if (auth.permissions?.includes('*')) return { listing: l };
  if (!auth.email) return { error: 'not signed in' };
  if (l.claimed_by_email && l.claimed_by_email.toLowerCase() === auth.email.toLowerCase()) return { listing: l };
  return { error: 'not your listing' };
}

exports.handler = async (event) => {
  const auth = await resolveAuth(event);
  if (auth.reject) return auth.reject;

  const qs = event.queryStringParameters || {};
  let body = {};
  if (event.httpMethod === 'POST') {
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
  }
  const slug = qs.slug || body.slug;
  if (!slug) return json(400, { error: 'slug required' });

  const own = await ownerOf(auth, slug);
  if (own.error) return json(403, { error: own.error });
  const l = own.listing;

  if (event.httpMethod === 'GET') {
    const summary = {
      plan: l.plan,
      subscriptionStatus: l.subscription_status,
      subscriptionId: l.square_subscription_id,
      customerId: l.square_customer_id,
      startedAt: l.plan_started_at
    };

    let invoices = [];
    let card = null;

    // Invoices from Square
    if (l.square_customer_id) {
      try {
        const r = await sq('/v2/invoices/search', 'POST', {
          query: { filter: { customer_ids: [l.square_customer_id] }, sort: { field: 'INVOICE_SORT_DATE', order: 'DESC' } },
          limit: 20
        });
        invoices = (r.invoices || []).map(inv => ({
          id: inv.id,
          number: inv.invoice_number,
          status: inv.status,
          dueDate: inv.due_date,
          amount: inv.next_payment_amount_money?.amount || 0,
          paidAt: inv.payment_requests?.[0]?.completed_at,
          publicUrl: inv.public_url
        }));
      } catch (e) { console.error('invoice fetch:', e.message); }

      // Card on file
      try {
        const r = await sq('/v2/cards?customer_id=' + encodeURIComponent(l.square_customer_id), 'GET');
        const c = (r.cards || []).find(x => !x.disabled);
        if (c) card = { brand: c.card_brand, last4: c.last_4, expMonth: c.exp_month, expYear: c.exp_year };
      } catch (e) { console.error('card fetch:', e.message); }
    }

    return json(200, { summary, invoices, card });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  if (body.action === 'updateCardLink') {
    // Point user back to /upgrade with their current slug/email so they can re-enter card info.
    // Square doesn't expose a hosted card-update page on subscriptions v2 - the re-entry flow
    // is: tokenize new card → CreateCard on customer → UpdateSubscription to use the new card.
    const url = '/update-card?slug=' + encodeURIComponent(slug);
    return json(200, { ok: true, url });
  }

  return json(400, { error: 'unknown action' });
};
