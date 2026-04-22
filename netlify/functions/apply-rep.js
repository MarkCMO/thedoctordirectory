/**
 * POST /api/apply-rep
 * Public endpoint for prospective reps to submit an application.
 * body: { name, email, phone, addressLine1, city, state, zip,
 *         preferredCategories[], signatureName, paymentMethod, paymentHandle, notes }
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { json, getIp } = require('./_auth');
const { sendEvent } = require('./email-send');

function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '')); }

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }

  const name = String(body.name || '').trim().slice(0, 120);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
  const phone = String(body.phone || '').trim().slice(0, 40);
  const signatureName = String(body.signatureName || '').trim().slice(0, 120);
  const paymentMethod = ['ach','paypal','check'].includes(body.paymentMethod) ? body.paymentMethod : null;
  const paymentHandle = String(body.paymentHandle || '').trim().slice(0, 200);
  const preferredCategories = Array.isArray(body.preferredCategories)
    ? body.preferredCategories.map(s => String(s).slice(0, 80)).slice(0, 20) : [];
  const notes = String(body.notes || '').trim().slice(0, 1000);

  const address = {
    line1: String(body.addressLine1 || '').slice(0, 200),
    city: String(body.city || '').slice(0, 80),
    state: String(body.state || '').slice(0, 2).toUpperCase(),
    zip: String(body.zip || '').slice(0, 10)
  };

  if (!name || !validEmail(email) || !signatureName) {
    return json(400, { error: 'name, valid email, signature required' });
  }

  let tenant;
  try { tenant = await resolveTenant(event); }
  catch { return json(400, { error: 'unknown tenant' }); }

  // Rate limit: one application per email per 24h
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await sb().from('rep_applications').select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id).eq('email', email).gte('created_at', oneDayAgo);
  if ((count || 0) >= 1) return json(429, { error: 'application already submitted recently' });

  const { data, error } = await sb().from('rep_applications').insert({
    tenant_id: tenant.id,
    name, email, phone, address,
    preferred_categories: preferredCategories,
    status: 'submitted',
    signature_name: signatureName,
    signed_at: new Date().toISOString(),
    signature_ip: getIp(event),
    payment_method: paymentMethod,
    payment_handle: paymentHandle
  }).select().single();

  if (error) { console.error('apply-rep insert:', error); return json(500, { error: 'failed to submit' }); }

  // Notify admin
  try {
    await sendEvent({
      to: tenant.admin_email,
      tenantId: tenant.id,
      event: 'rep.application-received',
      subject: `[${tenant.brand_name}] New rep application: ${name}`,
      html: `<p>New rep application submitted.</p>
             <p><strong>Name:</strong> ${name}<br>
                <strong>Email:</strong> ${email}<br>
                <strong>Phone:</strong> ${phone}<br>
                <strong>Location:</strong> ${address.city}, ${address.state}<br>
                <strong>Categories:</strong> ${preferredCategories.join(', ') || 'any'}</p>
             ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
             <p><a href="https://${tenant.domain}/admin#rep-applications">Review in admin</a></p>`
    });
  } catch (e) { console.error('rep app admin email:', e.message); }

  // Confirm to applicant
  try {
    await sendEvent({
      to: email,
      tenantId: tenant.id,
      event: 'rep.application-confirmation',
      subject: `Application received | ${tenant.brand_name}`,
      html: `<p>Hi ${name.split(/\s+/)[0]},</p>
             <p>Thanks for applying to sell for ${tenant.brand_name}. We review applications within 3 business days.</p>
             <p>If approved, you'll receive an invite email with a link to set your password and access your rep portal.</p>`
    });
  } catch (e) { console.error('applicant email:', e.message); }

  return json(200, { ok: true, id: data.id });
};
