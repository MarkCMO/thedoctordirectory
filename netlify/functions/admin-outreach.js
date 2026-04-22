/**
 * Admin outreach / CRM pipeline.
 * GET  /api/admin-outreach?status=&rep=&q=&page=  - paginated list + pipeline counts
 * POST /api/admin-outreach                        - actions:
 *   { id, action: 'assign',   rep }               - assign to rep (sets rep + assigned_to_rep_at)
 *   { id, action: 'unassign' }
 *   { id, action: 'setStatus', status }
 *   { id, action: 'lock',      rep }              - permanently attribute (sets locked_rep)
 *   { id, action: 'bulkAssign', ids[], rep }
 */
const { sb } = require('./db');
const { requirePermission, audit, getIp, json } = require('./_auth');

const STATUSES = ['sent', 'contacted', 'pitched', 'converted', 'declined'];

exports.handler = async (event) => {
  const auth = await requirePermission(event, 'outreach.view');
  if (auth.reject) return auth.reject;
  const tenantId = auth.tenantId || 'doctordir';

  if (event.httpMethod === 'GET') {
    const qs = event.queryStringParameters || {};
    const page = Math.max(1, parseInt(qs.page, 10) || 1);
    const limit = Math.min(100, parseInt(qs.limit, 10) || 50);
    const offset = (page - 1) * limit;

    // Pipeline counts (unfiltered by page/search)
    const counts = {};
    for (const s of STATUSES) {
      const { count } = await sb().from('outreach').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', s);
      counts[s] = count || 0;
    }
    const { count: unassigned } = await sb().from('outreach').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).is('rep', null);
    counts.unassigned = unassigned || 0;

    // Query
    let q = sb().from('outreach').select('*', { count: 'exact' }).eq('tenant_id', tenantId);
    if (qs.status) q = q.eq('status', qs.status);
    if (qs.rep === 'unassigned') q = q.is('rep', null);
    else if (qs.rep) q = q.eq('rep', qs.rep);
    if (qs.q) q = q.or(`facility_name.ilike.%${qs.q}%,slug.ilike.%${qs.q}%`);
    const { data: rows, count } = await q.order('updated_at', { ascending: false }).range(offset, offset + limit - 1);

    // Enrich with listing info
    const slugs = (rows || []).map(r => r.slug);
    let listingMap = {};
    if (slugs.length) {
      const { data: listings } = await sb().from('listings').select('slug,name,specialty,city,state,plan,phone,email').eq('tenant_id', tenantId).in('slug', slugs);
      for (const l of (listings || [])) listingMap[l.slug] = l;
    }
    const enriched = (rows || []).map(r => ({ ...r, listing: listingMap[r.slug] || null }));

    return json(200, {
      outreach: enriched,
      page, limit,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / limit),
      counts
    });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  const authEdit = await requirePermission(event, 'outreach.edit');
  if (authEdit.reject) return authEdit.reject;

  let body; try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
  const { id, action } = body;

  if (action === 'assign') {
    if (!body.rep) return json(400, { error: 'rep required' });
    await sb().from('outreach').update({
      rep: body.rep, assigned_to_rep_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq('id', id);
    await audit(auth.email, 'outreach.assigned', 'outreach', id, { rep: body.rep }, getIp(event), tenantId);
    return json(200, { ok: true });
  }

  if (action === 'unassign') {
    await sb().from('outreach').update({ rep: null, assigned_to_rep_at: null, updated_at: new Date().toISOString() }).eq('id', id);
    await audit(auth.email, 'outreach.unassigned', 'outreach', id, {}, getIp(event), tenantId);
    return json(200, { ok: true });
  }

  if (action === 'setStatus') {
    if (!STATUSES.includes(body.status)) return json(400, { error: 'invalid status' });
    const update = { status: body.status, updated_at: new Date().toISOString() };
    if (body.status === 'converted') update.converted_at = new Date().toISOString();
    await sb().from('outreach').update(update).eq('id', id);
    await audit(auth.email, 'outreach.status-set', 'outreach', id, { status: body.status }, getIp(event), tenantId);
    return json(200, { ok: true });
  }

  if (action === 'lock') {
    if (!body.rep) return json(400, { error: 'rep required' });
    await sb().from('outreach').update({
      locked_rep: body.rep, rep: body.rep, status: 'converted', converted_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq('id', id);
    await audit(auth.email, 'outreach.locked', 'outreach', id, { rep: body.rep }, getIp(event), tenantId);
    return json(200, { ok: true });
  }

  if (action === 'bulkAssign') {
    if (!Array.isArray(body.ids) || !body.ids.length || !body.rep) return json(400, { error: 'ids[] and rep required' });
    await sb().from('outreach').update({
      rep: body.rep, assigned_to_rep_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).in('id', body.ids);
    await audit(auth.email, 'outreach.bulk-assigned', 'outreach', body.ids.length + ' rows', { rep: body.rep, count: body.ids.length }, getIp(event), tenantId);
    return json(200, { ok: true, count: body.ids.length });
  }

  return json(400, { error: 'unknown action' });
};
