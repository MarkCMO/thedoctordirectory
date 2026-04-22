/**
 * POST /api/auth-forgot-password {email}
 * Emails a reset link. Always returns 200 (don't leak existence).
 */
const crypto = require('crypto');
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { json, getIp } = require('./_auth');
const { sendEvent } = require('./email-send');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
  const email = String(body.email || '').trim().toLowerCase();
  if (!email) return json(400, { error: 'email required' });

  const { data: cred } = await sb().from('admin_credentials').select('email').eq('email', email).single();
  if (cred) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();  // 1h
    await sb().from('admin_credentials').update({
      reset_token: token, reset_token_expires: expires
    }).eq('email', email);

    let tenant = null;
    try { tenant = await resolveTenant(event); } catch {}
    const domain = tenant?.domain || 'thedoctordirectory.com';
    const resetLink = `https://${domain}/set-password?token=${token}&email=${encodeURIComponent(email)}`;

    try {
      await sendEvent({
        to: email,
        event: 'auth.password-reset',
        subject: 'Reset your password | The Doctor Directory',
        html: `<p>Hi,</p><p>Click below to reset your password (expires in 1 hour):</p>
               <p><a href="${resetLink}">Reset password</a></p>
               <p>If you didn't request this, ignore this email.</p>
               <p>IP: ${getIp(event)}</p>`
      });
    } catch (e) { console.error('reset email failed:', e.message); }
  }

  return json(200, { ok: true, message: 'if account exists, email sent' });
};
