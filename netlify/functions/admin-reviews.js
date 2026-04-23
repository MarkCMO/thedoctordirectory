/**
 * GET  /api/admin-reviews?status=pending|approved|rejected|flagged
 * POST /api/admin-reviews {id, action: 'approve'|'reject'|'flag'|'feature'|'unfeature'|'delete', note?}
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { requirePermission, audit, getIp, json } = require('./_auth');
const { sendEvent } = require('./email-send');

async function recomputeListingRating(tenantId, slug) {
  const { data: approved } = await sb().from('reviews').select('rating')
    .eq('tenant_id', tenantId).eq('slug', slug).eq('status', 'approved');
  const n = (approved || []).length;
  const avg = n ? (approved.reduce((s, r) => s + r.rating, 0) / n) : null;
  await sb().from('listings').update({
    rating: avg ? Math.round(avg * 10) / 10 : null,
    reviews: n
  }).eq('tenant_id', tenantId).eq('slug', slug);
}

exports.handler = async (event) => {
  const auth = await requirePermission(event, 'listings.edit');
  if (auth.reject) return auth.reject;

  let tenant;
  try { tenant = await resolveTenant(event); } catch { tenant = { id: 'doctordir' }; }

  if (event.httpMethod === 'GET') {
    const status = event.queryStringParameters?.status || 'pending';
    const slug = event.queryStringParameters?.slug || null;
    let q = sb().from('reviews').select('*').eq('tenant_id', tenant.id);
    if (status !== 'all') q = q.eq('status', status);
    if (slug) q = q.eq('slug', slug);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(300);
    if (error) return json(500, { error: error.message });
    const counts = {};
    for (const s of ['pending', 'approved', 'rejected', 'flagged']) {
      const { count } = await sb().from('reviews').select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id).eq('status', s);
      counts[s] = count || 0;
    }
    return json(200, { ok: true, reviews: data || [], counts });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
    const { id, action, note } = body;
    if (!id || !action) return json(400, { error: 'id + action required' });

    const { data: review } = await sb().from('reviews').select('*')
      .eq('id', id).eq('tenant_id', tenant.id).single();
    if (!review) return json(404, { error: 'not found' });

    const nowIso = new Date().toISOString();
    const baseUpdate = { moderated_by: auth.email, moderated_at: nowIso, admin_note: note || null };

    if (action === 'approve') {
      await sb().from('reviews').update({ ...baseUpdate, status: 'approved' }).eq('id', id);
      await recomputeListingRating(tenant.id, review.slug);
      if (review.reviewer_email) {
        try {
          await sendEvent({
            to: review.reviewer_email, tenantId: tenant.id, event: 'review.approved',
            subject: `Your review is live | ${tenant.brand_name}`,
            html: `<p>Thanks for sharing your experience. Your ${review.rating}-star review has been published.</p>`
          });
        } catch {}
      }
    } else if (action === 'reject') {
      await sb().from('reviews').update({ ...baseUpdate, status: 'rejected' }).eq('id', id);
    } else if (action === 'flag') {
      await sb().from('reviews').update({ ...baseUpdate, status: 'flagged' }).eq('id', id);
    } else if (action === 'feature') {
      await sb().from('reviews').update({ ...baseUpdate, featured: true, status: 'approved' }).eq('id', id);
      await recomputeListingRating(tenant.id, review.slug);
    } else if (action === 'unfeature') {
      await sb().from('reviews').update({ ...baseUpdate, featured: false }).eq('id', id);
    } else if (action === 'delete') {
      await sb().from('reviews').delete().eq('id', id);
      if (review.status === 'approved') await recomputeListingRating(tenant.id, review.slug);
    } else {
      return json(400, { error: 'unknown action' });
    }

    await audit(auth.email, 'review.' + action, 'review', id, { slug: review.slug, note }, getIp(event), tenant.id);
    return json(200, { ok: true });
  }

  return json(405, { error: 'method not allowed' });
};
