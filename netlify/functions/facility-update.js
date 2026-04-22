/**
 * POST /api/facility-update
 * Owner edits listing fields. Changes go to pending_listing_edits for admin approval.
 * body: {slug, accessToken, fields: {phone, website, bio, photos, socials, ...}}
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { json, getIp } = require('./_auth');
const { sendEvent } = require('./email-send');

const ALLOWED = new Set([
  'phone', 'website', 'bio', 'address1', 'city', 'state', 'zip',
  'photos', 'socials', 'will_travel', 'travel_fee',
  'conditions', 'awards', 'hospitals', 'board_certs'
]);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }

  const slug = String(body.slug || '');
  const accessToken = String(body.accessToken || '');
  const fields = body.fields || {};
  if (!slug || !accessToken) return json(400, { error: 'slug + accessToken required' });

  let tenant;
  try { tenant = await resolveTenant(event); }
  catch { return json(400, { error: 'unknown tenant' }); }

  const { data: listing } = await sb().from('listings').select('*')
    .eq('tenant_id', tenant.id).eq('slug', slug).eq('access_token', accessToken).single();
  if (!listing) return json(401, { error: 'invalid token' });

  // Filter to allowed fields + sanitize
  const proposed = {};
  const previous = {};
  const changed = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!ALLOWED.has(k)) continue;
    proposed[k] = v;
    previous[k] = listing[k];
    if (JSON.stringify(v) !== JSON.stringify(listing[k])) changed.push(k);
  }

  if (changed.length === 0) return json(400, { error: 'no changes' });

  // Insert into pending_listing_edits
  const { data: edit, error } = await sb().from('pending_listing_edits').insert({
    tenant_id: tenant.id, slug, submitted_by_email: listing.email || listing.claimed_by,
    proposed_fields: proposed, previous_fields: previous,
    changed_field_keys: changed, status: 'pending'
  }).select().single();

  if (error) { console.error('pending edit insert:', error); return json(500, { error: 'failed' }); }

  // Notify admin
  try {
    await sendEvent({
      to: tenant.admin_email, tenantId: tenant.id,
      event: 'admin.pending-edit',
      subject: `[${tenant.brand_name}] Edit pending for ${listing.name}`,
      html: `<p>Owner submitted edits.</p>
             <p><strong>Doctor:</strong> ${listing.name} (${slug})<br>
                <strong>Fields changed:</strong> ${changed.join(', ')}</p>
             <p><a href="https://${tenant.domain}/admin#pending-edits">Review in admin</a></p>`
    });
  } catch (e) { console.error('pending edit notify failed:', e.message); }

  return json(200, { ok: true, editId: edit.id, status: 'pending_approval', message: 'Changes submitted for review' });
};
