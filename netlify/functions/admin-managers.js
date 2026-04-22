/**
 * Admin managers dashboard.
 * GET  /api/admin-managers                          - list managers from admin_users (role in sales-manager|general-manager) with team stats
 * GET  /api/admin-managers?overrides=1&period=...   - list manager_overrides for a period
 * POST /api/admin-managers                          - actions:
 *   { action: 'recompute', managerEmail? }          - recalc team_book_mrr_cents + vested sponsor count
 *   { action: 'setTier',   managerEmail, tier, overridePct }
 *   { action: 'generateOverrides', period }         - create override payouts for all managers for period
 *   { action: 'markOverridePaid', id, achReference? }
 *   { action: 'assignRep', managerEmail, repEmail } - sets reps.manager_email
 */
const { sb } = require('./db');
const { requirePermission, audit, getIp, json } = require('./_auth');

function firstOfMonth(d) {
  const dt = d ? new Date(d) : new Date();
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

async function recomputeManagerStats(tenantId, managerEmail) {
  // Find reps under this manager
  const { data: reps } = await sb().from('reps').select('id,email,commission_tier,highest_tier_reached').eq('tenant_id', tenantId).eq('manager_email', managerEmail);
  if (!reps?.length) {
    await sb().from('manager_stats').upsert({
      manager_email: managerEmail, tenant_id: tenantId,
      team_book_mrr_cents: 0, team_vested_sponsor_count: 0,
      last_recompute_at: new Date().toISOString()
    }, { onConflict: 'manager_email' });
    return { teamBookMrr: 0, vestedSponsors: 0, repCount: 0 };
  }

  // Sum MRR from listings locked to these reps via outreach.locked_rep
  const repEmails = reps.map(r => r.email);
  const { data: lockedOutreach } = await sb().from('outreach')
    .select('slug,locked_rep').eq('tenant_id', tenantId).eq('status', 'converted').in('locked_rep', repEmails);
  const slugs = [...new Set((lockedOutreach || []).map(o => o.slug))];

  const PLAN_MRR = { premium: 4900, elite: 9900, sponsor: 49900 };
  let teamBookMrr = 0;
  let sponsorCount = 0;
  if (slugs.length) {
    const { data: listings } = await sb().from('listings')
      .select('slug,plan,subscription_status').eq('tenant_id', tenantId).in('slug', slugs).in('subscription_status', ['active', 'trialing']);
    for (const l of (listings || [])) {
      teamBookMrr += PLAN_MRR[l.plan] || 0;
      if (l.plan === 'sponsor') sponsorCount++;
    }
  }

  await sb().from('manager_stats').upsert({
    manager_email: managerEmail, tenant_id: tenantId,
    team_book_mrr_cents: teamBookMrr, team_vested_sponsor_count: sponsorCount,
    last_recompute_at: new Date().toISOString()
  }, { onConflict: 'manager_email' });

  return { teamBookMrr, vestedSponsors: sponsorCount, repCount: reps.length };
}

exports.handler = async (event) => {
  const auth = await requirePermission(event, 'reps.view');
  if (auth.reject) return auth.reject;
  const tenantId = auth.tenantId || 'doctordir';
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    if (qs.overrides) {
      const period = qs.period || firstOfMonth();
      const { data } = await sb().from('manager_overrides').select('*').eq('tenant_id', tenantId).eq('period_start', period).order('total_override_cents', { ascending: false });
      return json(200, { period, overrides: data || [] });
    }

    // List managers = admin_users with manager roles
    const { data: admins } = await sb().from('admin_users').select('email,name,role,active').in('role', ['sales-manager', 'general-manager']).eq('active', true);
    const emails = (admins || []).map(a => a.email);
    let statsByEmail = {};
    if (emails.length) {
      const { data: ms } = await sb().from('manager_stats').select('*').in('manager_email', emails);
      for (const m of (ms || [])) statsByEmail[m.manager_email] = m;
      // Rep counts
      const { data: repsForMgr } = await sb().from('reps').select('manager_email').eq('tenant_id', tenantId).eq('active', true).in('manager_email', emails);
      const repCount = {};
      for (const r of (repsForMgr || [])) repCount[r.manager_email] = (repCount[r.manager_email] || 0) + 1;
      for (const e of emails) {
        statsByEmail[e] = { ...(statsByEmail[e] || {}), repCount: repCount[e] || 0 };
      }
    }
    const enriched = (admins || []).map(a => ({ ...a, stats: statsByEmail[a.email] || { team_book_mrr_cents: 0, team_vested_sponsor_count: 0, repCount: 0 } }));
    return json(200, { managers: enriched });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  const authEdit = await requirePermission(event, 'reps.edit');
  if (authEdit.reject) return authEdit.reject;

  let body; try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
  const action = body.action;

  if (action === 'recompute') {
    if (body.managerEmail) {
      const r = await recomputeManagerStats(tenantId, body.managerEmail);
      return json(200, { ok: true, ...r });
    }
    const { data: admins } = await sb().from('admin_users').select('email').in('role', ['sales-manager', 'general-manager']).eq('active', true);
    let total = 0;
    for (const a of (admins || [])) { await recomputeManagerStats(tenantId, a.email); total++; }
    await audit(auth.email, 'manager.recomputed-all', 'manager_stats', 'all', { total }, getIp(event), tenantId);
    return json(200, { ok: true, total });
  }

  if (action === 'setTier') {
    const tier = parseInt(body.tier, 10);
    const overridePct = parseInt(body.overridePct, 10);
    if (!body.managerEmail || isNaN(tier) || isNaN(overridePct)) return json(400, { error: 'managerEmail, tier, overridePct required' });
    await sb().from('manager_stats').upsert({
      manager_email: body.managerEmail, tenant_id: tenantId,
      tier, override_pct: overridePct, tier_locked_at: new Date().toISOString()
    }, { onConflict: 'manager_email' });
    await audit(auth.email, 'manager.tier-set', 'manager_stats', body.managerEmail, { tier, overridePct }, getIp(event), tenantId);
    return json(200, { ok: true });
  }

  if (action === 'assignRep') {
    if (!body.managerEmail || !body.repEmail) return json(400, { error: 'managerEmail and repEmail required' });
    await sb().from('reps').update({ manager_email: body.managerEmail }).eq('tenant_id', tenantId).eq('email', body.repEmail);
    await audit(auth.email, 'manager.rep-assigned', 'rep', body.repEmail, { managerEmail: body.managerEmail }, getIp(event), tenantId);
    return json(200, { ok: true });
  }

  if (action === 'generateOverrides') {
    const period = body.period || firstOfMonth();
    const { data: admins } = await sb().from('admin_users').select('email').in('role', ['sales-manager', 'general-manager']).eq('active', true);
    let created = 0;
    for (const a of (admins || [])) {
      const { data: existing } = await sb().from('manager_overrides').select('id').eq('manager_email', a.email).eq('period_start', period).maybeSingle();
      if (existing) continue;

      await recomputeManagerStats(tenantId, a.email);
      const { data: stats } = await sb().from('manager_stats').select('*').eq('manager_email', a.email).single();
      const pct = stats?.override_pct || 5;
      const override = Math.floor((stats?.team_book_mrr_cents || 0) * pct / 100);

      await sb().from('manager_overrides').insert({
        tenant_id: tenantId, manager_email: a.email, period_start: period,
        total_override_cents: override,
        line_items: { team_book_mrr_cents: stats?.team_book_mrr_cents || 0, override_pct: pct, tier: stats?.tier || 1 },
        status: 'pending'
      });
      created++;
    }
    await audit(auth.email, 'manager.overrides-generated', 'manager_override', period, { created }, getIp(event), tenantId);
    return json(200, { ok: true, created, period });
  }

  if (action === 'markOverridePaid') {
    await sb().from('manager_overrides').update({
      status: 'paid', paid_at: new Date().toISOString()
    }).eq('id', body.id);
    await audit(auth.email, 'manager.override-paid', 'manager_override', body.id, { achReference: body.achReference }, getIp(event), tenantId);
    return json(200, { ok: true });
  }

  return json(400, { error: 'unknown action' });
};
