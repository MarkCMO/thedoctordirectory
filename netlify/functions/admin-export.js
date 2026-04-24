/**
 * GET /api/admin-export?type=leads|listings|reps|payouts|outreach|reviews
 * Returns CSV for download.
 */
const { sb } = require('./db');
const { resolveTenant } = require('./_tenant');
const { requirePermission, audit, getIp } = require('./_auth');

function toCsv(rows) {
  if (!rows || !rows.length) return '';
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const esc = v => {
    if (v == null) return '';
    if (typeof v === 'object') v = JSON.stringify(v);
    v = String(v);
    if (/[",\r\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  };
  const header = keys.join(',');
  const body = rows.map(r => keys.map(k => esc(r[k])).join(',')).join('\r\n');
  return header + '\r\n' + body;
}

function csvResponse(filename, csv) {
  return {
    statusCode: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`
    },
    body: csv
  };
}

exports.handler = async (event) => {
  const auth = await requirePermission(event, 'listings.view');
  if (auth.reject) return auth.reject;

  let tenant;
  try { tenant = await resolveTenant(event); } catch { tenant = { id: 'doctordir' }; }

  const type = event.queryStringParameters?.type || 'leads';
  const limit = Math.min(10000, parseInt(event.queryStringParameters?.limit, 10) || 5000);

  const tables = {
    leads: 'leads',
    listings: 'listings',
    reps: 'reps',
    payouts: 'rep_payouts',
    outreach: 'outreach',
    reviews: 'reviews',
    submissions: 'submissions'
  };
  const table = tables[type];
  if (!table) return { statusCode: 400, body: 'unknown type' };

  const { data, error } = await sb().from(table).select('*').eq('tenant_id', tenant.id).limit(limit);
  if (error) return { statusCode: 500, body: error.message };

  await audit(auth.email, 'export.' + type, 'export', type, { rows: (data || []).length }, getIp(event), tenant.id);

  const stamp = new Date().toISOString().slice(0, 10);
  return csvResponse(`${type}-${stamp}.csv`, toCsv(data || []));
};
