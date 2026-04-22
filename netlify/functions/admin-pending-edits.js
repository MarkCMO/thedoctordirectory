/**
 * GET  /api/admin-pending-edits   - list pending owner edits
 * POST /api/admin-pending-edits {id, action: 'approve'|'reject', note?}
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { requirePermission, audit, getIp, json } = require('./_auth');
const { sendEvent } = require('./email-send');

exports.handler = async (event) => {
  const auth = await requirePermission(event, 'listings.edit');
  if (auth.reject) return auth.reject;

  let tenant;
  try { tenant = await resolveTenant(event); } catch { tenant = { id: 'doctordir' }; }

  if (event.httpMethod === 'GET') {
    const { data, error } = await sb().from('pending_listing_edits').select('*')
      .eq('tenant_id', tenant.id).eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(200);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, edits: data || [] });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
    const { id, action, note } = body;
    if (!id || !['approve', 'reject'].includes(action)) return json(400, { error: 'id + approve|reject required' });

    const { data: edit } = await sb().from('pending_listing_edits').select('*')
      .eq('id', id).eq('tenant_id', tenant.id).single();
    if (!edit) return json(404, { error: 'not found' });

    if (action === 'approve') {
      // Apply fields to listing
      const update = { ...edit.proposed_fields };
      const { error: e1 } = await sb().from('listings').update(update)
        .eq('tenant_id', tenant.id).eq('slug', edit.slug);
      if (e1) return json(500, { error: e1.message });

      await sb().from('pending_listing_edits').update({
        status: 'approved', approved_at: new Date().toISOString(),
        approved_by: auth.email, admin_note: note || null
      }).eq('id', id);

      try {
        await sendEvent({
          to: edit.submitted_by_email, tenantId: tenant.id,
          event: 'listing.edit-approved',
          subject: `Your edits are live | ${tenant.brand_name}`,
          html: `<p>Your listing edits have been approved and are now live.</p>
                 <p>Fields updated: ${edit.changed_field_keys.join(', ')}</p>
                 ${note ? `<p>Admin note: ${note}</p>` : ''}`
        });
      } catch {}
    } else {
      await sb().from('pending_listing_edits').update({
        status: 'rejected', rejected_at: new Date().toISOString(),
        rejected_by: auth.email, admin_note: note || null
      }).eq('id', id);

      try {
        await sendEvent({
          to: edit.submitted_by_email, tenantId: tenant.id,
          event: 'listing.edit-rejected',
          subject: `Your edits need changes | ${tenant.brand_name}`,
          html: `<p>Your recent edits could not be approved.</p>
                 ${note ? `<p><strong>Reason:</strong> ${note}</p>` : ''}
                 <p>You can resubmit with corrections from your dashboard.</p>`
        });
      } catch {}
    }

    await audit(auth.email, 'pending-edit.' + action, 'listing', edit.slug, { changed: edit.changed_field_keys, note }, getIp(event), tenant.id);
    return json(200, { ok: true });
  }

  return json(405, { error: 'method not allowed' });
};
