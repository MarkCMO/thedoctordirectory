-- ---------------------------------------------------------------------
-- REFERRALS (each claimed listing gets a unique referral code; tracked via cookie/URL)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.referral_codes (
  code            TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL DEFAULT 'doctordir',
  owner_slug      TEXT NOT NULL,                       -- listings.slug that earned the code
  owner_email     TEXT NOT NULL,
  clicks          INTEGER DEFAULT 0,
  signups         INTEGER DEFAULT 0,
  conversions     INTEGER DEFAULT 0,
  credit_earned_cents BIGINT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referral_owner ON doctordirectory.referral_codes (tenant_id, owner_slug);

CREATE TABLE IF NOT EXISTS doctordirectory.referral_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL DEFAULT 'doctordir',
  code            TEXT NOT NULL REFERENCES doctordirectory.referral_codes(code) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,                       -- click | signup | conversion
  referred_slug   TEXT,                                -- slug of the new listing (on signup/conversion)
  referred_email  TEXT,
  plan            TEXT,
  credit_cents    BIGINT DEFAULT 0,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referral_events_code ON doctordirectory.referral_events (code, created_at DESC);

ALTER TABLE doctordirectory.listings
  ADD COLUMN IF NOT EXISTS referred_by_code TEXT,
  ADD COLUMN IF NOT EXISTS account_credit_cents BIGINT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_listings_referred_by ON doctordirectory.listings (tenant_id, referred_by_code)
  WHERE referred_by_code IS NOT NULL;

GRANT SELECT ON doctordirectory.referral_codes TO anon, authenticated;
GRANT ALL ON doctordirectory.referral_codes TO service_role;
GRANT ALL ON doctordirectory.referral_events TO service_role;
