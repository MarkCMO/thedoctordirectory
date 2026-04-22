/**
 * GET /api/admin-audit-log?actor=&action=&target=&limit=
 */
const { sb } = require('./db');
const { requirePermission, json } = require('./_auth');

exports.handler = async (event) => {
  const auth = await requirePermission(event, 'admins.manage');
  if (auth.reject) return auth.reject;

  const qp = event.queryStringParameters || {};
  const limit = Math.min(500, Math.max(10, parseInt(qp.limit || '100')));

  let q = sb().from('admin_audit_log').select('*');
  if (qp.actor) q = q.ilike('actor_email', `%${qp.actor}%`);
  if (qp.action) q = q.ilike('action', `%${qp.action}%`);
  if (qp.target) q = q.or(`target_type.ilike.%${qp.target}%,target_id.ilike.%${qp.target}%`);

  const { data, error } = await q.order('occurred_at', { ascending: false }).limit(limit);
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true, log: data || [] });
};
