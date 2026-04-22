/**
 * Admin payout runs.
 * GET  /api/admin-payouts?period=YYYY-MM-01   - list payouts for a period (default current month)
 * POST /api/admin-payouts                     - actions:
 *   { action: 'generate', period: 'YYYY-MM-01' }       - calculate + insert pending payouts for all active reps
 *   { action: 'approve',  id }                         - mark payout approved
 *   { action: 'markPaid', id, achReference? }          - mark paid + record reference
 *   { action: 'skip',     id, reason? }                - skip this payout (e.g. clawback covers it)
 */
const { sb } = require('./db');
const { requirePermission, audit, getIp, json } = require('./_auth');

function firstOfMonth(d) {
  const dt = d ? new Date(d) : new Date();
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

exports.handler = async (event) => {
  const auth = await requirePermission(event, 'payouts.view');
  if (auth.reject) return auth.reject;

  const tenantId = auth.tenantId || 'doctordir';
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    const period = qs.period || firstOfMonth();
    const { data: payouts } = await sb().from('rep_payouts')
      .select('*').eq('tenant_id', tenantId).eq('period_start', period)
      .order('net_cents', { ascending: false }).limit(500);

    // Enrich with rep name/email
    const repIds = [...new Set((payouts || []).map(p => p.rep_id))];
    let repsByIdMap = {};
    if (repIds.length) {
      const { data: reps } = await sb().from('reps').select('id,name,email,commission_tier,payment_method,payout_handle').in('id', repIds);
      for (const r of (reps || [])) repsByIdMap[r.id] = r;
    }
    const enriched = (payouts || []).map(p => ({ ...p, rep: repsByIdMap[p.rep_id] || null }));

    const totals = enriched.reduce((a, p) => {
      a.gross += p.gross_mrr_cents || 0;
      a.net += p.net_cents || 0;
      a.clawback += p.clawback_cents || 0;
      a.count++;
      a.pending += (p.status === 'pending' || p.status === 'approved') ? (p.net_cents || 0) : 0;
      a.paid += p.status === 'paid' ? (p.net_cents || 0) : 0;
      return a;
    }, { gross: 0, net: 0, clawback: 0, count: 0, pending: 0, paid: 0 });

    return json(200, { period, payouts: enriched, totals });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  const authEdit = await requirePermission(event, 'payouts.edit');
  if (authEdit.reject) return authEdit.reject;

  let body; try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
  const action = body.action;

  if (action === 'generate') {
    const period = body.period || firstOfMonth();

    // Get all active reps
    const { data: reps } = await sb().from('reps').select('*').eq('tenant_id', tenantId).eq('active', true);
    if (!reps?.length) return json(200, { ok: true, created: 0, message: 'no active reps' });

    let created = 0;
    for (const rep of reps) {
      // Skip if payout already exists for this period
      const { data: existing } = await sb().from('rep_payouts').select('id').eq('rep_id', rep.id).eq('period_start', period).maybeSingle();
      if (existing) continue;

      // Gross = sum of MRR on paid listings where outreach.locked_rep = rep.email
      const { data: lockedOutreach } = await sb().from('outreach')
        .select('slug').eq('tenant_id', tenantId).eq('locked_rep', rep.email).eq('status', 'converted');
      const slugs = (lockedOutreach || []).map(o => o.slug).filter(Boolean);

      const PLAN_MRR = { premium: 4900, elite: 9900, sponsor: 49900 };
      let grossMrr = 0;
      const lineItems = [];
      if (slugs.length) {
        const { data: listings } = await sb().from('listings')
          .select('slug,name,plan,subscription_status')
          .eq('tenant_id', tenantId).in('slug', slugs).in('subscription_status', ['active', 'trialing']);
        for (const l of (listings || [])) {
          const mrr = PLAN_MRR[l.plan] || 0;
          grossMrr += mrr;
          lineItems.push({ slug: l.slug, name: l.name, plan: l.plan, mrr_cents: mrr });
        }
      }

      const tier = rep.commission_tier || 30;
      const net = Math.floor(grossMrr * tier / 100);

      await sb().from('rep_payouts').insert({
        tenant_id: tenantId, rep_id: rep.id, period_start: period,
        gross_mrr_cents: grossMrr, clawback_cents: 0, net_cents: net, tier_pct: tier,
        status: 'pending', line_items: lineItems
      });
      created++;
    }

    await audit(auth.email, 'payouts.generated', 'payout_run', period, { created }, getIp(event), tenantId);
    return json(200, { ok: true, created, period });
  }

  if (action === 'approve') {
    await sb().from('rep_payouts').update({ status: 'approved' }).eq('id', body.id);
    await audit(auth.email, 'payouts.approved', 'payout', body.id, {}, getIp(event), tenantId);
    return json(200, { ok: true });
  }

  if (action === 'markPaid') {
    await sb().from('rep_payouts').update({
      status: 'paid', paid_at: new Date().toISOString(),
      ach_reference: String(body.achReference || '').slice(0, 200)
    }).eq('id', body.id);
    await audit(auth.email, 'payouts.paid', 'payout', body.id, { achReference: body.achReference }, getIp(event), tenantId);
    return json(200, { ok: true });
  }

  if (action === 'skip') {
    await sb().from('rep_payouts').update({
      status: 'skipped', ach_reference: 'SKIPPED: ' + String(body.reason || '').slice(0, 180)
    }).eq('id', body.id);
    await audit(auth.email, 'payouts.skipped', 'payout', body.id, { reason: body.reason }, getIp(event), tenantId);
    return json(200, { ok: true });
  }

  return json(400, { error: 'unknown action' });
};
