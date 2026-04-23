/**
 * GET  /api/admin-email-templates
 * POST /api/admin-email-templates {action: 'save'|'delete'|'test-send', ...}
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { requirePermission, audit, getIp, json } = require('./_auth');
const { sendEvent } = require('./email-send');

exports.handler = async (event) => {
  const auth = await requirePermission(event, 'settings.manage');
  if (auth.reject) return auth.reject;

  let tenant;
  try { tenant = await resolveTenant(event); } catch { tenant = { id: 'doctordir' }; }

  if (event.httpMethod === 'GET') {
    const { data, error } = await sb().from('email_templates').select('*')
      .eq('tenant_id', tenant.id).order('key');
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, templates: data || [] });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
    const action = body.action;

    if (action === 'save') {
      const row = {
        tenant_id: tenant.id,
        key: String(body.key || '').trim(),
        subject: String(body.subject || '').trim(),
        html: String(body.html || ''),
        text: body.text || null,
        description: body.description || null,
        is_active: body.is_active !== false,
        updated_by: auth.email,
        updated_at: new Date().toISOString()
      };
      if (!row.key || !row.subject) return json(400, { error: 'key + subject required' });
      const { data, error } = await sb().from('email_templates')
        .upsert(row, { onConflict: 'tenant_id,key' }).select().single();
      if (error) return json(500, { error: error.message });
      await audit(auth.email, 'email-template.save', 'email_template', row.key, {}, getIp(event), tenant.id);
      return json(200, { ok: true, template: data });
    }

    if (action === 'delete') {
      if (!body.id) return json(400, { error: 'id required' });
      await sb().from('email_templates').delete().eq('id', body.id).eq('tenant_id', tenant.id);
      await audit(auth.email, 'email-template.delete', 'email_template', body.id, {}, getIp(event), tenant.id);
      return json(200, { ok: true });
    }

    if (action === 'test-send') {
      const key = String(body.key || '');
      const to = String(body.to || '').trim().toLowerCase();
      if (!key || !to) return json(400, { error: 'key + to required' });
      const { data: tmpl } = await sb().from('email_templates').select('*')
        .eq('tenant_id', tenant.id).eq('key', key).single();
      if (!tmpl) return json(404, { error: 'template not found' });
      try {
        const r = await sendEvent({
          to, tenantId: tenant.id, event: 'admin.test-template',
          subject: '[TEST] ' + tmpl.subject, html: tmpl.html, text: tmpl.text
        });
        return json(200, { ok: true, result: r });
      } catch (e) {
        return json(500, { error: e.message });
      }
    }

    return json(400, { error: 'unknown action' });
  }

  return json(405, { error: 'method not allowed' });
};
