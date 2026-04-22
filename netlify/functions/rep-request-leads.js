/**
 * POST /api/rep-request-leads
 * body: { state?, city?, category?, notes? }
 * Queues a request for an admin to assign more leads to this rep.
 */
const { sb } = require('./db');
const { requirePermission, audit, getIp, json } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  const auth = await requirePermission(event, 'outreach.view');
  if (auth.reject) return auth.reject;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }

  const state = String(body.state || '').trim().slice(0, 2).toUpperCase() || null;
  const city = String(body.city || '').trim().slice(0, 100) || null;
  const category = String(body.category || '').trim().slice(0, 80) || null;
  const notes = String(body.notes || '').trim().slice(0, 500);

  const tenantId = auth.tenantId || 'doctordir';

  // Look up rep_id
  const { data: rep } = await sb().from('reps').select('id').eq('tenant_id', tenantId).eq('email', auth.email).single();

  const { data, error } = await sb().from('rep_lead_requests').insert({
    tenant_id: tenantId, rep_id: rep?.id || null, rep_email: auth.email,
    state, city, category, notes, status: 'pending'
  }).select().single();

  if (error) return json(500, { error: 'failed to submit request' });

  await audit(auth.email, 'rep.request-leads', 'rep_lead_requests', data.id, { state, city, category }, getIp(event), tenantId);

  return json(200, { ok: true, id: data.id });
};
