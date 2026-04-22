/**
 * Supabase client factory.
 * All functions import { sb } from './db'; to get a service-role client
 * scoped to the doctordirectory schema.
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

let _sb = null;
function sb() {
  if (_sb) return _sb;
  _sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: 'doctordirectory' }
  });
  return _sb;
}

/** Raw client in public schema (for tenants, cross-schema queries). */
function sbPublic() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

module.exports = { sb, sbPublic };
