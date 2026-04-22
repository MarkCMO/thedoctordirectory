#!/usr/bin/env node
/**
 * One-time setup: creates 3 Square subscription plans (Premium, Elite, Sponsor)
 * via the Catalog API. Outputs plan variation IDs to paste as Netlify env vars.
 *
 * Run with:
 *   SQUARE_ACCESS_TOKEN=... SQUARE_ENV=sandbox node site/scripts/setup-square-plans.js
 */
const TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const ENV = (process.env.SQUARE_ENV || 'sandbox').toLowerCase();
const BASE = ENV === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';

if (!TOKEN) { console.error('Set SQUARE_ACCESS_TOKEN'); process.exit(1); }

const PLANS = [
  { key: 'PREMIUM', name: 'Premium',        amountCents: 4900,  description: 'Featured placement, verified badge, lead routing' },
  { key: 'ELITE',   name: 'Elite',          amountCents: 9900,  description: 'Premium + priority support, analytics, custom profile' },
  { key: 'SPONSOR', name: 'City Sponsor',   amountCents: 49900, description: 'Exclusive city-specialty sponsorship, top placement' }
];

async function sq(path, method, body) {
  const r = await fetch(BASE + path, {
    method, headers: {
      'Authorization': 'Bearer ' + TOKEN,
      'Content-Type': 'application/json',
      'Square-Version': '2024-12-18'
    }, body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('Square error:', JSON.stringify(data, null, 2)); throw new Error('failed'); }
  return data;
}

function uid() { return 'tdd-' + Math.random().toString(36).slice(2, 10); }

(async () => {
  console.log(`Creating plans in Square ${ENV.toUpperCase()}...\n`);
  const results = [];

  for (const p of PLANS) {
    // Create SUBSCRIPTION_PLAN (v2 style - contains variations for each billing cadence)
    const batchId = uid();
    const planTempId = '#plan-' + p.key;
    const variationTempId = '#variation-' + p.key;

    const body = {
      idempotency_key: batchId,
      batches: [{
        objects: [
          {
            type: 'SUBSCRIPTION_PLAN',
            id: planTempId,
            subscription_plan_data: {
              name: `The Doctor Directory - ${p.name}`,
              phases: [],
              subscription_plan_variations: [
                {
                  type: 'SUBSCRIPTION_PLAN_VARIATION',
                  id: variationTempId,
                  subscription_plan_variation_data: {
                    name: `${p.name} - Monthly`,
                    phases: [
                      {
                        cadence: 'MONTHLY',
                        periods: null,
                        pricing: {
                          type: 'STATIC',
                          price_money: { amount: p.amountCents, currency: 'USD' }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        ]
      }]
    };

    const res = await sq('/v2/catalog/batch-upsert', 'POST', body);
    const mapping = res.id_mappings || [];
    const planId = mapping.find(m => m.client_object_id === planTempId)?.object_id;
    const variationId = mapping.find(m => m.client_object_id === variationTempId)?.object_id;
    results.push({ key: p.key, name: p.name, amountCents: p.amountCents, planId, variationId });
    console.log(`  ${p.name}: plan=${planId}  variation=${variationId}`);
  }

  console.log('\n---\nAdd these Netlify env vars:\n');
  for (const r of results) {
    console.log(`SQUARE_PLAN_VARIATION_${r.key}=${r.variationId}`);
  }
  console.log('\nUse SQUARE_PLAN_VARIATION_* in /api/square-create-subscription.');
})();
