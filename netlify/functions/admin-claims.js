/**
 * GET  /api/admin-claims    - list claim queue
 * POST /api/admin-claims {id, action: 'approve'|'reject'|'force-verify'|'delete', note?}
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { requirePermission, audit, getIp, json } = require('./_auth');

exports.handler = async (event) => {
  const auth = await requirePermission(event, 'claims.moderate');
  if (auth.reject) return auth.reject;

  let tenant;
  try { tenant = await resolveTenant(event); } catch { tenant = { id: 'doctordir' }; }

  if (event.httpMethod === 'GET') {
    const status = event.queryStringParameters?.status || 'pending';
    const { data, error } = await sb().from('claims').select('*')
      .eq('tenant_id', tenant.id).eq('status', status)
      .order('created_at', { ascending: false }).limit(200);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, claims: data || [] });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
    const { id, action, note } = body;
    if (!id || !action) return json(400, { error: 'id + action required' });

    const { data: claim } = await sb().from('claims').select('*').eq('id', id).eq('tenant_id', tenant.id).single();
    if (!claim) return json(404, { error: 'not found' });

    if (action === 'approve') {
      await sb().from('claims').update({
        status: 'approved', approved_at: new Date().toISOString(),
        approved_by: auth.email, admin_note: note || null
      }).eq('id', id);
    } else if (action === 'reject') {
      await sb().from('claims').update({
        status: 'rejected', admin_note: note || null
      }).eq('id', id);
    } else if (action === 'force-verify') {
      await sb().from('claims').update({
        status: 'verified', verified_at: new Date().toISOString(), admin_note: `force-verified by ${auth.email}`
      }).eq('id', id);
    } else if (action === 'delete') {
      await sb().from('claims').delete().eq('id', id);
    } else {
      return json(400, { error: 'unknown action' });
    }

    await audit(auth.email, 'claim.' + action, 'claim', id, body, getIp(event), tenant.id);
    return json(200, { ok: true });
  }

  return json(405, { error: 'method not allowed' });
};
