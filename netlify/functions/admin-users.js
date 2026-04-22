/**
 * GET  /api/admin-users  - list admin users
 * POST /api/admin-users {action: 'create'|'update'|'disable'|'enable'|'reset-password', ...}
 */
const crypto = require('crypto');
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { requirePermission, hashPassword, audit, getIp, json, genToken } = require('./_auth');
const { sendEvent } = require('./email-send');

exports.handler = async (event) => {
  const auth = await requirePermission(event, 'admins.manage');
  if (auth.reject) return auth.reject;

  let tenant;
  try { tenant = await resolveTenant(event); } catch { tenant = { id: 'doctordir', domain: 'thedoctordirectory.com' }; }

  if (event.httpMethod === 'GET') {
    const { data, error } = await sb().from('admin_users').select('id,email,name,role,permissions,active,created_at')
      .order('created_at', { ascending: true });
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, users: data || [] });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
    const action = body.action;

    if (action === 'create') {
      const email = String(body.email || '').trim().toLowerCase();
      const role = body.role || 'sales-associate';
      const name = body.name || email;
      const permissions = body.permissions || [];
      if (!email) return json(400, { error: 'email required' });

      // Create admin_users row
      const { error: e1 } = await sb().from('admin_users').insert({
        email, name, role, permissions, active: true
      });
      if (e1) return json(500, { error: e1.message });

      // Create admin_credentials with reset token (so they set their own password)
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
      await sb().from('admin_credentials').insert({
        email, password_hash: 'pending',
        reset_token: resetToken, reset_token_expires: expires
      });

      try {
        const setUrl = `https://${tenant.domain}/set-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
        await sendEvent({
          to: email, tenantId: tenant.id, event: 'admin.invite',
          subject: `You've been invited to ${tenant.brand_name} admin`,
          html: `<h2>Welcome</h2>
                 <p>You've been granted <strong>${role}</strong> access to the ${tenant.brand_name} admin panel.</p>
                 <p><a href="${setUrl}" style="display:inline-block;background:#C8A45E;color:#0b1a2f;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Set your password</a></p>
                 <p>Link expires in 7 days.</p>`
        });
      } catch (e) { console.error('invite email:', e.message); }

      await audit(auth.email, 'admin.create', 'admin_user', email, { role }, getIp(event), tenant.id);
      return json(200, { ok: true });
    }

    if (action === 'update') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email) return json(400, { error: 'email required' });
      const update = {};
      if (body.role) update.role = body.role;
      if (body.name) update.name = body.name;
      if (Array.isArray(body.permissions)) update.permissions = body.permissions;
      const { error } = await sb().from('admin_users').update(update).eq('email', email);
      if (error) return json(500, { error: error.message });
      await audit(auth.email, 'admin.update', 'admin_user', email, update, getIp(event), tenant.id);
      return json(200, { ok: true });
    }

    if (action === 'disable' || action === 'enable') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email) return json(400, { error: 'email required' });
      if (email === auth.email) return json(400, { error: 'cannot disable yourself' });
      await sb().from('admin_users').update({ active: action === 'enable' }).eq('email', email);
      if (action === 'disable') {
        // Revoke all sessions
        await sb().from('auth_sessions').update({
          revoked_at: new Date().toISOString(), revoked_reason: 'admin_disabled'
        }).eq('user_email', email).is('revoked_at', null);
      }
      await audit(auth.email, 'admin.' + action, 'admin_user', email, {}, getIp(event), tenant.id);
      return json(200, { ok: true });
    }

    if (action === 'reset-password') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email) return json(400, { error: 'email required' });
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await sb().from('admin_credentials').update({
        reset_token: resetToken, reset_token_expires: expires,
        failed_login_count: 0, locked_until: null
      }).eq('email', email);
      try {
        const setUrl = `https://${tenant.domain}/set-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
        await sendEvent({
          to: email, tenantId: tenant.id, event: 'admin.password-reset-by-admin',
          subject: `Password reset - ${tenant.brand_name} admin`,
          html: `<p>An admin has triggered a password reset for your account.</p>
                 <p><a href="${setUrl}">Set new password</a> (expires in 24 hours)</p>`
        });
      } catch {}
      await audit(auth.email, 'admin.reset-password', 'admin_user', email, {}, getIp(event), tenant.id);
      return json(200, { ok: true });
    }

    return json(400, { error: 'unknown action' });
  }

  return json(405, { error: 'method not allowed' });
};
