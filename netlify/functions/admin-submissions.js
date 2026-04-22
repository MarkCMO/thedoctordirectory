/**
 * Admin submissions moderation.
 * GET  /api/admin-submissions                   - list pending submissions (doctor-signup applications)
 * POST /api/admin-submissions                   - actions:
 *   { id, action: 'approve', slug? }            - approve + (optionally) create listing from payload
 *   { id, action: 'deny', note? }
 */
const { sb } = require('./db');
const { requirePermission, audit, getIp, json } = require('./_auth');
const { sendEvent } = require('./email-send');

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80);
}

exports.handler = async (event) => {
  const auth = await requirePermission(event, 'submissions.moderate');
  if (auth.reject) return auth.reject;
  const tenantId = auth.tenantId || 'doctordir';

  if (event.httpMethod === 'GET') {
    const status = (event.queryStringParameters?.status) || 'pending';
    const { data } = await sb().from('submissions').select('*').eq('tenant_id', tenantId).eq('status', status).order('created_at', { ascending: false }).limit(200);
    return json(200, { submissions: data || [] });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  let body; try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
  const { id, action } = body;

  const { data: sub } = await sb().from('submissions').select('*').eq('id', id).single();
  if (!sub) return json(404, { error: 'submission not found' });

  if (action === 'approve') {
    const p = sub.payload || {};
    let slug = body.slug || slugify(p.name + ' ' + (p.city || ''));
    if (!slug) return json(400, { error: 'cannot derive slug' });

    // Ensure unique slug
    const { data: existing } = await sb().from('listings').select('slug').eq('tenant_id', tenantId).eq('slug', slug).maybeSingle();
    if (existing) slug = slug + '-' + Math.floor(Math.random() * 9000 + 1000);

    await sb().from('listings').insert({
      tenant_id: tenantId, slug,
      name: p.name, specialty: p.specialty, city: p.city, state: p.state,
      email: p.email, phone: p.phone, website: p.website,
      address: p.address, bio: p.bio, plan: 'free',
      claimed_at: p.email ? new Date().toISOString() : null,
      claimed_by_email: p.email || null,
      source: 'submission'
    });

    await sb().from('submissions').update({
      status: 'approved', actioned_at: new Date().toISOString(), actioned_by: auth.email
    }).eq('id', id);

    if (p.email) {
      try {
        await sendEvent({
          to: p.email, tenantId, event: 'submission.approved',
          subject: 'Your listing is live on The Doctor Directory',
          html: `<p>Great news - your listing has been approved and is now live.</p>
                 <p>View it here: <a href="https://thedoctordirectory.com/doctors/${slug}">thedoctordirectory.com/doctors/${slug}</a></p>
                 <p>Manage your profile: <a href="https://thedoctordirectory.com/my-listing?slug=${encodeURIComponent(slug)}">My Listing</a></p>`
        });
      } catch (e) { console.error('submission approve email:', e.message); }
    }

    await audit(auth.email, 'submission.approved', 'submission', id, { slug }, getIp(event), tenantId);
    return json(200, { ok: true, slug });
  }

  if (action === 'deny') {
    const note = String(body.note || '').slice(0, 500);
    await sb().from('submissions').update({
      status: 'denied', admin_note: note,
      actioned_at: new Date().toISOString(), actioned_by: auth.email
    }).eq('id', id);
    await audit(auth.email, 'submission.denied', 'submission', id, { note }, getIp(event), tenantId);
    return json(200, { ok: true });
  }

  return json(400, { error: 'unknown action' });
};
