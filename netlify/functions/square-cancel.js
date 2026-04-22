/**
 * POST /api/square-cancel
 * body: { slug }
 * Cancels the subscription on Square. Listing downgrades to 'free' at period end
 * via webhook, or immediately if Square returns canceled status.
 */
const { sb } = require('./db');
const { resolveAuth, audit, getIp, json } = require('./_auth');
const { sq } = require('./_square');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  const auth = await resolveAuth(event);
  if (auth.reject) return auth.reject;

  let body; try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
  const slug = String(body.slug || '').trim();
  if (!slug) return json(400, { error: 'slug required' });

  const tenantId = auth.tenantId || 'doctordir';
  const { data: listing } = await sb().from('listings')
    .select('id,email,square_subscription_id').eq('tenant_id', tenantId).eq('slug', slug).single();
  if (!listing) return json(404, { error: 'listing not found' });

  if (auth.role !== 'super-admin' && auth.role !== 'general-manager' && auth.email !== listing.email) {
    return json(403, { error: 'not your listing' });
  }
  if (!listing.square_subscription_id) return json(400, { error: 'no active subscription' });

  try {
    await sq('/v2/subscriptions/' + listing.square_subscription_id + '/cancel', 'POST');
    await sb().from('listings').update({ subscription_status: 'canceled' }).eq('id', listing.id);
    await audit(auth.email, 'subscription.canceled', 'listing', slug, { subId: listing.square_subscription_id }, getIp(event), tenantId);
    return json(200, { ok: true });
  } catch (e) {
    console.error('Square cancel error:', e.message);
    return json(400, { error: e.message });
  }
};
