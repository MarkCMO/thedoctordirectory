/**
 * Square API helper. Uses access token from env.
 * Env:
 *   SQUARE_ACCESS_TOKEN  - required
 *   SQUARE_ENV           - "sandbox" or "production" (default sandbox)
 */
const TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const ENV = (process.env.SQUARE_ENV || 'sandbox').toLowerCase();
const BASE = ENV === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';

async function sq(path, method = 'GET', body = null) {
  if (!TOKEN) throw new Error('SQUARE_ACCESS_TOKEN not configured');
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + TOKEN,
      'Content-Type': 'application/json',
      'Square-Version': '2024-12-18',
      'Accept': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.errors?.[0]?.detail || data?.errors?.[0]?.code || `HTTP ${r.status}`;
    const err = new Error(msg); err.squareErrors = data.errors; err.status = r.status; throw err;
  }
  return data;
}

module.exports = { sq, ENV, BASE };
