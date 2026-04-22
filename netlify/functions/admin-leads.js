/**
 * GET  /api/admin-leads?status=&page=&limit=   - list leads
 * POST /api/admin-leads  {id, action: 'respond'|'close'|'assign', ...}  - update lead
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { requirePermission, audit, getIp, json } = require('./_auth');

exports.handler = async (event) => {
  const auth = await requirePermission(event, 'listings.view');
  if (auth.reject) return auth.reject;

  let tenant;
  try { tenant = await resolveTenant(event); } catch { tenant = { id: 'doctordir' }; }

  if (event.httpMethod === 'GET') {
    const qp = event.queryStringParameters || {};
    const page = Math.max(1, parseInt(qp.page || '1'));
    const limit = Math.min(200, Math.max(10, parseInt(qp.limit || '50')));
    const offset = (page - 1) * limit;

    let q = sb().from('leads').select('*', { count: 'exact' }).eq('tenant_id', tenant.id);
    if (qp.status) q = q.eq('status', qp.status);
    if (qp.slug) q = q.eq('slug', qp.slug);

    const { data, count, error } = await q.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, leads: data || [], total: count || 0, page, limit });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
    const id = body.id;
    const action = body.action;
    if (!id || !action) return json(400, { error: 'id + action required' });

    const update = {};
    if (action === 'respond') { update.status = 'responded'; update.responded_at = new Date().toISOString(); }
    else if (action === 'close') update.status = 'closed';
    else if (action === 'assign' && body.rep) update.sales_rep = body.rep;
    else if (action === 'note') update.notes = body.note;
    else return json(400, { error: 'unknown action' });

    const { error } = await sb().from('leads').update(update).eq('id', id).eq('tenant_id', tenant.id);
    if (error) return json(500, { error: error.message });
    await audit(auth.email, 'lead.' + action, 'lead', id, body, getIp(event), tenant.id);
    return json(200, { ok: true });
  }

  return json(405, { error: 'method not allowed' });
};
