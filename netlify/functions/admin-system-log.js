/**
 * GET /api/admin-system-log?level=&source=&q=&limit=
 * Tail of system_log + recent email_log.
 */
const { sb } = require('./db');
const { requirePermission, json } = require('./_auth');

exports.handler = async (event) => {
  const auth = await requirePermission(event, 'admins.manage');
  if (auth.reject) return auth.reject;

  const qs = event.queryStringParameters || {};
  const limit = Math.min(500, parseInt(qs.limit, 10) || 200);

  if (qs.type === 'email') {
    let q = sb().from('email_log').select('*');
    if (qs.status) q = q.eq('status', qs.status);
    if (qs.event) q = q.eq('event', qs.event);
    if (qs.q) q = q.or(`to_email.ilike.%${qs.q}%,subject.ilike.%${qs.q}%`);
    const { data } = await q.order('sent_at', { ascending: false }).limit(limit);
    return json(200, { emails: data || [] });
  }

  let q = sb().from('system_log').select('*');
  if (qs.level) q = q.eq('level', qs.level);
  if (qs.source) q = q.eq('source', qs.source);
  if (qs.q) q = q.or(`message.ilike.%${qs.q}%,event.ilike.%${qs.q}%`);
  const { data } = await q.order('created_at', { ascending: false }).limit(limit);
  return json(200, { log: data || [] });
};
