/**
 * GET /sitemap-doctors.xml
 * Dynamic sitemap of all active doctor listings.
 * Netlify redirect /sitemap-doctors.xml -> /.netlify/functions/sitemap-doctors
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');

exports.handler = async (event) => {
  let tenant;
  try { tenant = await resolveTenant(event); } catch { tenant = { id: 'doctordir', domain: 'thedoctordirectory.com' }; }
  const host = tenant.domain || 'thedoctordirectory.com';

  // paginate in chunks of 1000 for large directories
  const all = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data } = await sb().from('listings')
      .select('slug,updated_at,plan').eq('tenant_id', tenant.id).eq('status', 'active')
      .range(from, from + pageSize - 1);
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
    if (all.length > 50000) break; // sitemap spec cap
  }

  const urls = all.map(l => {
    const priority = l.plan === 'sponsor' ? '1.0' : l.plan === 'elite' ? '0.9' : l.plan === 'premium' ? '0.8' : '0.5';
    const lastmod = (l.updated_at || new Date().toISOString()).split('T')[0];
    return `  <url><loc>https://${host}/doctors/${l.slug}</loc><lastmod>${lastmod}</lastmod><priority>${priority}</priority></url>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' },
    body: xml
  };
};
