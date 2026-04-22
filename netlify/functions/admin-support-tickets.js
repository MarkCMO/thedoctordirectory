/**
 * GET  /api/admin-support-tickets?status=&priority=
 * POST /api/admin-support-tickets {ticketId, action: 'respond'|'resolve'|'close'|'set-priority', ...}
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { requirePermission, audit, getIp, json } = require('./_auth');
const { sendEvent } = require('./email-send');

exports.handler = async (event) => {
  const auth = await requirePermission(event, 'tickets.view');
  if (auth.reject) return auth.reject;

  let tenant;
  try { tenant = await resolveTenant(event); } catch { tenant = { id: 'doctordir' }; }

  if (event.httpMethod === 'GET') {
    const qp = event.queryStringParameters || {};
    let q = sb().from('support_tickets').select('*').eq('tenant_id', tenant.id);
    if (qp.status) q = q.eq('status', qp.status);
    if (qp.priority) q = q.eq('priority', qp.priority);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(200);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, tickets: data || [] });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
    const { ticketId, action, message, priority } = body;
    if (!ticketId || !action) return json(400, { error: 'ticketId + action required' });

    const { data: ticket } = await sb().from('support_tickets').select('*').eq('id', ticketId).eq('tenant_id', tenant.id).single();
    if (!ticket) return json(404, { error: 'not found' });

    if (action === 'respond') {
      if (!message) return json(400, { error: 'message required' });
      await sb().from('support_tickets').update({
        admin_response: message, status: 'in_progress', assigned_admin: auth.email
      }).eq('id', ticketId);
      await sb().from('support_ticket_messages').insert({
        ticket_id: ticketId, sender_role: 'admin', sender_email: auth.email, message
      });
      try {
        await sendEvent({
          to: ticket.submitter_email, tenantId: tenant.id,
          event: 'ticket.admin-replied',
          subject: `Re: ${ticket.subject} | Ticket ${ticket.ticket_number}`,
          html: `<p>We have an update on your support ticket <strong>${ticket.ticket_number}</strong>:</p>
                 <div style="background:#faf8f3;padding:16px;border-left:4px solid #C8A45E">${message.replace(/\n/g, '<br>')}</div>
                 <p>Reply to this email to continue the thread.</p>`
        });
      } catch (e) { console.error('ticket reply email:', e.message); }
    } else if (action === 'resolve') {
      await sb().from('support_tickets').update({
        status: 'resolved', resolved_at: new Date().toISOString()
      }).eq('id', ticketId);
      try {
        await sendEvent({
          to: ticket.submitter_email, tenantId: tenant.id,
          event: 'ticket.resolved',
          subject: `Ticket resolved: ${ticket.ticket_number}`,
          html: `<p>Your support ticket <strong>${ticket.ticket_number}</strong> has been resolved.</p>
                 <p>If you need further help, reply to this email or submit a new ticket.</p>`
        });
      } catch {}
    } else if (action === 'close') {
      await sb().from('support_tickets').update({
        status: 'closed', closed_at: new Date().toISOString()
      }).eq('id', ticketId);
    } else if (action === 'set-priority') {
      if (!priority) return json(400, { error: 'priority required' });
      await sb().from('support_tickets').update({ priority }).eq('id', ticketId);
    } else {
      return json(400, { error: 'unknown action' });
    }

    await audit(auth.email, 'ticket.' + action, 'support_ticket', ticketId, body, getIp(event), tenant.id);
    return json(200, { ok: true });
  }

  return json(405, { error: 'method not allowed' });
};
