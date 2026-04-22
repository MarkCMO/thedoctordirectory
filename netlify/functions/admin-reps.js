/**
 * Admin reps management.
 * GET  /api/admin-reps                    - list reps + stats
 * GET  /api/admin-reps?applications=1     - list pending rep applications
 * GET  /api/admin-reps?leadRequests=1     - list pending lead requests
 * POST /api/admin-reps                    - actions:
 *   { action: 'approveApplication', applicationId, tier? }
 *   { action: 'rejectApplication',  applicationId, reason? }
 *   { action: 'toggleRep',          email, active }
 *   { action: 'setTier',            email, tier }
 *   { action: 'approveLeadRequest', id, adminNote? }
 *   { action: 'rejectLeadRequest',  id, adminNote? }
 */
const crypto = require('crypto');
const { sb } = require('./db');
const { requirePermission, audit, getIp, json, hashPassword } = require('./_auth');
const { sendEvent } = require('./email-send');

exports.handler = async (event) => {
  const auth = await requirePermission(event, 'reps.view');
  if (auth.reject) return auth.reject;

  const tenantId = auth.tenantId || 'doctordir';
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    if (qs.applications) {
      const { data } = await sb().from('rep_applications')
        .select('*').eq('tenant_id', tenantId).eq('status', 'submitted')
        .order('created_at', { ascending: false }).limit(100);
      return json(200, { applications: data || [] });
    }
    if (qs.leadRequests) {
      const { data } = await sb().from('rep_lead_requests')
        .select('*').eq('tenant_id', tenantId).eq('status', 'pending')
        .order('created_at', { ascending: true }).limit(100);
      return json(200, { requests: data || [] });
    }
    // List reps with stats
    const { data: reps } = await sb().from('reps').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(200);
    const emails = (reps || []).map(r => r.email);
    let statsByEmail = {};
    if (emails.length) {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      // Weekly contact counts
      const { data: contacts } = await sb().from('rep_contact_log')
        .select('rep_email').eq('tenant_id', tenantId).gte('contacted_at', weekAgo).in('rep_email', emails);
      for (const c of (contacts || [])) {
        statsByEmail[c.rep_email] = statsByEmail[c.rep_email] || { weeklyContacts: 0, conversions: 0 };
        statsByEmail[c.rep_email].weeklyContacts++;
      }
      // Conversions (locked_rep)
      const { data: convs } = await sb().from('outreach')
        .select('locked_rep').eq('tenant_id', tenantId).eq('status', 'converted').in('locked_rep', emails);
      for (const c of (convs || [])) {
        if (!c.locked_rep) continue;
        statsByEmail[c.locked_rep] = statsByEmail[c.locked_rep] || { weeklyContacts: 0, conversions: 0 };
        statsByEmail[c.locked_rep].conversions++;
      }
    }
    const enriched = (reps || []).map(r => ({ ...r, stats: statsByEmail[r.email] || { weeklyContacts: 0, conversions: 0 } }));
    return json(200, { reps: enriched });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  let body; try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
  const action = body.action;

  // Actions requiring edit permission
  const editRequired = ['approveApplication', 'rejectApplication', 'toggleRep', 'setTier', 'approveLeadRequest', 'rejectLeadRequest'];
  if (editRequired.includes(action)) {
    const authEdit = await requirePermission(event, 'reps.edit');
    if (authEdit.reject) return authEdit.reject;
  }

  if (action === 'approveApplication') {
    const { data: app } = await sb().from('rep_applications').select('*').eq('id', body.applicationId).single();
    if (!app) return json(404, { error: 'application not found' });
    if (app.status !== 'submitted') return json(400, { error: 'application not pending' });

    const tier = [30,35,40,45,50].includes(body.tier) ? body.tier : 30;

    // Create admin_user for login
    await sb().from('admin_users').upsert({
      email: app.email, name: app.name, role: 'sales-associate',
      permissions: [], active: true
    }, { onConflict: 'email' });

    // Create reps row
    const { data: rep } = await sb().from('reps').upsert({
      tenant_id: tenantId, name: app.name, email: app.email,
      commission_tier: tier, highest_tier_reached: tier,
      payment_method: app.payment_method, payout_handle: app.payment_handle,
      preferred_categories: app.preferred_categories || [],
      application_id: app.id, active: true
    }, { onConflict: 'tenant_id,email' }).select().single();

    // Password setup token
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    await sb().from('admin_credentials').upsert({
      email: app.email, password_hash: await hashPassword(crypto.randomBytes(16).toString('hex')),
      reset_token: token, reset_token_expires: expires,
      failed_login_count: 0, locked_until: null
    }, { onConflict: 'email' });

    // Mark application approved
    await sb().from('rep_applications').update({
      status: 'approved', updated_at: new Date().toISOString()
    }).eq('id', app.id);

    // Invite email
    const inviteUrl = `https://thedoctordirectory.com/set-password?token=${token}&email=${encodeURIComponent(app.email)}`;
    try {
      await sendEvent({
        to: app.email, tenantId,
        event: 'rep.approved',
        subject: 'Welcome to The Doctor Directory sales team',
        html: `<p>Hi ${app.name.split(/\s+/)[0]},</p>
               <p>Your rep application has been approved. You're starting at the <strong>${tier}%</strong> commission tier.</p>
               <p>Set your password and access your rep portal:</p>
               <p><a href="${inviteUrl}">Set password and sign in</a></p>
               <p>(This link expires in 7 days.)</p>
               <p>Once signed in, you can access the rep portal at https://thedoctordirectory.com/rep-portal</p>`
      });
    } catch (e) { console.error('rep invite email:', e.message); }

    await audit(auth.email, 'rep.application-approved', 'rep_application', app.id, { email: app.email, tier }, getIp(event), tenantId);
    return json(200, { ok: true, rep });
  }

  if (action === 'rejectApplication') {
    const reason = String(body.reason || '').slice(0, 500);
    await sb().from('rep_applications').update({
      status: 'rejected', rejection_reason: reason, updated_at: new Date().toISOString()
    }).eq('id', body.applicationId);
    await audit(auth.email, 'rep.application-rejected', 'rep_application', body.applicationId, { reason }, getIp(event), tenantId);
    return json(200, { ok: true });
  }

  if (action === 'toggleRep') {
    const active = !!body.active;
    await sb().from('reps').update({ active }).eq('tenant_id', tenantId).eq('email', body.email);
    await sb().from('admin_users').update({ active }).eq('email', body.email);
    await audit(auth.email, 'rep.toggled', 'rep', body.email, { active }, getIp(event), tenantId);
    return json(200, { ok: true });
  }

  if (action === 'setTier') {
    const tier = parseInt(body.tier, 10);
    if (![30,35,40,45,50].includes(tier)) return json(400, { error: 'invalid tier' });
    const { data: rep } = await sb().from('reps').select('commission_tier,highest_tier_reached,id').eq('tenant_id', tenantId).eq('email', body.email).single();
    if (!rep) return json(404, { error: 'rep not found' });
    const newHigh = Math.max(rep.highest_tier_reached || 30, tier);
    await sb().from('reps').update({ commission_tier: tier, highest_tier_reached: newHigh }).eq('id', rep.id);
    await sb().from('rep_tier_history').insert({
      tenant_id: tenantId, rep_id: rep.id,
      previous_tier: rep.commission_tier, new_tier: tier,
      reason: 'admin-set', is_permanent_lock: false
    });
    await audit(auth.email, 'rep.tier-set', 'rep', body.email, { from: rep.commission_tier, to: tier }, getIp(event), tenantId);
    return json(200, { ok: true });
  }

  if (action === 'approveLeadRequest' || action === 'rejectLeadRequest') {
    const status = action === 'approveLeadRequest' ? 'approved' : 'rejected';
    await sb().from('rep_lead_requests').update({
      status, admin_note: String(body.adminNote || '').slice(0, 500), updated_at: new Date().toISOString()
    }).eq('id', body.id);
    await audit(auth.email, 'rep.lead-request-' + status, 'rep_lead_request', body.id, {}, getIp(event), tenantId);
    return json(200, { ok: true });
  }

  return json(400, { error: 'unknown action' });
};
