/**
 * GET /api/rep-statement?period=YYYY-MM-01
 * Rep self-serve commission statement: listings converted, payout breakdown,
 * clawbacks, cumulative stats.
 */
const { sb } = require('./db');
const { resolveAuth, json } = require('./_auth');

const PLAN_MRR = { premium: 4900, elite: 9900, sponsor: 49900 };

exports.handler = async (event) => {
  const auth = await resolveAuth(event);
  if (auth.reject) return auth.reject;
  if (!['sales-associate', 'sales-manager', 'general-manager', 'super-admin'].includes(auth.role)) {
    return json(403, { error: 'rep role required' });
  }
  const tenantId = auth.tenantId || 'doctordir';
  const email = auth.email;
  const period = event.queryStringParameters?.period || new Date().toISOString().slice(0, 7) + '-01';

  const { data: rep } = await sb().from('reps').select('*').eq('tenant_id', tenantId).eq('email', email).single();
  if (!rep) return json(404, { error: 'rep not found' });

  // Converted outreach locked to this rep
  const { data: locked } = await sb().from('outreach')
    .select('slug,first_contacted_at,locked_at,status,locked_rep')
    .eq('tenant_id', tenantId).eq('locked_rep', email).eq('status', 'converted');

  const slugs = (locked || []).map(o => o.slug);
  let items = [];
  let totalMrr = 0;
  if (slugs.length) {
    const { data: listings } = await sb().from('listings')
      .select('slug,name,plan,subscription_status,claimed_at')
      .eq('tenant_id', tenantId).in('slug', slugs);
    for (const l of (listings || [])) {
      const mrr = PLAN_MRR[l.plan] || 0;
      const active = ['active', 'trialing'].includes(l.subscription_status);
      items.push({
        slug: l.slug, name: l.name, plan: l.plan,
        subscription_status: l.subscription_status,
        claimed_at: l.claimed_at,
        mrr_cents: active ? mrr : 0,
        commission_cents: active ? Math.floor(mrr * (rep.commission_tier || 30) / 100) : 0
      });
      if (active) totalMrr += mrr;
    }
  }

  const projectedCommission = Math.floor(totalMrr * (rep.commission_tier || 30) / 100);

  // Period-specific payout
  const { data: payout } = await sb().from('rep_payouts')
    .select('*').eq('rep_id', rep.id).eq('period_start', period).maybeSingle();

  // Cumulative history
  const { data: history } = await sb().from('rep_payouts')
    .select('period_start,gross_cents,net_cents,clawback_cents,status,paid_at')
    .eq('rep_id', rep.id).order('period_start', { ascending: false }).limit(12);

  return json(200, {
    rep: {
      email: rep.email, name: rep.name, tier: rep.commission_tier,
      vested_sponsor_count: rep.vested_sponsor_count || 0,
      manager_email: rep.manager_email
    },
    period,
    items: items.sort((a, b) => b.commission_cents - a.commission_cents),
    totals: {
      active_conversions: items.filter(i => i.mrr_cents > 0).length,
      total_conversions: items.length,
      team_book_mrr_cents: totalMrr,
      projected_monthly_commission_cents: projectedCommission
    },
    period_payout: payout || null,
    history: history || []
  });
};
