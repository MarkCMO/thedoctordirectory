/**
 * GET /api/square-config
 * Returns the Square public application_id + location_id + environment so the
 * browser Web Payments SDK can initialize. No secrets returned.
 */
const { json } = require('./_auth');

exports.handler = async () => {
  return json(200, {
    applicationId: process.env.SQUARE_APPLICATION_ID || '',
    locationId: process.env.SQUARE_LOCATION_ID || '',
    environment: (process.env.SQUARE_ENV || 'sandbox').toLowerCase(),
    plans: [
      { key: 'PREMIUM', name: 'Premium',      amountCents: 4900,  variationId: process.env.SQUARE_PLAN_VARIATION_PREMIUM || '' },
      { key: 'ELITE',   name: 'Elite',        amountCents: 9900,  variationId: process.env.SQUARE_PLAN_VARIATION_ELITE   || '' },
      { key: 'SPONSOR', name: 'City Sponsor', amountCents: 49900, variationId: process.env.SQUARE_PLAN_VARIATION_SPONSOR || '' }
    ]
  });
};
