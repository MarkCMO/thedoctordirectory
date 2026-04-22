/**
 * One-click unsubscribe (RFC 8058).
 * GET: shows confirmation page
 * POST: adds to suppression list
 */
const { sb } = require('./db');

exports.handler = async (event) => {
  const email = String(
    event.queryStringParameters?.email || (event.body && new URLSearchParams(event.body).get('email')) || ''
  ).trim().toLowerCase();
  if (!email) {
    return { statusCode: 400, body: 'email required' };
  }

  if (event.httpMethod === 'POST') {
    await sb().from('email_suppressions').upsert({ email, reason: 'unsubscribe' }, { onConflict: 'email' });
    return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: `<h2>Unsubscribed</h2><p>${email} will no longer receive emails.</p>` };
  }

  // GET page with confirm button (which POSTs)
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribe</title>
<style>body{font-family:sans-serif;max-width:500px;margin:80px auto;padding:32px;background:#f7f5f0}
h2{color:#0b1a2f}.btn{background:#C8A45E;color:#0b1a2f;padding:12px 28px;border:none;border-radius:6px;font-weight:600;cursor:pointer;font-size:15px}
</style></head><body>
<h2>Unsubscribe</h2>
<p>Remove <strong>${email}</strong> from all EliteMD emails?</p>
<form method="POST"><input type="hidden" name="email" value="${email}">
<button class="btn" type="submit">Confirm Unsubscribe</button></form>
</body></html>`;
  return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: html };
};
