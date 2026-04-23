/**
 * POST /api/submit-review
 * Public endpoint for patients to submit a review. Always lands in 'pending' status.
 * body: {slug, reviewer_name, reviewer_email, rating, title, body}
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { getIp, json } = require('./_auth');
const { sendEvent } = require('./email-send');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }

  const slug = String(body.slug || '').trim();
  const reviewer_name = String(body.reviewer_name || '').trim();
  const reviewer_email = String(body.reviewer_email || '').trim().toLowerCase() || null;
  const rating = parseInt(body.rating, 10);
  const title = String(body.title || '').trim().slice(0, 200) || null;
  const reviewBody = String(body.body || '').trim().slice(0, 4000) || null;

  if (!slug) return json(400, { error: 'slug required' });
  if (!reviewer_name) return json(400, { error: 'reviewer_name required' });
  if (!(rating >= 1 && rating <= 5)) return json(400, { error: 'rating must be 1-5' });

  let tenant;
  try { tenant = await resolveTenant(event); }
  catch { return json(400, { error: 'unknown tenant' }); }

  // Confirm listing exists
  const { data: listing } = await sb().from('listings').select('slug,name,email,claimed_by_email')
    .eq('tenant_id', tenant.id).eq('slug', slug).single();
  if (!listing) return json(404, { error: 'listing not found' });

  const ip = getIp(event);
  const ua = event.headers?.['user-agent'] || null;

  // Basic dupe guard: same IP + slug within 5 min
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: recent } = await sb().from('reviews').select('id')
    .eq('tenant_id', tenant.id).eq('slug', slug).eq('ip_address', ip)
    .gte('created_at', fiveMinAgo).limit(1);
  if (recent && recent.length) return json(429, { error: 'please wait before submitting another review' });

  const { data: row, error } = await sb().from('reviews').insert({
    tenant_id: tenant.id, slug, reviewer_name, reviewer_email, rating,
    title, body: reviewBody, ip_address: ip, user_agent: ua, status: 'pending'
  }).select().single();
  if (error) return json(500, { error: error.message });

  // Notify admin
  try {
    await sendEvent({
      to: tenant.admin_email, tenantId: tenant.id,
      event: 'admin.review-pending',
      subject: `[${tenant.brand_name}] New review pending for ${listing.name}`,
      html: `<p>New ${rating}-star review pending moderation.</p>
             <p><strong>Doctor:</strong> ${listing.name}<br>
                <strong>Reviewer:</strong> ${reviewer_name}${reviewer_email ? ` &lt;${reviewer_email}&gt;` : ''}</p>
             ${title ? `<p><strong>${title}</strong></p>` : ''}
             ${reviewBody ? `<blockquote>${reviewBody.replace(/</g, '&lt;')}</blockquote>` : ''}
             <p><a href="https://${tenant.domain}/admin#reviews">Moderate in admin</a></p>`
    });
  } catch (e) { console.error('review notify failed:', e.message); }

  return json(200, { ok: true, id: row.id, status: 'pending_moderation' });
};
