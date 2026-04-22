-- =====================================================================
-- THE DOCTOR DIRECTORY - INITIAL SCHEMA
-- Schema: doctordirectory
-- Apply via: Supabase SQL Editor (paste entire file)
-- Idempotent: safe to rerun
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS doctordirectory;
SET search_path = doctordirectory, public;

-- ---------------------------------------------------------------------
-- TENANTS (umbrella-ready from day one)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.tenants (
  id              TEXT PRIMARY KEY,
  domain          TEXT UNIQUE NOT NULL,
  brand_name      TEXT NOT NULL,
  legal_entity    TEXT NOT NULL DEFAULT 'WETYR Corp',
  vertical        TEXT NOT NULL,
  primary_color   TEXT DEFAULT '#C8A45E',
  logo_url        TEXT,
  tagline         TEXT,
  categories      JSONB,
  plan_pricing    JSONB,
  square_location_id TEXT,
  square_plan_ids JSONB,
  governing_state TEXT NOT NULL DEFAULT 'Florida',
  from_email      TEXT NOT NULL,
  admin_email     TEXT NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO doctordirectory.tenants (id, domain, brand_name, vertical, from_email, admin_email, tagline, primary_color)
VALUES ('doctordir', 'thedoctordirectory.com', 'The Doctor Directory', 'healthcare',
        'hello@thedoctordirectory.com', 'admin@thedoctordirectory.com',
        'Find the World''s Best Doctors', '#C8A45E')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- LISTINGS (doctors)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.listings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               TEXT NOT NULL DEFAULT 'doctordir' REFERENCES doctordirectory.tenants(id),
  slug                    TEXT NOT NULL,
  npi                     TEXT,
  name                    TEXT NOT NULL,
  first_name              TEXT,
  last_name               TEXT,
  credential              TEXT,
  gender                  TEXT,
  specialty               TEXT,
  sub_specialty           TEXT,
  categories              TEXT[] DEFAULT '{}',
  conditions              TEXT[] DEFAULT '{}',
  address1                TEXT,
  city                    TEXT,
  state                   TEXT,
  state_code              TEXT,
  zip                     TEXT,
  county                  TEXT,
  phone                   TEXT,
  email                   TEXT,
  website                 TEXT,
  bio                     TEXT,
  years_exp               INT,
  rating                  NUMERIC(3,2),
  peer_rating             NUMERIC(3,2),
  reviews                 INT DEFAULT 0,
  publications            INT DEFAULT 0,
  patents                 INT DEFAULT 0,
  surgeries               INT DEFAULT 0,
  board_certs             TEXT[] DEFAULT '{}',
  awards                  TEXT[] DEFAULT '{}',
  hospitals               TEXT[] DEFAULT '{}',
  will_travel             BOOLEAN DEFAULT false,
  travel_fee              TEXT,
  featured                BOOLEAN DEFAULT false,
  photos                  JSONB DEFAULT '[]',
  socials                 JSONB DEFAULT '{}',
  backlinks               JSONB DEFAULT '{}',
  -- Subscription / plan
  plan                    TEXT DEFAULT 'free',           -- free | premium | elite | sponsor
  billing_cycle           TEXT,                           -- monthly | annual
  status                  TEXT DEFAULT 'active',          -- active | suspended | archived
  subscription_status     TEXT,
  last_payment_status     TEXT,
  square_customer_id      TEXT,
  square_subscription_id  TEXT,
  plan_started_at         TIMESTAMPTZ,
  account_credit_cents    BIGINT DEFAULT 0,
  -- Owner claim
  claimed_at              TIMESTAMPTZ,
  claimed_by              TEXT,
  access_token            UUID,
  password_hash           TEXT,
  -- CRM / POC
  crm_status              TEXT DEFAULT 'cold',            -- cold | contacted | pitched | converted | declined
  last_contact_at         TIMESTAMPTZ,
  poc_name                TEXT,
  poc_title               TEXT,
  poc_phone               TEXT,
  poc_email               TEXT,
  poc_best_time           TEXT,
  poc_notes               TEXT,
  poc_updated_at          TIMESTAMPTZ,
  poc_updated_by          TEXT,
  -- Provenance
  source                  TEXT DEFAULT 'npi_registry',
  scraped_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, slug),
  UNIQUE (tenant_id, npi)
);
CREATE INDEX IF NOT EXISTS idx_listings_tenant_city  ON doctordirectory.listings (tenant_id, city);
CREATE INDEX IF NOT EXISTS idx_listings_tenant_state ON doctordirectory.listings (tenant_id, state);
CREATE INDEX IF NOT EXISTS idx_listings_tenant_specialty ON doctordirectory.listings (tenant_id, specialty);
CREATE INDEX IF NOT EXISTS idx_listings_tenant_plan  ON doctordirectory.listings (tenant_id, plan);
CREATE INDEX IF NOT EXISTS idx_listings_tenant_claimed ON doctordirectory.listings (tenant_id, claimed_at);
CREATE INDEX IF NOT EXISTS idx_listings_crm_status   ON doctordirectory.listings (tenant_id, crm_status);
CREATE INDEX IF NOT EXISTS idx_listings_email        ON doctordirectory.listings (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listings_zip          ON doctordirectory.listings (tenant_id, zip) WHERE zip IS NOT NULL;

-- ---------------------------------------------------------------------
-- OUTREACH (CRM pipeline) - one row per listing being worked
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.outreach (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            TEXT NOT NULL DEFAULT 'doctordir' REFERENCES doctordirectory.tenants(id),
  slug                 TEXT NOT NULL,
  facility_name        TEXT,
  rep                  TEXT,                          -- rep email (current owner)
  locked_rep           TEXT,                          -- permanent rep attribution (set on conversion)
  status               TEXT DEFAULT 'sent',           -- sent | contacted | pitched | converted | declined
  first_contacted_at   TIMESTAMPTZ,
  converted_at         TIMESTAMPTZ,
  rep_claimed_at       TIMESTAMPTZ,
  assigned_to_rep_at   TIMESTAMPTZ,
  commission_percent   INT DEFAULT 30,
  payout_cycle         TEXT DEFAULT 'monthly',
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_outreach_rep        ON doctordirectory.outreach (tenant_id, rep);
CREATE INDEX IF NOT EXISTS idx_outreach_locked_rep ON doctordirectory.outreach (tenant_id, locked_rep);
CREATE INDEX IF NOT EXISTS idx_outreach_status     ON doctordirectory.outreach (tenant_id, status);

-- ---------------------------------------------------------------------
-- LEADS (inbound inquiries from doctor pages)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.leads (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      TEXT NOT NULL DEFAULT 'doctordir' REFERENCES doctordirectory.tenants(id),
  slug           TEXT NOT NULL,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  phone          TEXT,
  condition      TEXT,
  location       TEXT,                          -- patient location for travel requests
  preferred_dates TEXT,
  message        TEXT,
  inquiry_type   TEXT DEFAULT 'inquiry',        -- inquiry | consultation | travel
  status         TEXT DEFAULT 'new',            -- new | responded | scheduled | closed
  sales_rep      TEXT,
  responded_at   TIMESTAMPTZ,
  notes          TEXT,
  ip_address     INET,
  user_agent     TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leads_slug   ON doctordirectory.leads (tenant_id, slug);
CREATE INDEX IF NOT EXISTS idx_leads_status ON doctordirectory.leads (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_email  ON doctordirectory.leads (email);

-- ---------------------------------------------------------------------
-- REPS (sales associates)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.reps (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               TEXT NOT NULL DEFAULT 'doctordir' REFERENCES doctordirectory.tenants(id),
  name                    TEXT NOT NULL,
  email                   TEXT NOT NULL,
  active                  BOOLEAN NOT NULL DEFAULT true,
  commission_tier         INT DEFAULT 30,           -- 30 | 35 | 40 | 45 | 50
  vested_city_sponsors    INT DEFAULT 0,
  highest_tier_reached    INT DEFAULT 30,
  manager_email           TEXT,
  payout_method           TEXT,                      -- ach | paypal | check
  payout_handle           TEXT,                      -- bank_last4 or email
  session_token           UUID DEFAULT gen_random_uuid(),
  application_id          UUID,
  preferred_categories    TEXT[] DEFAULT '{}',
  daily_lead_quota        INT DEFAULT 25,
  start_date              DATE,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_reps_active  ON doctordirectory.reps (tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_reps_manager ON doctordirectory.reps (tenant_id, manager_email);

-- ---------------------------------------------------------------------
-- REP CONTACT LOG (immutable)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.rep_contact_log (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     TEXT NOT NULL DEFAULT 'doctordir',
  rep_id        UUID,
  rep_email     TEXT NOT NULL,
  slug          TEXT NOT NULL,
  channel       TEXT NOT NULL,              -- call | email | sms | voicemail | contact-update
  notes         TEXT,
  contacted_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contact_log_rep  ON doctordirectory.rep_contact_log (tenant_id, rep_email, contacted_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_log_slug ON doctordirectory.rep_contact_log (tenant_id, slug, contacted_at DESC);

-- ---------------------------------------------------------------------
-- REP TIER HISTORY
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.rep_tier_history (
  id                             BIGSERIAL PRIMARY KEY,
  tenant_id                      TEXT NOT NULL DEFAULT 'doctordir',
  rep_id                         UUID NOT NULL,
  previous_tier                  INT,
  new_tier                       INT NOT NULL,
  vested_city_sponsors_at_bump   INT,
  reason                         TEXT,
  is_permanent_lock              BOOLEAN DEFAULT false,
  created_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- REP PAYOUTS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.rep_payouts (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       TEXT NOT NULL DEFAULT 'doctordir',
  rep_id          UUID NOT NULL,
  period_start    DATE NOT NULL,
  gross_mrr_cents BIGINT DEFAULT 0,
  clawback_cents  BIGINT DEFAULT 0,
  net_cents       BIGINT DEFAULT 0,
  tier_pct        INT,
  status          TEXT DEFAULT 'pending',   -- pending | approved | paid | skipped
  paid_at         TIMESTAMPTZ,
  ach_reference   TEXT,
  line_items      JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (rep_id, period_start)
);

-- ---------------------------------------------------------------------
-- REP LEAD REQUESTS (rep asks admin to scrape a city)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.rep_lead_requests (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL DEFAULT 'doctordir',
  rep_id      UUID NOT NULL,
  rep_email   TEXT NOT NULL,
  state       TEXT,
  city        TEXT,
  category    TEXT,
  notes       TEXT,
  status      TEXT DEFAULT 'pending',      -- pending | approved | rejected | completed
  admin_note  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- REP APPLICATIONS (1099 onboarding packet)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.rep_applications (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               TEXT NOT NULL DEFAULT 'doctordir',
  name                    TEXT,
  email                   TEXT,
  phone                   TEXT,
  address                 JSONB,
  tin_encrypted           TEXT,
  ach_encrypted           TEXT,
  payment_method          TEXT,
  payment_handle          TEXT,
  preferred_categories    TEXT[],
  status                  TEXT DEFAULT 'draft',  -- draft | submitted | approved | rejected | archived
  signature_name          TEXT,
  signed_at               TIMESTAMPTZ,
  signature_ip            INET,
  approved_admin_user_id  UUID,
  rejection_reason        TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doctordirectory.rep_documents (
  id                BIGSERIAL PRIMARY KEY,
  application_id    UUID NOT NULL,
  doc_type          TEXT NOT NULL,
  doc_version       TEXT NOT NULL,
  document_html     TEXT NOT NULL,
  signature_name    TEXT,
  signed_at         TIMESTAMPTZ,
  signer_ip         INET,
  countersigned_at  TIMESTAMPTZ,
  countersigned_by  TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Manager versions
CREATE TABLE IF NOT EXISTS doctordirectory.manager_applications (LIKE doctordirectory.rep_applications INCLUDING ALL);
ALTER TABLE doctordirectory.manager_applications ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'manager';
CREATE TABLE IF NOT EXISTS doctordirectory.manager_documents (LIKE doctordirectory.rep_documents INCLUDING ALL);

CREATE TABLE IF NOT EXISTS doctordirectory.manager_stats (
  manager_email               TEXT PRIMARY KEY,
  tenant_id                   TEXT NOT NULL DEFAULT 'doctordir',
  tier                        INT DEFAULT 1,
  override_pct                INT DEFAULT 5,
  team_book_mrr_cents         BIGINT DEFAULT 0,
  team_vested_sponsor_count   INT DEFAULT 0,
  tier_config                 JSONB,
  tier_locked_at              TIMESTAMPTZ,
  last_recompute_at           TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS doctordirectory.manager_overrides (
  id                     BIGSERIAL PRIMARY KEY,
  tenant_id              TEXT NOT NULL DEFAULT 'doctordir',
  manager_email          TEXT NOT NULL,
  period_start           DATE NOT NULL,
  total_override_cents   BIGINT DEFAULT 0,
  line_items             JSONB,
  status                 TEXT DEFAULT 'pending',
  paid_at                TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (manager_email, period_start)
);

-- ---------------------------------------------------------------------
-- PENDING LISTING EDITS (owner edit approval queue)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.pending_listing_edits (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            TEXT NOT NULL DEFAULT 'doctordir',
  slug                 TEXT NOT NULL,
  submitted_by_email   TEXT,
  proposed_fields      JSONB NOT NULL,
  previous_fields      JSONB,
  changed_field_keys   TEXT[],
  status               TEXT DEFAULT 'pending',    -- pending | approved | rejected
  admin_note           TEXT,
  approved_at          TIMESTAMPTZ,
  approved_by          TEXT,
  rejected_at          TIMESTAMPTZ,
  rejected_by          TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pending_edits_status ON doctordirectory.pending_listing_edits (tenant_id, status);

-- ---------------------------------------------------------------------
-- CLAIMS + SUBMISSIONS (lifecycle audit)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL DEFAULT 'doctordir',
  slug            TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT,
  name            TEXT,
  verification_code TEXT,
  code_expires_at TIMESTAMPTZ,
  status          TEXT DEFAULT 'pending',   -- pending | verified | approved | rejected
  admin_note      TEXT,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  verified_at     TIMESTAMPTZ,
  approved_at     TIMESTAMPTZ,
  approved_by     TEXT
);
CREATE INDEX IF NOT EXISTS idx_claims_slug   ON doctordirectory.claims (tenant_id, slug);
CREATE INDEX IF NOT EXISTS idx_claims_status ON doctordirectory.claims (tenant_id, status);

CREATE TABLE IF NOT EXISTS doctordirectory.submissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL DEFAULT 'doctordir',
  payload     JSONB NOT NULL,
  status      TEXT DEFAULT 'pending',        -- pending | approved | denied
  admin_note  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  actioned_at TIMESTAMPTZ,
  actioned_by TEXT
);

-- ---------------------------------------------------------------------
-- ADMIN USERS + CREDENTIALS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.admin_users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT UNIQUE NOT NULL,
  name                TEXT,
  role                TEXT NOT NULL DEFAULT 'sales-associate',   -- super-admin | general-manager | sales-manager | sales-associate | listing-owner
  permissions         TEXT[] DEFAULT '{}',
  scoped_tenant_ids   TEXT[] DEFAULT '{}',     -- empty = all tenants; populated = restricted
  active              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doctordirectory.admin_credentials (
  email              TEXT PRIMARY KEY,
  password_hash      TEXT NOT NULL,
  reset_token        TEXT,
  reset_token_expires TIMESTAMPTZ,
  last_password_change TIMESTAMPTZ DEFAULT NOW(),
  failed_login_count  INT DEFAULT 0,
  locked_until        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- AUTH SESSIONS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.auth_sessions (
  token            TEXT PRIMARY KEY,
  user_type        TEXT NOT NULL,           -- admin | rep | owner
  user_email       TEXT NOT NULL,
  user_role        TEXT,
  tenant_id        TEXT,
  expires_at       TIMESTAMPTZ NOT NULL,
  revoked_at       TIMESTAMPTZ,
  revoked_reason   TEXT,
  ip_address       INET,
  user_agent       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_email ON doctordirectory.auth_sessions (user_email);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON doctordirectory.auth_sessions (expires_at) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------
-- AUDIT LOG (append-only)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.admin_audit_log (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    TEXT,
  actor_email  TEXT NOT NULL,
  action       TEXT NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  detail       JSONB,
  ip           INET,
  occurred_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_actor    ON doctordirectory.admin_audit_log (actor_email, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target   ON doctordirectory.admin_audit_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_occurred ON doctordirectory.admin_audit_log (occurred_at DESC);

-- ---------------------------------------------------------------------
-- SYSTEM LOG (cron runs + alerts)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.system_log (
  id          BIGSERIAL PRIMARY KEY,
  source      TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'info',    -- info | warn | error
  event       TEXT NOT NULL,
  message     TEXT,
  duration_ms INT,
  meta        JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_syslog_source  ON doctordirectory.system_log (source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_syslog_level   ON doctordirectory.system_log (level, created_at DESC);

-- ---------------------------------------------------------------------
-- SUPPORT TICKETS
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION doctordirectory.gen_ticket_number() RETURNS TEXT AS $$
  SELECT 'ST-' || LPAD(CAST(FLOOR(RANDOM()*1000000) AS TEXT), 6, '0');
$$ LANGUAGE SQL;

CREATE TABLE IF NOT EXISTS doctordirectory.support_tickets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT NOT NULL DEFAULT 'doctordir',
  ticket_number    TEXT UNIQUE NOT NULL DEFAULT doctordirectory.gen_ticket_number(),
  submitter_role   TEXT NOT NULL,                -- public | owner | rep | manager | admin
  submitter_email  TEXT NOT NULL,
  submitter_name   TEXT,
  slug             TEXT,
  category         TEXT,                         -- billing | account | technical | leads | payouts | feature_request | other
  priority         TEXT DEFAULT 'normal',        -- low | normal | high | urgent
  subject          TEXT NOT NULL,
  description      TEXT NOT NULL,
  status           TEXT DEFAULT 'open',          -- open | in_progress | resolved | closed
  admin_response   TEXT,
  assigned_admin   TEXT,
  resolved_at      TIMESTAMPTZ,
  closed_at        TIMESTAMPTZ,
  ip_address       INET,
  user_agent       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tickets_status   ON doctordirectory.support_tickets (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_submitter ON doctordirectory.support_tickets (submitter_email);

CREATE TABLE IF NOT EXISTS doctordirectory.support_ticket_messages (
  id            BIGSERIAL PRIMARY KEY,
  ticket_id     UUID NOT NULL REFERENCES doctordirectory.support_tickets(id) ON DELETE CASCADE,
  sender_role   TEXT NOT NULL,
  sender_email  TEXT NOT NULL,
  message       TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- EMAIL
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.email_log (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      TEXT,
  to_email       TEXT NOT NULL,
  from_email     TEXT,
  subject        TEXT,
  event          TEXT,
  template_id    TEXT,
  status         TEXT NOT NULL,            -- sent | failed | bounced | suppressed
  resend_id      TEXT,
  error_message  TEXT,
  meta           JSONB,
  sent_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_log_to     ON doctordirectory.email_log (to_email, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_event  ON doctordirectory.email_log (event, sent_at DESC);

CREATE TABLE IF NOT EXISTS doctordirectory.email_suppressions (
  email       TEXT PRIMARY KEY,
  reason      TEXT NOT NULL,                  -- bounce_hard | complaint | unsubscribe
  meta        JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doctordirectory.email_drip_log (
  id         BIGSERIAL PRIMARY KEY,
  tenant_id  TEXT,
  slug       TEXT,
  email      TEXT NOT NULL,
  drip_key   TEXT NOT NULL,
  meta       JSONB,
  sent_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (email, drip_key)
);

-- ---------------------------------------------------------------------
-- SQUARE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.square_webhook_log (
  id                BIGSERIAL PRIMARY KEY,
  event_id          TEXT UNIQUE NOT NULL,
  event_type        TEXT NOT NULL,
  payload           JSONB NOT NULL,
  signature_valid   BOOLEAN DEFAULT false,
  processed         BOOLEAN DEFAULT false,
  processed_at      TIMESTAMPTZ,
  error_message     TEXT,
  received_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_square_webhook_type ON doctordirectory.square_webhook_log (event_type, received_at DESC);

CREATE TABLE IF NOT EXISTS doctordirectory.square_transactions_cache (
  square_payment_id   TEXT PRIMARY KEY,
  tenant_id           TEXT,
  slug                TEXT,
  amount              INT,
  currency            TEXT,
  status              TEXT,
  type                TEXT,                     -- payment | refund
  created_at_square   TIMESTAMPTZ,
  raw                 JSONB,
  cached_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doctordirectory.account_credit_log (
  id                BIGSERIAL PRIMARY KEY,
  refund_id         TEXT UNIQUE NOT NULL,     -- idempotent
  tenant_id         TEXT,
  slug              TEXT,
  amount_cents      BIGINT,
  reason            TEXT,
  meta              JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- SCRAPER
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.scrape_queue (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       TEXT NOT NULL DEFAULT 'doctordir',
  state           TEXT NOT NULL,
  city            TEXT,
  category        TEXT,
  status          TEXT DEFAULT 'pending',        -- pending | running | done | error
  priority        INT DEFAULT 5,
  attempts        INT DEFAULT 0,
  last_error      TEXT,
  results_count   INT DEFAULT 0,
  enqueued_by     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scrape_queue_status ON doctordirectory.scrape_queue (tenant_id, status, priority DESC);

-- ---------------------------------------------------------------------
-- TRIGGERS: touch updated_at
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION doctordirectory.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'doctordirectory'
             AND column_name = 'updated_at'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_touch_%1$I ON doctordirectory.%1$I;
       CREATE TRIGGER trg_touch_%1$I BEFORE UPDATE ON doctordirectory.%1$I
       FOR EACH ROW EXECUTE FUNCTION doctordirectory.touch_updated_at();',
      t
    );
  END LOOP;
END$$;

-- ---------------------------------------------------------------------
-- HEALTH VIEW
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW doctordirectory.v_system_health_zombies AS
SELECT
  (SELECT COUNT(*) FROM doctordirectory.outreach o
    LEFT JOIN doctordirectory.listings l ON l.tenant_id=o.tenant_id AND l.slug=o.slug
    WHERE l.id IS NULL) AS orphan_outreach,
  (SELECT COUNT(*) FROM doctordirectory.listings
    WHERE plan != 'free' AND square_subscription_id IS NULL) AS ghost_paid_listings,
  (SELECT COUNT(*) FROM doctordirectory.rep_lead_requests
    WHERE status='pending' AND created_at < NOW() - INTERVAL '3 days') AS stale_rep_requests,
  (SELECT COUNT(*) FROM doctordirectory.pending_listing_edits
    WHERE status='pending' AND created_at < NOW() - INTERVAL '3 days') AS stale_pending_edits,
  (SELECT COUNT(*) FROM doctordirectory.listings
    WHERE password_hash IS NOT NULL AND claimed_at IS NULL) AS ghost_claims,
  (SELECT COUNT(*) FROM doctordirectory.support_tickets
    WHERE status IN ('open','in_progress') AND created_at < NOW() - INTERVAL '48 hours') AS stale_open_tickets,
  (SELECT COUNT(*) FROM doctordirectory.support_tickets
    WHERE status='open' AND priority='urgent') AS urgent_tickets_open;

-- ---------------------------------------------------------------------
-- GRANTS (service_role bypasses RLS; anon has no write grants)
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA doctordirectory TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA doctordirectory TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA doctordirectory TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA doctordirectory TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA doctordirectory
  GRANT SELECT ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA doctordirectory
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA doctordirectory
  GRANT USAGE, SELECT ON SEQUENCES TO service_role;

NOTIFY pgrst, 'reload schema';
