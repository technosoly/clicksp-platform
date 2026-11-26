-- Phase 3: helper functions used by every table and trigger.

-- UUIDv7 (RFC 9562): 48-bit Unix millisecond timestamp + random bits.
-- Time-ordered (good B-tree locality) and not guessable. PostgreSQL 18 has a
-- native uuidv7(); this function keeps PostgreSQL 16/17 supported.
CREATE OR REPLACE FUNCTION gen_uuid_v7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid())
                placing substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
                FROM 1 FOR 6),
        52, 1),
      53, 1),
    'hex')::uuid;
$$;

COMMENT ON FUNCTION gen_uuid_v7() IS 'UUID version 7 (time-ordered) primary key generator';

-- Keeps updated_at correct for writes that bypass Prisma (raw SQL, triggers).
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Append-only ledgers: rejects every UPDATE and DELETE.
CREATE OR REPLACE FUNCTION forbid_update_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END $$;

-- Rejects DELETE (rows are deactivated instead).
CREATE OR REPLACE FUNCTION forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rows in % cannot be deleted; deactivate them instead', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END $$;

-- The acting user for trigger-written history rows. Services set it per
-- transaction with: SELECT set_config('app.actor_id', '<uuid>', true);
CREATE OR REPLACE FUNCTION app_actor_id() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE v text := current_setting('app.actor_id', true);
BEGIN
  IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
  RETURN v::uuid;
END $$;
