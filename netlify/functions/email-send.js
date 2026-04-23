/**
 * Single choke-point for every outbound email.
 * - Checks email_suppressions (skip if on list)
 * - Sends via Resend
 * - Logs to email_log
 *
 * Callable two ways:
 *   1. sendEvent({ to, event, subject, html, text, meta }) - exported helper
 *   2. POST /api/email-send - for admin test sends
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { resendSend } = require('./lib-resend');
const { json, requirePermission } = require('./_auth');

async function isSuppressed(email) {
  const { data } = await sb().from('email_suppressions').select('email').eq('email', email).single();
  return !!data;
}

function brandedLayout({ brandName = 'The Doctor Directory', content, primaryColor = '#C8A45E' }) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${brandName}</title></head>
<body style="margin:0;padding:0;background:#f7f5f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f0;padding:24px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e1d6">
      <tr><td style="background:#0b1a2f;padding:24px 32px;color:#fff">
        <div style="font-size:22px;font-weight:700;font-family:Georgia,serif">Elite<span style="color:${primaryColor}">MD</span></div>
        <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:2px">The Doctor Directory</div>
      </td></tr>
      <tr><td style="padding:32px">${content}</td></tr>
      <tr><td style="padding:20px 32px;background:#faf8f3;border-top:1px solid #e5e1d6;color:#6b6558;font-size:12px">
        &copy; 2026 ${brandName}. All rights reserved.<br>
        <a href="https://thedoctordirectory.com/privacy-policy" style="color:#6b6558">Privacy</a> &middot;
        <a href="https://thedoctordirectory.com/terms" style="color:#6b6558">Terms</a> &middot;
        <a href="{{unsubscribe_url}}" style="color:#6b6558">Unsubscribe</a>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

/**
 * Main send function. Call this from any other Netlify Function.
 *
 * opts: {
 *   to         (string)  required
 *   event      (string)  required - identifier for email_log
 *   subject    (string)  required
 *   html       (string)  required unless using template
 *   text       (string)  optional
 *   replyTo    (string)  optional
 *   tenantId   (string)  optional - scope
 *   meta       (object)  optional - logged to email_log
 *   wrap       (boolean) default true - wraps html in branded layout
 * }
 */
async function sendEvent(opts) {
  const to = String(opts.to || '').trim().toLowerCase();
  if (!to) throw new Error('to required');
  const event = opts.event || 'generic';

  // DB template override: if an active template exists with key === event, use its subject/html
  if (opts.tenantId && !opts.skipTemplate) {
    try {
      const { data: tmpl } = await sb().from('email_templates')
        .select('subject,html,text').eq('tenant_id', opts.tenantId).eq('key', event).eq('is_active', true).maybeSingle();
      if (tmpl) {
        opts = { ...opts, subject: opts.subject || tmpl.subject, html: tmpl.html, text: opts.text || tmpl.text, template_id: event };
      }
    } catch {}
  }

  if (await isSuppressed(to)) {
    await sb().from('email_log').insert({
      tenant_id: opts.tenantId, to_email: to, event, subject: opts.subject,
      status: 'suppressed', meta: opts.meta
    });
    return { suppressed: true };
  }

  // Resolve tenant for FROM
  let from = process.env.FROM_EMAIL || 'hello@thedoctordirectory.com';
  let replyTo = opts.replyTo || process.env.ADMIN_EMAIL || 'admin@thedoctordirectory.com';
  if (opts.tenantId) {
    try {
      const { data: t } = await sb().from('tenants').select('from_email, admin_email, brand_name')
        .eq('id', opts.tenantId).single();
      if (t?.from_email) from = t.from_email;
      if (t?.admin_email && !opts.replyTo) replyTo = t.admin_email;
    } catch {}
  }

  const unsubUrl = `https://thedoctordirectory.com/api/email-unsubscribe?email=${encodeURIComponent(to)}`;
  const html = (opts.wrap !== false)
    ? brandedLayout({ content: opts.html || '' }).replace('{{unsubscribe_url}}', unsubUrl)
    : (opts.html || '').replace('{{unsubscribe_url}}', unsubUrl);

  const headers = {
    'List-Unsubscribe': `<${unsubUrl}>, <mailto:${replyTo}?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    'Auto-Submitted': 'auto-generated'
  };

  try {
    const result = await resendSend({
      from, to, subject: opts.subject || '(no subject)',
      html, text: opts.text, replyTo, headers
    });
    await sb().from('email_log').insert({
      tenant_id: opts.tenantId, to_email: to, from_email: from, subject: opts.subject,
      event, template_id: opts.template_id || null, status: 'sent',
      resend_id: result?.id || null, meta: opts.meta
    });
    return { ok: true, id: result?.id };
  } catch (e) {
    await sb().from('email_log').insert({
      tenant_id: opts.tenantId, to_email: to, from_email: from, subject: opts.subject,
      event, status: 'failed', error_message: String(e.message || e), meta: opts.meta
    });
    throw e;
  }
}

// HTTP endpoint for admin test sends
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });
  const auth = await requirePermission(event, 'settings.manage');
  if (auth.reject) return auth.reject;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }

  try {
    const r = await sendEvent({
      to: body.to, event: 'admin.test-send',
      subject: body.subject || 'Test from admin',
      html: body.html || '<p>Test message.</p>'
    });
    return json(200, { ok: true, ...r });
  } catch (e) {
    return json(500, { error: e.message });
  }
};

module.exports.sendEvent = sendEvent;
module.exports.brandedLayout = brandedLayout;
