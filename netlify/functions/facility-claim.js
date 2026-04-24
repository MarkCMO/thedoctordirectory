/**
 * POST /api/facility-claim
 * Owner claim flow:
 *   step=request  → {slug, email, phone?, name?} → sends 6-digit code to email
 *   step=verify   → {slug, email, code} → creates claims row as verified
 *   step=set-password → {slug, email, code, password} → sets listing password + access_token
 */
const crypto = require('crypto');
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { hashPassword, audit, getIp, json } = require('./_auth');
const { sendEvent } = require('./email-send');

function gen6() { return String(Math.floor(100000 + Math.random() * 900000)); }

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }

  let tenant;
  try { tenant = await resolveTenant(event); }
  catch { return json(400, { error: 'unknown tenant' }); }

  const step = String(body.step || 'request');
  const slug = String(body.slug || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const ip = getIp(event);

  // Look up listing
  const { data: listing } = await sb().from('listings').select('*')
    .eq('tenant_id', tenant.id).eq('slug', slug).single();
  if (!listing) return json(404, { error: 'listing not found' });

  if (step === 'request') {
    if (!email) return json(400, { error: 'email required' });
    // Rate limit: max 3 requests per slug per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await sb().from('claims').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).eq('slug', slug).gte('created_at', oneHourAgo);
    if ((count || 0) >= 3) return json(429, { error: 'too many claim attempts' });

    const code = gen6();
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await sb().from('claims').insert({
      tenant_id: tenant.id, slug, email,
      phone: String(body.phone || ''), name: String(body.name || ''),
      verification_code: code, code_expires_at: expires,
      status: 'pending', ip_address: ip, user_agent: event.headers?.['user-agent'] || ''
    });

    // Email the code. Prefer the listing's email if it matches, else send to whoever claimed.
    const sendTo = listing.email && listing.email.toLowerCase() === email ? listing.email : email;
    try {
      await sendEvent({
        to: sendTo, tenantId: tenant.id, event: 'claim.verify',
        subject: `Your verification code: ${code} | ${tenant.brand_name}`,
        html: `<h2>Verify your claim</h2>
               <p>You're claiming the ${tenant.brand_name} listing for <strong>${listing.name}</strong>.</p>
               <p>Your 6-digit code:</p>
               <p style="font-size:32px;font-weight:700;color:#0b1a2f;background:#faf8f3;padding:16px;text-align:center;letter-spacing:8px">${code}</p>
               <p>Expires in 30 minutes. If you didn't request this, ignore this email.</p>`
      });
    } catch (e) {
      return json(500, { error: 'failed to send verification email' });
    }
    return json(200, { ok: true, message: 'code sent' });
  }

  if (step === 'verify' || step === 'set-password') {
    const code = String(body.code || '').trim();
    if (!email || !code) return json(400, { error: 'email + code required' });

    const { data: claim } = await sb().from('claims').select('*')
      .eq('tenant_id', tenant.id).eq('slug', slug).eq('email', email)
      .eq('verification_code', code).eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(1).single();
    if (!claim) return json(400, { error: 'invalid code' });
    if (new Date(claim.code_expires_at).getTime() < Date.now()) {
      return json(400, { error: 'code expired' });
    }

    if (step === 'verify') {
      await sb().from('claims').update({ status: 'verified', verified_at: new Date().toISOString() }).eq('id', claim.id);
      return json(200, { ok: true, message: 'verified; proceed to set-password' });
    }

    // step === 'set-password'
    const password = String(body.password || '');
    if (password.length < 8) return json(400, { error: 'password must be 8+ chars' });

    const accessToken = crypto.randomUUID();
    const passwordHash = await hashPassword(password);

    await sb().from('listings').update({
      password_hash: passwordHash, access_token: accessToken,
      claimed_at: new Date().toISOString(), claimed_by: email,
      email: listing.email || email
    }).eq('tenant_id', tenant.id).eq('slug', slug);

    await sb().from('claims').update({
      status: 'approved', approved_at: new Date().toISOString(), approved_by: email
    }).eq('id', claim.id);

    await audit(email, 'claim.complete', 'listing', slug, { tenant: tenant.id }, ip, tenant.id);

    // Referral attribution: if a ref code was passed, track signup
    if (body.refCode) {
      try {
        const { data: ref } = await sb().from('referral_codes').select('*').eq('code', String(body.refCode).toUpperCase()).single();
        if (ref) {
          await sb().from('referral_events').insert({
            tenant_id: tenant.id, code: ref.code, event_type: 'signup',
            referred_slug: slug, referred_email: email, ip_address: ip
          });
          await sb().from('referral_codes').update({ signups: (ref.signups || 0) + 1 }).eq('code', ref.code);
          // Tag the new listing so future upgrades credit the referrer
          await sb().from('listings').update({ referred_by_code: ref.code })
            .eq('tenant_id', tenant.id).eq('slug', slug);
        }
      } catch (e) { console.error('ref attribution:', e.message); }
    }

    try {
      await sendEvent({
        to: email, tenantId: tenant.id, event: 'claim.approved',
        subject: `Claim approved | ${listing.name}`,
        html: `<h2>You're in</h2>
               <p>You've successfully claimed <strong>${listing.name}</strong> on ${tenant.brand_name}.</p>
               <p><a href="https://${tenant.domain}/my-listing?slug=${slug}&token=${accessToken}" style="display:inline-block;background:#C8A45E;color:#0b1a2f;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Open your dashboard</a></p>
               <p>You can now update your listing, view leads, manage photos, and upgrade to a paid plan.</p>`
      });
    } catch (e) { console.error('approval email failed:', e.message); }

    return json(200, { ok: true, accessToken, redirect: `/my-listing?slug=${slug}&token=${accessToken}` });
  }

  return json(400, { error: 'invalid step' });
};
