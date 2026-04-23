/**
 * GET /api/admin-bootstrap
 * Returns everything admin panel needs on first load:
 * auth info, stats, recent audit log preview.
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { resolveAuth, DEFAULT_PERMISSIONS, json } = require('./_auth');

exports.handler = async (event) => {
  const auth = await resolveAuth(event);
  if (auth.reject) return auth.reject;

  let tenant;
  try { tenant = await resolveTenant(event); } catch { tenant = { id: 'doctordir', brand_name: 'The Doctor Directory' }; }

  // Count pending items across moderation queues
  const [
    { count: pendingEdits },
    { count: pendingClaims },
    { count: pendingSubmissions },
    { count: openTickets },
    { count: newLeads },
    { count: pendingRepApps },
    { count: pendingLeadRequests },
    { count: pendingReviews }
  ] = await Promise.all([
    sb().from('pending_listing_edits').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'pending'),
    sb().from('claims').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'pending'),
    sb().from('submissions').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'pending'),
    sb().from('support_tickets').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).in('status', ['open', 'in_progress']),
    sb().from('leads').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'new'),
    sb().from('rep_applications').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'submitted'),
    sb().from('rep_lead_requests').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'pending'),
    sb().from('reviews').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'pending').then(r => r, () => ({ count: 0 }))
  ]);

  const permissions = [...(auth.permissions || []), ...(DEFAULT_PERMISSIONS[auth.role] || [])];

  return json(200, {
    ok: true,
    user: { email: auth.email, role: auth.role, permissions: [...new Set(permissions)] },
    tenant: { id: tenant.id, brand_name: tenant.brand_name, domain: tenant.domain },
    badges: {
      pendingEdits: pendingEdits || 0,
      pendingClaims: pendingClaims || 0,
      pendingSubmissions: pendingSubmissions || 0,
      openTickets: openTickets || 0,
      newLeads: newLeads || 0,
      pendingRepApps: pendingRepApps || 0,
      pendingLeadRequests: pendingLeadRequests || 0,
      pendingReviews: pendingReviews || 0
    }
  });
};
