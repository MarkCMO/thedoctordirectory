/**
 * Scheduled (every 15 min) - system health monitor.
 * Logs to system_log; alerts admin if red flags detected.
 */
const { sb } = require('./db');
const { sendEvent } = require('./email-send');

exports.handler = async () => {
  const start = Date.now();
  const flags = {};

  try {
    // Supabase reachability
    const { error: e1 } = await sb().from('tenants').select('id').limit(1);
    flags.supabaseOk = !e1;

    // Pending queue sizes
    const { count: pendingEdits } = await sb().from('pending_listing_edits')
      .select('*', { count: 'exact', head: true }).eq('status', 'pending')
      .lt('created_at', new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString());
    flags.stalePendingEdits = pendingEdits || 0;

    const { count: stuckOpenTickets } = await sb().from('support_tickets')
      .select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress'])
      .lt('created_at', new Date(Date.now() - 48 * 3600 * 1000).toISOString());
    flags.stuckOpenTickets = stuckOpenTickets || 0;

    const { count: urgentTickets } = await sb().from('support_tickets')
      .select('*', { count: 'exact', head: true }).eq('status', 'open').eq('priority', 'urgent');
    flags.urgentTickets = urgentTickets || 0;

    // Errors in system_log last hour
    const { count: recentErrors } = await sb().from('system_log')
      .select('*', { count: 'exact', head: true }).eq('level', 'error')
      .gte('created_at', new Date(Date.now() - 3600 * 1000).toISOString());
    flags.recentErrors = recentErrors || 0;

    const alert = (flags.urgentTickets > 0) || (flags.recentErrors > 10) || (flags.stuckOpenTickets > 5) || !flags.supabaseOk;

    await sb().from('system_log').insert({
      source: 'admin-health-monitor',
      level: alert ? 'warn' : 'info',
      event: 'health_check',
      message: alert ? 'red flags detected' : 'healthy',
      duration_ms: Date.now() - start,
      meta: flags
    });

    if (alert) {
      try {
        const { data: t } = await sb().from('tenants').select('admin_email').eq('id', 'doctordir').single();
        await sendEvent({
          to: t?.admin_email || 'admin@thedoctordirectory.com',
          event: 'admin.health-alert',
          subject: '[Health Alert] The Doctor Directory - red flags',
          html: `<h3>System health alert</h3><pre>${JSON.stringify(flags, null, 2)}</pre>`
        });
      } catch (e) { console.error('health alert email:', e.message); }
    }

    return { statusCode: 200, body: JSON.stringify(flags) };
  } catch (e) {
    console.error('health monitor failed:', e.message);
    return { statusCode: 500, body: String(e.message) };
  }
};
