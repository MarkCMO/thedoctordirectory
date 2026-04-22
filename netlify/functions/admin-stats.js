/**
 * GET /api/admin-stats
 * Top-level dashboard metrics.
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { requirePermission, json } = require('./_auth');

const PLAN_CENTS = { premium: 9900, elite: 24900, sponsor: 49900 };

exports.handler = async (event) => {
  const auth = await requirePermission(event, 'listings.view');
  if (auth.reject) return auth.reject;

  let tenant;
  try { tenant = await resolveTenant(event); } catch { tenant = { id: 'doctordir' }; }

  const [
    { count: totalListings },
    { count: claimedListings },
    { count: premiumListings },
    { count: newLeadsToday },
    { count: openTickets },
    { count: pendingEdits },
    { count: pendingClaims },
    { count: pendingSubmissions }
  ] = await Promise.all([
    sb().from('listings').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id),
    sb().from('listings').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).not('claimed_at', 'is', null),
    sb().from('listings').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).neq('plan', 'free'),
    sb().from('leads').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).gte('created_at', new Date(Date.now() - 24 * 3600000).toISOString()),
    sb().from('support_tickets').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).in('status', ['open', 'in_progress']),
    sb().from('pending_listing_edits').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'pending'),
    sb().from('claims').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'pending'),
    sb().from('submissions').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'pending')
  ]);

  // MRR from paid listings
  const { data: paid } = await sb().from('listings').select('plan,billing_cycle')
    .eq('tenant_id', tenant.id).neq('plan', 'free').eq('status', 'active');
  let mrrCents = 0;
  (paid || []).forEach(l => {
    const price = PLAN_CENTS[l.plan] || 0;
    mrrCents += l.billing_cycle === 'annual' ? Math.round(price * 12 * 0.85 / 12) : price;
  });

  return json(200, {
    ok: true,
    stats: {
      totalListings: totalListings || 0,
      claimedListings: claimedListings || 0,
      premiumListings: premiumListings || 0,
      claimRate: totalListings ? ((claimedListings / totalListings) * 100).toFixed(1) : 0,
      mrrCents,
      mrrDollars: (mrrCents / 100).toFixed(2),
      arrDollars: (mrrCents * 12 / 100).toFixed(2),
      newLeadsToday: newLeadsToday || 0,
      openTickets: openTickets || 0,
      pendingEdits: pendingEdits || 0,
      pendingClaims: pendingClaims || 0,
      pendingSubmissions: pendingSubmissions || 0
    }
  });
};
