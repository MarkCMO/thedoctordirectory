-- ---------------------------------------------------------------------
-- REVIEWS (patient reviews of doctors, moderated)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL DEFAULT 'doctordir',
  slug            TEXT NOT NULL,                          -- references listings.slug
  reviewer_name   TEXT NOT NULL,
  reviewer_email  TEXT,
  rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title           TEXT,
  body            TEXT,
  verified_patient BOOLEAN DEFAULT FALSE,
  status          TEXT DEFAULT 'pending',                 -- pending | approved | rejected | flagged
  featured        BOOLEAN DEFAULT FALSE,
  admin_note      TEXT,
  ip_address      INET,
  user_agent      TEXT,
  moderated_by    TEXT,
  moderated_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reviews_slug ON doctordirectory.reviews (tenant_id, slug, status);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON doctordirectory.reviews (tenant_id, status, created_at DESC);

-- ---------------------------------------------------------------------
-- EMAIL TEMPLATES (optional store-backed templates; senders can fall back to inline)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.email_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL DEFAULT 'doctordir',
  key             TEXT NOT NULL,                          -- e.g. 'claim.verified', 'listing.edit-approved'
  subject         TEXT NOT NULL,
  html            TEXT NOT NULL,
  text            TEXT,
  description     TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  updated_by      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, key)
);
CREATE INDEX IF NOT EXISTS idx_email_templates_key ON doctordirectory.email_templates (tenant_id, key);

GRANT SELECT ON doctordirectory.reviews TO anon, authenticated;
GRANT ALL ON doctordirectory.reviews TO service_role;
GRANT ALL ON doctordirectory.email_templates TO service_role;
