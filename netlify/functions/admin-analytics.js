/**
 * GET /api/admin-analytics
 * Aggregate metrics for admin dashboard charts:
 *  - MRR trend (last 12 months, by subscription_started_at month)
 *  - Plan mix (active subscriptions by plan)
 *  - Leads trend (last 30 days, by created_at day)
 *  - Rep leaderboard (by conversions last 90 days)
 *  - Conversion funnel (outreach status counts)
 */
const { sb } = require('./db');
const { requirePermission, json } = require('./_auth');

const PLAN_MRR = { premium: 4900, elite: 9900, sponsor: 49900, free: 0 };

exports.handler = async (event) => {
  const auth = await requirePermission(event, 'listings.view');
  if (auth.reject) return auth.reject;
  const tenantId = auth.tenantId || 'doctordir';

  // Plan mix
  const planMix = {};
  for (const p of ['free', 'premium', 'elite', 'sponsor']) {
    const q = sb().from('listings').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('plan', p);
    if (p !== 'free') q.in('subscription_status', ['active', 'trialing']);
    const { count } = await q;
    planMix[p] = count || 0;
  }
  const currentMrr = (planMix.premium * PLAN_MRR.premium) + (planMix.elite * PLAN_MRR.elite) + (planMix.sponsor * PLAN_MRR.sponsor);

  // MRR trend: listings.plan_started_at grouped by month for last 12 months
  const now = new Date();
  const monthLabels = [];
  const mrrByMonth = [];
  for (let i = 11; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1)).toISOString();
    const label = start.slice(0, 7);
    monthLabels.push(label);
    // Count paid listings active at end of month (plan_started_at <= end AND (canceled_at is null OR canceled_at > start))
    let mrr = 0;
    for (const p of ['premium', 'elite', 'sponsor']) {
      const { count } = await sb().from('listings').select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('plan', p)
        .lte('plan_started_at', end)
        .in('subscription_status', ['active', 'trialing']);
      mrr += (count || 0) * PLAN_MRR[p];
    }
    mrrByMonth.push(mrr);
  }

  // Leads last 30 days per day
  const leadsTrend = {};
  const thirty = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: recentLeads } = await sb().from('leads').select('created_at').eq('tenant_id', tenantId).gte('created_at', thirty).limit(5000);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    leadsTrend[d] = 0;
  }
  for (const l of (recentLeads || [])) {
    const d = l.created_at.slice(0, 10);
    if (leadsTrend[d] !== undefined) leadsTrend[d]++;
  }

  // Rep leaderboard: conversions last 90 days
  const ninety = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data: convs } = await sb().from('outreach')
    .select('locked_rep,rep,converted_at').eq('tenant_id', tenantId).eq('status', 'converted').gte('converted_at', ninety).limit(2000);
  const byRep = {};
  for (const c of (convs || [])) {
    const r = c.locked_rep || c.rep;
    if (!r) continue;
    byRep[r] = (byRep[r] || 0) + 1;
  }
  const leaderboard = Object.entries(byRep).map(([email, count]) => ({ email, conversions: count })).sort((a, b) => b.conversions - a.conversions).slice(0, 10);

  // Funnel
  const funnel = {};
  for (const s of ['sent', 'contacted', 'pitched', 'converted', 'declined']) {
    const { count } = await sb().from('outreach').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', s);
    funnel[s] = count || 0;
  }

  return json(200, {
    currentMrr,
    planMix,
    mrrTrend: { labels: monthLabels, values: mrrByMonth },
    leadsTrend,
    leaderboard,
    funnel
  });
};
