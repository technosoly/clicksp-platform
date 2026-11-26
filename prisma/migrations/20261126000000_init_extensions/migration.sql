-- Phase 2 baseline: PostgreSQL extensions the platform relies on.
-- pg_trgm powers the database search fallback (trigram similarity on
-- normalized Persian/English names and part numbers). Tables arrive in Phase 3.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
