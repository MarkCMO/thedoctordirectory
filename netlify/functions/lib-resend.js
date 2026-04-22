/**
 * Resend API wrapper. Thin.
 */
const RESEND_API_KEY = process.env.RESEND_API_KEY;

async function resendSend({ from, to, subject, html, text, replyTo, headers = {} }) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');
  const body = { from, to: Array.isArray(to) ? to : [to], subject, html };
  if (text) body.text = text;
  if (replyTo) body.reply_to = replyTo;
  if (headers && Object.keys(headers).length) body.headers = headers;

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Resend ${resp.status}: ${data?.message || 'unknown'}`);
  }
  return data;
}

module.exports = { resendSend };
