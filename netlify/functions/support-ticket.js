/**
 * POST /api/support-ticket  - submit ticket (public or authed)
 * GET  /api/support-ticket?ticket=ST-XXXXXX&email=X  - lookup ticket
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { json, getIp, parseCookies } = require('./_auth');
const { sendEvent } = require('./email-send');

function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '')); }

exports.handler = async (event) => {
  let tenant;
  try { tenant = await resolveTenant(event); }
  catch { return json(400, { error: 'unknown tenant' }); }

  if (event.httpMethod === 'GET') {
    const num = event.queryStringParameters?.ticket;
    const email = String(event.queryStringParameters?.email || '').trim().toLowerCase();
    if (!num) return json(400, { error: 'ticket number required' });
    const { data } = await sb().from('support_tickets').select('*')
      .eq('tenant_id', tenant.id).eq('ticket_number', num).single();
    if (!data) return json(404, { error: 'not found' });
    if (data.submitter_email !== email) return json(403, { error: 'email mismatch' });
    const { data: msgs } = await sb().from('support_ticket_messages').select('*')
      .eq('ticket_id', data.id).order('created_at', { ascending: true });
    return json(200, { ticket: data, messages: msgs || [] });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }

  const subject = String(body.subject || '').trim().slice(0, 200);
  const description = String(body.description || '').trim().slice(0, 5000);
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 120);
  const category = String(body.category || 'other');
  const slug = body.slug ? String(body.slug).slice(0, 200) : null;
  const submitterRole = String(body.submitterRole || 'public');

  if (!subject || !description || !validEmail(email)) {
    return json(400, { error: 'subject, description, valid email required' });
  }

  // Rate limit: 10/hour per email or IP
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await sb().from('support_tickets').select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id).eq('submitter_email', email).gte('created_at', oneHourAgo);
  if ((count || 0) >= 10) return json(429, { error: 'too many tickets' });

  // Max 5 open tickets per submitter
  const { count: openCount } = await sb().from('support_tickets').select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id).eq('submitter_email', email).in('status', ['open', 'in_progress']);
  if ((openCount || 0) >= 5) return json(429, { error: 'too many open tickets - please wait for existing tickets to be resolved' });

  const { data: ticket, error } = await sb().from('support_tickets').insert({
    tenant_id: tenant.id, submitter_role: submitterRole, submitter_email: email,
    submitter_name: name, slug, category, priority: 'normal',
    subject, description, status: 'open',
    ip_address: getIp(event), user_agent: event.headers?.['user-agent'] || ''
  }).select().single();

  if (error) { console.error('ticket insert:', error); return json(500, { error: 'failed' }); }

  // Confirm to submitter
  try {
    await sendEvent({
      to: email, tenantId: tenant.id, event: 'ticket.submitted',
      subject: `Ticket received: ${ticket.ticket_number} | ${tenant.brand_name}`,
      html: `<h2>Ticket received</h2>
             <p>Hi ${name || 'there'},</p>
             <p>We've received your support request. Your ticket number is:</p>
             <p style="font-size:20px;font-weight:700;background:#faf8f3;padding:12px 20px;display:inline-block;border-radius:6px">${ticket.ticket_number}</p>
             <p><strong>Subject:</strong> ${subject}</p>
             <p>Our team will respond within 24 hours. You can reference this ticket number in any follow-up.</p>
             <p>&mdash; The ${tenant.brand_name} Team</p>`.replace(/&mdash;/g, '-')
    });
  } catch (e) { console.error('ticket confirm email:', e.message); }

  // Notify admin
  try {
    await sendEvent({
      to: tenant.admin_email, tenantId: tenant.id, event: 'admin.new-ticket',
      subject: `[${tenant.brand_name}] New ticket: ${ticket.ticket_number} | ${subject}`,
      html: `<p>New support ticket from <strong>${name || email}</strong> (${submitterRole}).</p>
             <p><strong>Category:</strong> ${category}<br>
                <strong>Subject:</strong> ${subject}</p>
             <p>${description.replace(/\n/g, '<br>')}</p>
             <p><a href="https://${tenant.domain}/admin#tickets">Respond in admin</a></p>`
    });
  } catch (e) { console.error('admin ticket email:', e.message); }

  return json(200, { ok: true, ticketNumber: ticket.ticket_number });
};
