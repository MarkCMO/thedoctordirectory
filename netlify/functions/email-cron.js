/**
 * Hourly cron.
 *   - Drip: unclaimed.d1  -> 24h after listing created unclaimed, send claim invite
 *   - Drip: unclaimed.d7  -> 7d follow-up if still unclaimed
 *   - Drip: owner.welcome -> 1h after claim, if no welcome sent yet
 *   - Daily (05:00 UTC): admin.daily-digest email
 * Each send is deduped via email_log (event+to_email checked in last N days).
 */
const { sb } = require('./db');
const { sendEvent } = require('./email-send');

async function alreadySent(event, toEmail, daysBack = 30) {
  const since = new Date(Date.now() - daysBack * 86400000).toISOString();
  const { data } = await sb().from('email_log').select('id')
    .eq('event', event).eq('to_email', toEmail).gte('sent_at', since).limit(1);
  return (data || []).length > 0;
}

async function dripUnclaimed(days, eventKey) {
  const cutoffHigh = new Date(Date.now() - days * 86400000).toISOString();
  const cutoffLow = new Date(Date.now() - (days + 1) * 86400000).toISOString();
  const { data: listings } = await sb().from('listings')
    .select('slug,email,name,tenant_id,plan').is('claimed_at', null)
    .not('email', 'is', null)
    .gte('created_at', cutoffLow).lte('created_at', cutoffHigh).limit(200);
  let sent = 0;
  for (const l of (listings || [])) {
    if (!l.email) continue;
    if (await alreadySent(eventKey, l.email.toLowerCase(), 90)) continue;
    try {
      await sendEvent({
        to: l.email, tenantId: l.tenant_id, event: eventKey,
        subject: 'Is this you? Claim your free listing | The Doctor Directory',
        html: `<p>Hi,</p>
               <p>We have a profile for <strong>${l.name}</strong> on The Doctor Directory. Claiming takes 60 seconds and lets you reply to patient inquiries, update your bio, and upgrade for priority placement.</p>
               <p><a href="https://thedoctordirectory.com/claim?slug=${encodeURIComponent(l.slug)}" style="display:inline-block;padding:12px 24px;background:#C8A45E;color:#0b1a2f;text-decoration:none;border-radius:6px;font-weight:600">Claim Your Listing</a></p>
               <p style="font-size:12px;color:#6b6558">If this isn't you, you can ignore this message.</p>`
      });
      sent++;
    } catch (e) { console.error('drip send:', e.message); }
  }
  return sent;
}

async function dripOwnerWelcome() {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: claimed } = await sb().from('listings')
    .select('slug,email,claimed_by_email,name,tenant_id,plan')
    .gte('claimed_at', twoHoursAgo).lte('claimed_at', hourAgo).limit(200);
  let sent = 0;
  for (const l of (claimed || [])) {
    const to = l.claimed_by_email || l.email;
    if (!to) continue;
    if (await alreadySent('owner.welcome', to.toLowerCase(), 365)) continue;
    try {
      await sendEvent({
        to, tenantId: l.tenant_id, event: 'owner.welcome',
        subject: `Welcome to The Doctor Directory, ${l.name}`,
        html: `<p>Welcome aboard. Here's what to do next:</p>
               <ol>
                 <li><a href="https://thedoctordirectory.com/my-listing?slug=${encodeURIComponent(l.slug)}">Open your dashboard</a></li>
                 <li>Add a bio, phone, and website</li>
                 <li>Upload up to 20 photos (Premium)</li>
                 <li>Reply to patient inquiries within 24 hours</li>
               </ol>
               <p><a href="https://thedoctordirectory.com/upgrade?slug=${encodeURIComponent(l.slug)}">Upgrade</a> for priority search placement.</p>`
      });
      sent++;
    } catch (e) { console.error('welcome send:', e.message); }
  }
  return sent;
}

async function adminDigest() {
  if (new Date().getUTCHours() !== 5) return 0;
  const since = new Date(Date.now() - 86400000).toISOString();
  const [newLeads, newReviews, newClaims, newSubs, newTickets] = await Promise.all([
    sb().from('leads').select('*', { count: 'exact', head: true }).gte('created_at', since),
    sb().from('reviews').select('*', { count: 'exact', head: true }).gte('created_at', since),
    sb().from('claims').select('*', { count: 'exact', head: true }).gte('created_at', since),
    sb().from('submissions').select('*', { count: 'exact', head: true }).gte('created_at', since),
    sb().from('support_tickets').select('*', { count: 'exact', head: true }).gte('created_at', since)
  ]);
  const { data: tenants } = await sb().from('tenants').select('id,admin_email,brand_name').limit(20);
  let sent = 0;
  for (const t of (tenants || [])) {
    if (!t.admin_email) continue;
    try {
      await sendEvent({
        to: t.admin_email, tenantId: t.id, event: 'admin.daily-digest',
        subject: `[${t.brand_name}] Daily digest`,
        html: `<h3>Last 24 hours</h3>
               <ul>
                 <li>New leads: <strong>${newLeads.count || 0}</strong></li>
                 <li>New reviews (pending): <strong>${newReviews.count || 0}</strong></li>
                 <li>New claims: <strong>${newClaims.count || 0}</strong></li>
                 <li>New submissions: <strong>${newSubs.count || 0}</strong></li>
                 <li>New support tickets: <strong>${newTickets.count || 0}</strong></li>
               </ul>
               <p><a href="https://thedoctordirectory.com/admin">Open admin</a></p>`
      });
      sent++;
    } catch (e) { console.error('digest send:', e.message); }
  }
  return sent;
}

exports.handler = async () => {
  const start = Date.now();
  const stats = { d1: 0, d7: 0, welcome: 0, digest: 0 };
  try { stats.d1 = await dripUnclaimed(1, 'unclaimed.d1'); } catch (e) { console.error('d1:', e.message); }
  try { stats.d7 = await dripUnclaimed(7, 'unclaimed.d7'); } catch (e) { console.error('d7:', e.message); }
  try { stats.welcome = await dripOwnerWelcome(); } catch (e) { console.error('welcome:', e.message); }
  try { stats.digest = await adminDigest(); } catch (e) { console.error('digest:', e.message); }
  await sb().from('system_log').insert({
    source: 'email-cron', level: 'info', event: 'cron_run',
    message: `drip sent: d1=${stats.d1} d7=${stats.d7} welcome=${stats.welcome} digest=${stats.digest}`,
    duration_ms: Date.now() - start, meta: stats
  });
  return { statusCode: 200, body: JSON.stringify(stats) };
};
