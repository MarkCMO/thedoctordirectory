/**
 * GET /api/facility-lookup?slug=X
 * Public lookup - returns listing name + claimed status (for claim flow UI).
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { json } = require('./_auth');

exports.handler = async (event) => {
  const slug = event.queryStringParameters?.slug;
  if (!slug) return json(400, { error: 'slug required' });

  let tenant;
  try { tenant = await resolveTenant(event); }
  catch { return json(400, { error: 'unknown tenant' }); }

  const { data } = await sb().from('listings')
    .select('slug,name,specialty,city,state,zip,email,plan,claimed_at')
    .eq('tenant_id', tenant.id).eq('slug', slug).single();
  if (!data) return json(404, { error: 'listing not found' });

  // Mask email for privacy - show only first char + domain
  let maskedEmail = null;
  if (data.email) {
    const [u, d] = data.email.split('@');
    maskedEmail = u ? `${u[0]}***@${d}` : null;
  }

  return json(200, {
    slug: data.slug, name: data.name, specialty: data.specialty,
    city: data.city, state: data.state, zip: data.zip,
    plan: data.plan, claimed: !!data.claimed_at,
    contactEmailMasked: maskedEmail
  });
};
