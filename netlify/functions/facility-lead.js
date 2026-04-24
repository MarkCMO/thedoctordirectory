/**
 * POST /api/facility-lead
 * Public contact form submission from doctor pages.
 * body: {slug, name, email, phone?, condition?, location?, preferredDates?, message, inquiryType?}
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { json, getIp } = require('./_auth');
const { sendEvent } = require('./email-send');
const { checkRate } = require('./_ratelimit');

function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '')); }

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }

  const slug = String(body.slug || '').trim();
  const name = String(body.name || '').trim().slice(0, 120);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
  const phone = String(body.phone || '').trim().slice(0, 40);
  const condition = String(body.condition || '').trim().slice(0, 200);
  const location = String(body.location || '').trim().slice(0, 200);
  const preferredDates = String(body.preferredDates || '').trim().slice(0, 200);
  const message = String(body.message || '').trim().slice(0, 2000);
  const inquiryType = ['inquiry', 'consultation', 'travel'].includes(body.inquiryType) ? body.inquiryType : 'inquiry';

  if (!slug || !name || !validEmail(email) || !message) {
    return json(400, { error: 'slug, name, valid email, and message required' });
  }

  // Rate limit: max 5 leads/hour per IP
  const ip = getIp(event);
  const rl = await checkRate({ key: 'lead:' + ip, limit: 5, windowMs: 60 * 60 * 1000 });
  if (!rl.ok) return json(429, { error: 'too many submissions; please try again later' });

  let tenant;
  try { tenant = await resolveTenant(event); }
  catch (e) { return json(400, { error: 'unknown tenant' }); }

  // Simple rate limit: 3 leads per email per hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await sb().from('leads').select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id).eq('email', email).gte('created_at', oneHourAgo);
  if ((count || 0) >= 3) return json(429, { error: 'too many inquiries from this email' });

  // Insert lead
  const { data: lead, error } = await sb().from('leads').insert({
    tenant_id: tenant.id, slug, name, email, phone, condition, location,
    preferred_dates: preferredDates, message, inquiry_type: inquiryType,
    status: 'new', ip_address: getIp(event), user_agent: event.headers?.['user-agent'] || ''
  }).select().single();

  if (error) { console.error('lead insert failed:', error); return json(500, { error: 'failed to save' }); }

  // Look up listing for notifications
  const { data: listing } = await sb().from('listings').select('name, email, slug')
    .eq('tenant_id', tenant.id).eq('slug', slug).single();

  // Email the doctor/owner if we have their email
  if (listing?.email) {
    try {
      await sendEvent({
        to: listing.email,
        tenantId: tenant.id,
        event: 'lead.new-inquiry',
        subject: `New ${inquiryType} inquiry | ${listing.name}`,
        html: `
          <h2>New patient inquiry</h2>
          <p><strong>${name}</strong> submitted an inquiry through your ${tenant.brand_name} profile.</p>
          <p><strong>Type:</strong> ${inquiryType}<br>
             <strong>Email:</strong> ${email}<br>
             ${phone ? `<strong>Phone:</strong> ${phone}<br>` : ''}
             ${condition ? `<strong>Condition:</strong> ${condition}<br>` : ''}
             ${location ? `<strong>Patient Location:</strong> ${location}<br>` : ''}
             ${preferredDates ? `<strong>Preferred Dates:</strong> ${preferredDates}<br>` : ''}
          </p>
          <p><strong>Message:</strong></p>
          <p style="background:#f7f5f0;padding:16px;border-left:4px solid #C8A45E">${message.replace(/\n/g, '<br>')}</p>
          <p>Log in to your dashboard to respond: <a href="https://${tenant.domain}/my-listing?slug=${slug}">${tenant.domain}/my-listing</a></p>`
      });
    } catch (e) { console.error('owner email failed:', e.message); }
  }

  // Notify admin (bcc)
  try {
    await sendEvent({
      to: tenant.admin_email,
      tenantId: tenant.id,
      event: 'admin.new-lead',
      subject: `[${tenant.brand_name}] New lead for ${listing?.name || slug}`,
      html: `<p>New lead submitted.</p>
             <p><strong>Doctor:</strong> ${listing?.name || slug}<br>
                <strong>From:</strong> ${name} &lt;${email}&gt;<br>
                <strong>Type:</strong> ${inquiryType}</p>
             <p>${message.replace(/\n/g, '<br>')}</p>
             <p><a href="https://${tenant.domain}/admin#leads">Review in admin</a></p>`
    });
  } catch (e) { console.error('admin email failed:', e.message); }

  // Confirm to submitter
  try {
    await sendEvent({
      to: email,
      tenantId: tenant.id,
      event: 'lead.confirmation',
      subject: `We received your inquiry | ${tenant.brand_name}`,
      html: `<p>Hi ${name},</p>
             <p>Thanks for reaching out through ${tenant.brand_name}. Your inquiry has been forwarded to ${listing?.name || 'the doctor'}.</p>
             <p>You can expect a response within 24-48 hours. For urgent concerns, please contact your primary care provider or 911.</p>
             <p>&mdash; The ${tenant.brand_name} Team</p>`.replace(/&mdash;/g, '-')
    });
  } catch (e) { console.error('confirmation email failed:', e.message); }

  return json(200, { ok: true, leadId: lead.id });
};
