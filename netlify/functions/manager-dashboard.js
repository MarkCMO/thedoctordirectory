/**
 * GET /api/manager-dashboard
 * Self-serve dashboard for sales-managers + general-managers.
 * Returns: manager stats, team roster (reps), team weekly contacts, team conversions, pending override payouts.
 */
const { sb } = require('./db');
const { resolveAuth, json } = require('./_auth');

const PLAN_MRR = { premium: 4900, elite: 9900, sponsor: 49900 };

exports.handler = async (event) => {
  const auth = await resolveAuth(event);
  if (auth.reject) return auth.reject;
  if (!['sales-manager', 'general-manager', 'super-admin'].includes(auth.role)) {
    return json(403, { error: 'manager role required' });
  }
  const tenantId = auth.tenantId || 'doctordir';
  const managerEmail = auth.email;

  // Manager stats row
  const { data: statsRow } = await sb().from('manager_stats').select('*').eq('manager_email', managerEmail).maybeSingle();

  // Team roster
  const { data: reps } = await sb().from('reps').select('*').eq('tenant_id', tenantId).eq('manager_email', managerEmail).eq('active', true);
  const repEmails = (reps || []).map(r => r.email);

  // Weekly contact totals per rep
  let contactsByRep = {};
  if (repEmails.length) {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: logs } = await sb().from('rep_contact_log').select('rep_email').eq('tenant_id', tenantId).gte('contacted_at', weekAgo).in('rep_email', repEmails);
    for (const l of (logs || [])) contactsByRep[l.rep_email] = (contactsByRep[l.rep_email] || 0) + 1;
  }

  // Conversions per rep (all-time via outreach.locked_rep)
  let convsByRep = {};
  let teamMrr = 0;
  let sponsorCount = 0;
  if (repEmails.length) {
    const { data: convs } = await sb().from('outreach').select('slug,locked_rep').eq('tenant_id', tenantId).eq('status', 'converted').in('locked_rep', repEmails);
    const slugsByRep = {};
    for (const c of (convs || [])) {
      if (!c.locked_rep) continue;
      convsByRep[c.locked_rep] = (convsByRep[c.locked_rep] || 0) + 1;
      (slugsByRep[c.locked_rep] = slugsByRep[c.locked_rep] || []).push(c.slug);
    }
    const allSlugs = [...new Set((convs || []).map(c => c.slug))];
    if (allSlugs.length) {
      const { data: listings } = await sb().from('listings').select('slug,plan,subscription_status').eq('tenant_id', tenantId).in('slug', allSlugs).in('subscription_status', ['active', 'trialing']);
      for (const l of (listings || [])) {
        teamMrr += PLAN_MRR[l.plan] || 0;
        if (l.plan === 'sponsor') sponsorCount++;
      }
    }
  }

  const roster = (reps || []).map(r => ({
    ...r, weeklyContacts: contactsByRep[r.email] || 0, conversions: convsByRep[r.email] || 0
  })).sort((a, b) => b.conversions - a.conversions);

  // Pending override payouts for this manager
  const { data: overrides } = await sb().from('manager_overrides').select('*').eq('manager_email', managerEmail).order('period_start', { ascending: false }).limit(12);

  return json(200, {
    manager: { email: managerEmail, role: auth.role },
    stats: {
      ...(statsRow || {}),
      team_book_mrr_cents: teamMrr,
      team_vested_sponsor_count: sponsorCount,
      repCount: (reps || []).length
    },
    roster,
    overrides: overrides || []
  });
};
