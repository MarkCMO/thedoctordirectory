/**
 * POST /api/rep-log-contact
 * body: { slug, channel, notes?, newStatus? }
 * Logs a contact attempt, updates outreach row status + timestamps.
 */
const { sb } = require('./db');
const { requirePermission, audit, getIp, json } = require('./_auth');

const VALID_CHANNELS = ['call', 'email', 'sms', 'voicemail', 'contact-update'];
const VALID_STATUSES = ['sent', 'contacted', 'pitched', 'converted', 'declined'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  const auth = await requirePermission(event, 'outreach.edit');
  if (auth.reject) return auth.reject;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }

  const slug = String(body.slug || '').trim();
  const channel = String(body.channel || '').trim();
  const notes = String(body.notes || '').trim().slice(0, 2000);
  const newStatus = body.newStatus ? String(body.newStatus).trim() : null;

  if (!slug) return json(400, { error: 'slug required' });
  if (!VALID_CHANNELS.includes(channel)) return json(400, { error: 'invalid channel' });
  if (newStatus && !VALID_STATUSES.includes(newStatus)) return json(400, { error: 'invalid status' });

  const tenantId = auth.tenantId || 'doctordir';

  // Verify rep owns this outreach row
  const { data: o } = await sb().from('outreach')
    .select('id,rep,status,first_contacted_at')
    .eq('tenant_id', tenantId).eq('slug', slug).single();
  if (!o) return json(404, { error: 'outreach row not found' });
  if (o.rep && o.rep !== auth.email) return json(403, { error: 'not your lead' });

  // Insert contact log
  await sb().from('rep_contact_log').insert({
    tenant_id: tenantId, rep_email: auth.email, slug, channel, notes
  });

  // Update outreach
  const now = new Date().toISOString();
  const update = { updated_at: now };
  if (!o.first_contacted_at) update.first_contacted_at = now;
  if (newStatus) {
    update.status = newStatus;
    if (newStatus === 'converted') {
      update.converted_at = now;
      update.locked_rep = auth.email;
    }
  }
  // Ensure rep is set
  if (!o.rep) update.rep = auth.email;

  await sb().from('outreach').update(update).eq('id', o.id);

  await audit(auth.email, 'rep.log-contact', 'outreach', o.id, { slug, channel, newStatus }, getIp(event), tenantId);

  return json(200, { ok: true });
};
