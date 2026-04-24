/**
 * GET /api/listing-completeness?slug=&accessToken=
 * Returns a checklist of profile-completeness suggestions for the owner.
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { json } = require('./_auth');

function scoreListing(l) {
  const checks = [
    { key: 'bio',        label: 'Write a bio (100+ chars)',           ok: (l.bio || '').length >= 100, weight: 15 },
    { key: 'phone',      label: 'Add a phone number',                 ok: !!l.phone,                   weight: 10 },
    { key: 'website',    label: 'Add a website URL',                  ok: !!l.website,                 weight: 8  },
    { key: 'address',    label: 'Complete your address',              ok: !!(l.address1 && l.city && l.state && l.zip), weight: 10 },
    { key: 'photos',     label: 'Upload at least 3 photos',           ok: Array.isArray(l.photos) && l.photos.length >= 3, weight: 15 },
    { key: 'conditions', label: 'List 3+ conditions you treat',       ok: Array.isArray(l.conditions) && l.conditions.length >= 3, weight: 10 },
    { key: 'board',      label: 'Add a board certification',          ok: Array.isArray(l.board_certs) && l.board_certs.length >= 1, weight: 8 },
    { key: 'hospitals',  label: 'Affiliated hospital(s)',             ok: Array.isArray(l.hospitals) && l.hospitals.length >= 1, weight: 7 },
    { key: 'years',      label: 'Years of experience',                ok: (l.years_exp || 0) > 0,      weight: 5 },
    { key: 'socials',    label: 'Link at least one social profile',   ok: l.socials && Object.values(l.socials).some(Boolean), weight: 5 },
    { key: 'reviews',    label: 'Collect 5+ patient reviews',         ok: (l.reviews || 0) >= 5,       weight: 7 }
  ];
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.filter(c => c.ok).reduce((s, c) => s + c.weight, 0);
  return { score: Math.round((got / total) * 100), checks };
}

exports.handler = async (event) => {
  const slug = event.queryStringParameters?.slug;
  const accessToken = event.queryStringParameters?.accessToken;
  if (!slug || !accessToken) return json(400, { error: 'slug + accessToken required' });

  let tenant;
  try { tenant = await resolveTenant(event); } catch { tenant = { id: 'doctordir' }; }

  const { data: listing } = await sb().from('listings').select('*')
    .eq('tenant_id', tenant.id).eq('slug', slug).eq('access_token', accessToken).single();
  if (!listing) return json(401, { error: 'invalid token' });

  const { score, checks } = scoreListing(listing);
  return json(200, { ok: true, score, checks });
};
