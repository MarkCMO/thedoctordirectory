-- ---------------------------------------------------------------------
-- RATE LIMIT BUCKETS (IP/key-based limiter for public endpoints)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctordirectory.rate_limit_buckets (
  id          BIGSERIAL PRIMARY KEY,
  key         TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_key_time ON doctordirectory.rate_limit_buckets (key, created_at DESC);
GRANT ALL ON doctordirectory.rate_limit_buckets TO service_role;
GRANT USAGE, SELECT ON SEQUENCE doctordirectory.rate_limit_buckets_id_seq TO service_role;
