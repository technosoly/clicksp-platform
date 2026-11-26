-- Phase 3: integrity rules Prisma cannot express.
-- CHECK constraints, append-only ledgers, the audit hash chain, RBAC
-- escalation guards, tree guards, fitment rules, trigger-driven inventory
-- balances, order state machine, refund/return limits, double-entry
-- accounting rules and immutability of posted/issued records.
-- Every rule here has an integration test in tests/integration/.

-- =====================================================================
-- 0. updated_at maintenance for every table that has the column
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
                   t || '_set_updated_at', t);
  END LOOP;
END $$;

-- =====================================================================
-- 1. SYSTEM
-- =====================================================================
ALTER TABLE locales
  ADD CONSTRAINT locales_code_format CHECK (code ~ '^[a-z]{2}(-[A-Z]{2})?$');

ALTER TABLE currencies
  ADD CONSTRAINT currencies_code_format CHECK (code ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT currencies_numeric_code_format CHECK (numeric_code ~ '^[0-9]{3}$'),
  ADD CONSTRAINT currencies_decimal_places_range CHECK (decimal_places BETWEEN 0 AND 4);

ALTER TABLE system_settings
  ADD CONSTRAINT system_settings_key_format CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$');
ALTER TABLE store_settings
  ADD CONSTRAINT store_settings_key_format CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$');
ALTER TABLE feature_flags
  ADD CONSTRAINT feature_flags_key_format CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$');

ALTER TABLE tax_rules
  ADD CONSTRAINT tax_rules_rate_range CHECK (rate_bp BETWEEN 0 AND 10000),
  ADD CONSTRAINT tax_rules_dates CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at);

ALTER TABLE seo_metadata
  ADD CONSTRAINT seo_metadata_canonical_relative CHECK (canonical_path IS NULL OR canonical_path ~ '^/[^/]');

ALTER TABLE release_versions
  ADD CONSTRAINT release_versions_git_sha_format CHECK (git_sha ~ '^[0-9a-f]{40}$');

ALTER TABLE deployment_records
  ADD CONSTRAINT deployment_records_run_url_https CHECK (external_run_url IS NULL OR external_run_url ~ '^https://');

ALTER TABLE background_jobs ADD CONSTRAINT background_jobs_attempts_non_negative CHECK (attempts >= 0);
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_attempts_non_negative CHECK (attempts >= 0);

ALTER TABLE data_import_jobs
  ADD CONSTRAINT data_import_jobs_counts CHECK (
    total_rows >= 0 AND valid_rows >= 0 AND invalid_rows >= 0 AND applied_rows >= 0
    AND valid_rows + invalid_rows <= total_rows AND applied_rows <= valid_rows);
ALTER TABLE data_import_rows ADD CONSTRAINT data_import_rows_row_number_positive CHECK (row_number > 0);

ALTER TABLE idempotency_keys
  ADD CONSTRAINT idempotency_keys_request_hash_hex CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT idempotency_keys_expiry CHECK (expires_at > created_at);

CREATE TRIGGER system_logs_append_only BEFORE UPDATE OR DELETE ON system_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- =====================================================================
-- 2. IDENTITY, RBAC, AUDIT
-- =====================================================================
ALTER TABLE users
  ADD CONSTRAINT users_email_lowercase CHECK (email IS NULL OR (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  ADD CONSTRAINT users_phone_e164 CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT users_username_format CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9._-]{2,49}$'),
  ADD CONSTRAINT users_has_identifier CHECK (email IS NOT NULL OR phone_number IS NOT NULL OR username IS NOT NULL);

CREATE TRIGGER users_no_delete BEFORE DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();

ALTER TABLE sessions
  ADD CONSTRAINT sessions_token_hash_hex CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT sessions_expiry CHECK (expires_at > created_at);

ALTER TABLE verification_tokens
  ADD CONSTRAINT verification_tokens_value_hash_hex CHECK (value_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT verification_tokens_attempts_non_negative CHECK (attempts >= 0),
  ADD CONSTRAINT verification_tokens_expiry CHECK (expires_at > created_at);

ALTER TABLE user_mfa
  ADD CONSTRAINT user_mfa_failed_count_non_negative CHECK (failed_verification_count >= 0);

CREATE TRIGGER login_attempts_append_only BEFORE UPDATE OR DELETE ON login_attempts
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER security_events_append_only BEFORE UPDATE OR DELETE ON security_events
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

ALTER TABLE roles
  ADD CONSTRAINT roles_level_range CHECK (level BETWEEN 0 AND 3),
  ADD CONSTRAINT roles_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,49}$');

ALTER TABLE permissions
  ADD CONSTRAINT permissions_key_format CHECK (key ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*){1,3}$'),
  ADD CONSTRAINT permissions_max_level_range CHECK (max_level BETWEEN 1 AND 3);

-- System roles keep their key, level and system flag, and cannot be deleted.
CREATE OR REPLACE FUNCTION roles_protect_system() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'system role % cannot be deleted', OLD.key USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.is_system AND (NEW.key <> OLD.key OR NEW.level <> OLD.level OR NOT NEW.is_system) THEN
    RAISE EXCEPTION 'system role % cannot change key, level or system flag', OLD.key USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER roles_protect_system BEFORE UPDATE OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION roles_protect_system();

-- Escalation guard independent of the application: a permission can only be
-- held by admin roles whose level is within the permission's max_level
-- (e.g. role.manage has max_level 1, so no level 2/3 role can ever hold it).
-- Customer roles (level 0) hold no permissions.
CREATE OR REPLACE FUNCTION role_permissions_level_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r_level smallint; p_max smallint; p_key text; p_scope scope_type;
BEGIN
  SELECT level INTO r_level FROM roles WHERE id = NEW.role_id;
  SELECT max_level, key, scope_type INTO p_max, p_key, p_scope FROM permissions WHERE id = NEW.permission_id;
  IF r_level < 1 OR r_level > p_max THEN
    RAISE EXCEPTION 'permission % cannot be granted to a level % role', p_key, r_level USING ERRCODE = 'P0001';
  END IF;
  IF NEW.is_scoped AND p_scope IS NULL THEN
    RAISE EXCEPTION 'permission % has no resource scope and cannot be granted as scoped', p_key USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER role_permissions_level_guard BEFORE INSERT OR UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION role_permissions_level_guard();

-- Lowering a permission's max_level must not leave existing grants above it.
CREATE OR REPLACE FUNCTION permissions_max_level_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.max_level < OLD.max_level AND EXISTS (
    SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
    WHERE rp.permission_id = NEW.id AND r.level > NEW.max_level) THEN
    RAISE EXCEPTION 'permission % is granted to roles above level %', NEW.key, NEW.max_level USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER permissions_max_level_guard BEFORE UPDATE OF max_level ON permissions
  FOR EACH ROW EXECUTE FUNCTION permissions_max_level_guard();

-- A role's level cannot change to one that some of its permissions forbid.
CREATE OR REPLACE FUNCTION roles_level_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.level <> OLD.level AND EXISTS (
    SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = NEW.id AND (NEW.level < 1 OR NEW.level > p.max_level)) THEN
    RAISE EXCEPTION 'role % holds permissions not allowed at level %', NEW.key, NEW.level USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER roles_level_guard BEFORE UPDATE OF level ON roles
  FOR EACH ROW EXECUTE FUNCTION roles_level_guard();

ALTER TABLE user_role_scopes
  ADD CONSTRAINT user_role_scopes_target CHECK (
    (scope_type = 'category' AND category_id IS NOT NULL AND warehouse_id IS NULL) OR
    (scope_type = 'warehouse' AND warehouse_id IS NOT NULL AND category_id IS NULL));

-- The last active Super Admin cannot be disabled, demoted or lose the role.
CREATE OR REPLACE FUNCTION active_super_admin_count() RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM users u
  WHERE u.status = 'active' AND EXISTS (
    SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = u.id AND r.level = 1 AND r.is_active
      AND (ur.expires_at IS NULL OR ur.expires_at > now()));
$$;

CREATE OR REPLACE FUNCTION guard_last_super_admin() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE relevant boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'user_roles' THEN
    relevant := EXISTS (SELECT 1 FROM roles WHERE id = OLD.role_id AND level = 1);
  ELSIF TG_TABLE_NAME = 'users' THEN
    relevant := OLD.status = 'active' AND NEW.status <> 'active' AND EXISTS (
      SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = OLD.id AND r.level = 1);
  ELSIF TG_TABLE_NAME = 'roles' THEN
    relevant := OLD.level = 1 AND OLD.is_active AND (NOT NEW.is_active OR NEW.level <> 1);
  END IF;
  IF relevant THEN
    PERFORM pg_advisory_xact_lock(hashtext('clicksp.last_super_admin'));
    IF active_super_admin_count() = 0 THEN
      RAISE EXCEPTION 'the last active Super Admin cannot be removed, disabled or demoted' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER user_roles_last_super_admin AFTER UPDATE OR DELETE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION guard_last_super_admin();
CREATE TRIGGER users_last_super_admin AFTER UPDATE OF status ON users
  FOR EACH ROW EXECUTE FUNCTION guard_last_super_admin();
CREATE TRIGGER roles_last_super_admin AFTER UPDATE OF level, is_active ON roles
  FOR EACH ROW EXECUTE FUNCTION guard_last_super_admin();

ALTER TABLE admin_approvals
  ADD CONSTRAINT admin_approvals_not_self_decided CHECK (decided_by IS NULL OR decided_by <> requested_by),
  ADD CONSTRAINT admin_approvals_decision_complete CHECK (
    (status IN ('pending', 'cancelled', 'expired')) OR (decided_by IS NOT NULL AND decided_at IS NOT NULL));

-- Audit log: append-only and hash-chained. seq, prev_hash and hash are
-- assigned here under a lock, so chain order equals seq order. Inserts must
-- run in READ COMMITTED (the default) so each insert sees the previous link.
CREATE OR REPLACE FUNCTION audit_log_row_digest(a audit_logs, prev bytea) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$
  SELECT sha256(coalesce(prev, '\x'::bytea) || convert_to(concat_ws('|',
    a.id::text, a.seq::text, to_char(a.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    a.actor_type::text, coalesce(a.actor_user_id::text, ''), a.action, a.entity_type,
    coalesce(a.entity_id::text, ''), coalesce(a.before::text, ''), coalesce(a.after::text, ''),
    coalesce(host(a.ip_address), ''), coalesce(a.user_agent, ''), coalesce(a.request_id, '')), 'UTF8'));
$$;

CREATE OR REPLACE FUNCTION audit_logs_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE prev bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('clicksp.audit_logs_chain'));
  NEW.seq := nextval(pg_get_serial_sequence('audit_logs', 'seq'));
  SELECT hash INTO prev FROM audit_logs ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := prev;
  NEW.hash := audit_log_row_digest(NEW, prev);
  RETURN NEW;
END $$;
CREATE TRIGGER audit_logs_chain BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_chain();
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- Returns the seq of the first row whose hash or link does not verify, or
-- NULL when the whole chain is intact.
CREATE OR REPLACE FUNCTION audit_logs_verify() RETURNS bigint
LANGUAGE plpgsql STABLE AS $$
DECLARE r audit_logs; prev bytea := NULL;
BEGIN
  FOR r IN SELECT * FROM audit_logs ORDER BY seq LOOP
    IF r.prev_hash IS DISTINCT FROM prev OR r.hash <> audit_log_row_digest(r, prev) THEN
      RETURN r.seq;
    END IF;
    prev := r.hash;
  END LOOP;
  RETURN NULL;
END $$;

-- =====================================================================
-- 3. GENERIC TREE GUARD (categories, article_categories, financial_accounts)
-- =====================================================================
CREATE OR REPLACE FUNCTION tree_no_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE cur uuid := NEW.parent_id; steps integer := 0;
BEGIN
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION '%: a row cannot be its own ancestor', TG_TABLE_NAME USING ERRCODE = 'P0001';
    END IF;
    steps := steps + 1;
    IF steps > 32 THEN
      RAISE EXCEPTION '%: tree is too deep', TG_TABLE_NAME USING ERRCODE = 'P0001';
    END IF;
    EXECUTE format('SELECT parent_id FROM %I WHERE id = $1', TG_TABLE_NAME) INTO cur USING cur;
  END LOOP;
  RETURN NEW;
END $$;

-- =====================================================================
-- 4. CATALOG
-- =====================================================================
ALTER TABLE categories
  ADD CONSTRAINT categories_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id),
  ADD CONSTRAINT categories_depth_range CHECK (depth BETWEEN 0 AND 8);

CREATE TRIGGER categories_no_cycle BEFORE INSERT OR UPDATE OF parent_id ON categories
  FOR EACH ROW EXECUTE FUNCTION tree_no_cycle();

CREATE OR REPLACE FUNCTION categories_set_depth() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.depth := coalesce((SELECT depth + 1 FROM categories WHERE id = NEW.parent_id), 0);
  RETURN NEW;
END $$;
CREATE TRIGGER categories_set_depth BEFORE INSERT OR UPDATE OF parent_id ON categories
  FOR EACH ROW EXECUTE FUNCTION categories_set_depth();

CREATE OR REPLACE FUNCTION categories_cascade_depth() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  WITH RECURSIVE sub AS (
    SELECT id, NEW.depth + 1 AS d FROM categories WHERE parent_id = NEW.id
    UNION ALL
    SELECT c.id, sub.d + 1 FROM categories c JOIN sub ON c.parent_id = sub.id
  )
  UPDATE categories c SET depth = sub.d FROM sub WHERE c.id = sub.id AND c.depth <> sub.d;
  RETURN NULL;
END $$;
CREATE TRIGGER categories_cascade_depth AFTER UPDATE OF parent_id ON categories
  FOR EACH ROW WHEN (OLD.parent_id IS DISTINCT FROM NEW.parent_id)
  EXECUTE FUNCTION categories_cascade_depth();

ALTER TABLE manufacturers ADD CONSTRAINT manufacturers_country_code CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');

-- Slugs: lower-case Latin or Persian letters, digits and single dashes.
ALTER TABLE manufacturer_translations ADD CONSTRAINT manufacturer_translations_slug_format CHECK (slug ~ '^[a-z0-9؀-ۿ]+(-[a-z0-9؀-ۿ]+)*$');
ALTER TABLE brand_translations ADD CONSTRAINT brand_translations_slug_format CHECK (slug ~ '^[a-z0-9؀-ۿ]+(-[a-z0-9؀-ۿ]+)*$');
ALTER TABLE category_translations ADD CONSTRAINT category_translations_slug_format CHECK (slug ~ '^[a-z0-9؀-ۿ]+(-[a-z0-9؀-ۿ]+)*$');
ALTER TABLE product_translations ADD CONSTRAINT product_translations_slug_format CHECK (slug ~ '^[a-z0-9؀-ۿ]+(-[a-z0-9؀-ۿ]+)*$');

ALTER TABLE attribute_definitions ADD CONSTRAINT attribute_definitions_key_format CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$');
ALTER TABLE attribute_options ADD CONSTRAINT attribute_options_key_format CHECK (key ~ '^[a-z0-9][a-z0-9_-]{0,63}$');

ALTER TABLE products
  ADD CONSTRAINT products_warranty_months_range CHECK (warranty_months IS NULL OR warranty_months BETWEEN 0 AND 240),
  ADD CONSTRAINT products_active_has_publish_date CHECK (status <> 'active' OR published_at IS NOT NULL);

ALTER TABLE product_variants
  ADD CONSTRAINT product_variants_price_non_negative CHECK (price >= 0),
  ADD CONSTRAINT product_variants_compare_at_gt_price CHECK (compare_at_price IS NULL OR compare_at_price > price),
  ADD CONSTRAINT product_variants_cost_non_negative CHECK (cost_price IS NULL OR cost_price >= 0),
  ADD CONSTRAINT product_variants_sku_not_blank CHECK (btrim(sku) <> ''),
  ADD CONSTRAINT product_variants_sku_normalized_format CHECK (sku_normalized <> '' AND sku_normalized = upper(sku_normalized) AND sku_normalized !~ '[\s\-_./]'),
  ADD CONSTRAINT product_variants_dimensions_positive CHECK (
    (weight_grams IS NULL OR weight_grams > 0) AND (length_mm IS NULL OR length_mm > 0) AND
    (width_mm IS NULL OR width_mm > 0) AND (height_mm IS NULL OR height_mm > 0)),
  ADD CONSTRAINT product_variants_order_qty CHECK (min_order_qty >= 1 AND (max_order_qty IS NULL OR max_order_qty >= min_order_qty));

-- Price history: every price change is recorded with the acting user (and
-- the approval when the change came through one).
CREATE OR REPLACE FUNCTION product_variants_record_price() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE approval text := current_setting('app.approval_id', true);
BEGIN
  IF TG_OP = 'INSERT' OR NEW.price IS DISTINCT FROM OLD.price
     OR NEW.compare_at_price IS DISTINCT FROM OLD.compare_at_price
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code THEN
    INSERT INTO product_prices (variant_id, price, compare_at_price, currency_code, changed_by, approval_id)
    VALUES (NEW.id, NEW.price, NEW.compare_at_price, NEW.currency_code, app_actor_id(),
            CASE WHEN approval IS NULL OR approval = '' THEN NULL ELSE approval::uuid END);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER product_variants_record_price AFTER INSERT OR UPDATE OF price, compare_at_price, currency_code ON product_variants
  FOR EACH ROW EXECUTE FUNCTION product_variants_record_price();

ALTER TABLE product_prices
  ADD CONSTRAINT product_prices_price_non_negative CHECK (price >= 0),
  ADD CONSTRAINT product_prices_compare_at_gt_price CHECK (compare_at_price IS NULL OR compare_at_price > price);
CREATE TRIGGER product_prices_append_only BEFORE UPDATE OR DELETE ON product_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- Attribute values: exactly one value column, matching the definition's type;
-- a variant-level value belongs to a variant of the same product.
CREATE OR REPLACE FUNCTION product_attributes_validate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE dt attribute_data_type;
BEGIN
  SELECT data_type INTO dt FROM attribute_definitions WHERE id = NEW.attribute_id;
  IF num_nonnulls(NEW.value_text, NEW.value_number, NEW.value_boolean, NEW.option_id) <> 1
     OR (dt = 'text' AND NEW.value_text IS NULL)
     OR (dt = 'number' AND NEW.value_number IS NULL)
     OR (dt = 'boolean' AND NEW.value_boolean IS NULL)
     OR (dt = 'option' AND NEW.option_id IS NULL) THEN
    RAISE EXCEPTION 'attribute value does not match attribute type %', dt USING ERRCODE = '23514';
  END IF;
  IF NEW.variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM product_variants WHERE id = NEW.variant_id AND product_id = NEW.product_id) THEN
    RAISE EXCEPTION 'variant % does not belong to product %', NEW.variant_id, NEW.product_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_attributes_validate BEFORE INSERT OR UPDATE ON product_attributes
  FOR EACH ROW EXECUTE FUNCTION product_attributes_validate();

-- Images / identifiers attached to a variant must use a variant of that product.
CREATE OR REPLACE FUNCTION variant_belongs_to_product() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM product_variants WHERE id = NEW.variant_id AND product_id = NEW.product_id) THEN
    RAISE EXCEPTION '%: variant % does not belong to product %', TG_TABLE_NAME, NEW.variant_id, NEW.product_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_images_variant_check BEFORE INSERT OR UPDATE ON product_images
  FOR EACH ROW EXECUTE FUNCTION variant_belongs_to_product();
CREATE TRIGGER product_identifiers_variant_check BEFORE INSERT OR UPDATE ON product_identifiers
  FOR EACH ROW EXECUTE FUNCTION variant_belongs_to_product();

ALTER TABLE product_images ADD CONSTRAINT product_images_alt_has_fa CHECK (jsonb_typeof(alt) = 'object' AND alt ? 'fa');

ALTER TABLE product_identifiers
  ADD CONSTRAINT product_identifiers_value_not_blank CHECK (btrim(value) <> ''),
  ADD CONSTRAINT product_identifiers_normalized_format CHECK (
    normalized_value <> '' AND normalized_value = upper(normalized_value) AND normalized_value !~ '[\s\-_./]');

ALTER TABLE product_relations ADD CONSTRAINT product_relations_not_self CHECK (product_id <> related_product_id);

-- =====================================================================
-- 5. MOTORCYCLES AND COMPATIBILITY
-- =====================================================================
ALTER TABLE motorcycle_manufacturers ADD CONSTRAINT motorcycle_manufacturers_country_code CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
ALTER TABLE motorcycle_manufacturer_translations ADD CONSTRAINT motorcycle_manufacturer_translations_slug_format CHECK (slug ~ '^[a-z0-9؀-ۿ]+(-[a-z0-9؀-ۿ]+)*$');
ALTER TABLE motorcycle_brand_translations ADD CONSTRAINT motorcycle_brand_translations_slug_format CHECK (slug ~ '^[a-z0-9؀-ۿ]+(-[a-z0-9؀-ۿ]+)*$');
ALTER TABLE motorcycle_model_translations ADD CONSTRAINT motorcycle_model_translations_slug_format CHECK (slug ~ '^[a-z0-9؀-ۿ]+(-[a-z0-9؀-ۿ]+)*$');

ALTER TABLE motorcycle_generations
  ADD CONSTRAINT motorcycle_generations_years CHECK (
    year_from BETWEEN 1885 AND 2100 AND (year_to IS NULL OR (year_to BETWEEN year_from AND 2100)));

ALTER TABLE motorcycle_variants
  ADD CONSTRAINT motorcycle_variants_displacement CHECK (engine_displacement_cc IS NULL OR engine_displacement_cc BETWEEN 1 AND 5000),
  ADD CONSTRAINT motorcycle_variants_cylinders CHECK (cylinders IS NULL OR cylinders BETWEEN 1 AND 12),
  ADD CONSTRAINT motorcycle_variants_years CHECK (
    (year_from IS NULL OR year_from BETWEEN 1885 AND 2100) AND
    (year_to IS NULL OR year_to BETWEEN 1885 AND 2100) AND
    (year_from IS NULL OR year_to IS NULL OR year_from <= year_to));

-- A variant's own year range must lie within its generation's years.
CREATE OR REPLACE FUNCTION years_within_generation(gen_id uuid, y_from smallint, y_to smallint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(y_from, g.year_from) >= g.year_from
     AND coalesce(y_to, y_from, g.year_from) >= g.year_from
     AND (g.year_to IS NULL OR (coalesce(y_to, y_from, g.year_from) <= g.year_to AND coalesce(y_from, g.year_from) <= g.year_to))
  FROM motorcycle_generations g WHERE g.id = gen_id;
$$;

CREATE OR REPLACE FUNCTION motorcycle_variants_years_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT years_within_generation(NEW.generation_id, NEW.year_from, NEW.year_to) THEN
    RAISE EXCEPTION 'variant years %-% are outside its generation', NEW.year_from, NEW.year_to USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER motorcycle_variants_years_check BEFORE INSERT OR UPDATE ON motorcycle_variants
  FOR EACH ROW EXECUTE FUNCTION motorcycle_variants_years_check();

-- Narrowing a generation must not strand variants or fitment outside it.
CREATE OR REPLACE FUNCTION motorcycle_generations_years_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM motorcycle_variants v WHERE v.generation_id = NEW.id
             AND NOT years_within_generation(NEW.id, v.year_from, v.year_to))
     OR EXISTS (SELECT 1 FROM product_compatibilities c WHERE c.motorcycle_generation_id = NEW.id
             AND NOT years_within_generation(NEW.id, c.year_from, c.year_to)) THEN
    RAISE EXCEPTION 'generation years would exclude existing variants or fitment rows' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER motorcycle_generations_years_check AFTER UPDATE OF year_from, year_to ON motorcycle_generations
  FOR EACH ROW EXECUTE FUNCTION motorcycle_generations_years_check();

ALTER TABLE motorcycle_specifications
  ADD CONSTRAINT motorcycle_specifications_key_format CHECK (spec_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  ADD CONSTRAINT motorcycle_specifications_one_value CHECK (num_nonnulls(value_number, value_text) = 1);

ALTER TABLE compatibility_sources
  ADD CONSTRAINT compatibility_sources_url_http CHECK (url IS NULL OR url ~ '^https?://');

ALTER TABLE product_compatibilities
  ADD CONSTRAINT product_compatibilities_one_target CHECK (num_nonnulls(motorcycle_variant_id, motorcycle_generation_id) = 1),
  ADD CONSTRAINT product_compatibilities_years CHECK (
    (year_from IS NULL OR year_from BETWEEN 1885 AND 2100) AND
    (year_to IS NULL OR year_to BETWEEN 1885 AND 2100) AND
    (year_from IS NULL OR year_to IS NULL OR year_from <= year_to)),
  ADD CONSTRAINT product_compatibilities_quantity CHECK (quantity_per_vehicle IS NULL OR quantity_per_vehicle BETWEEN 1 AND 100),
  ADD CONSTRAINT product_compatibilities_verified_has_verifier CHECK (
    verification_status <> 'verified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL));

-- Fitment rules: year range inside the generation; changing what a verified
-- row claims (target, years, position, source) drops it back to unverified,
-- so a verification always refers to the exact claim that was checked.
CREATE OR REPLACE FUNCTION product_compatibilities_validate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE gen_id uuid;
BEGIN
  gen_id := coalesce(NEW.motorcycle_generation_id,
                     (SELECT generation_id FROM motorcycle_variants WHERE id = NEW.motorcycle_variant_id));
  IF gen_id IS NOT NULL AND NOT years_within_generation(gen_id, NEW.year_from, NEW.year_to) THEN
    RAISE EXCEPTION 'fitment years %-% are outside the motorcycle generation', NEW.year_from, NEW.year_to
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.verification_status = 'verified' AND NEW.verification_status = 'verified' AND (
       NEW.product_id IS DISTINCT FROM OLD.product_id
    OR NEW.motorcycle_variant_id IS DISTINCT FROM OLD.motorcycle_variant_id
    OR NEW.motorcycle_generation_id IS DISTINCT FROM OLD.motorcycle_generation_id
    OR NEW.year_from IS DISTINCT FROM OLD.year_from OR NEW.year_to IS DISTINCT FROM OLD.year_to
    OR NEW.position IS DISTINCT FROM OLD.position OR NEW.source_id IS DISTINCT FROM OLD.source_id) THEN
    NEW.verification_status := 'unverified';
    NEW.verified_by := NULL;
    NEW.verified_at := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_compatibilities_validate BEFORE INSERT OR UPDATE ON product_compatibilities
  FOR EACH ROW EXECUTE FUNCTION product_compatibilities_validate();

ALTER TABLE customer_vehicles ADD CONSTRAINT customer_vehicles_model_year CHECK (model_year IS NULL OR model_year BETWEEN 1885 AND 2100);

-- =====================================================================
-- 6. INVENTORY (ledger-driven balances)
-- =====================================================================
ALTER TABLE warehouses ADD CONSTRAINT warehouses_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$');
ALTER TABLE warehouse_locations ADD CONSTRAINT warehouse_locations_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,31}$');

ALTER TABLE inventory_balances
  ADD CONSTRAINT inventory_balances_on_hand_non_negative CHECK (on_hand >= 0),
  ADD CONSTRAINT inventory_balances_reserved_non_negative CHECK (reserved >= 0),
  ADD CONSTRAINT inventory_balances_reserved_le_on_hand CHECK (reserved <= on_hand);

-- Balances are written only by the movement and reservation triggers below,
-- which raise the transaction-local flag clicksp.inventory_write.
CREATE OR REPLACE FUNCTION inventory_balances_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inventory_balances rows cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.on_hand <> 0 OR NEW.reserved <> 0 THEN
      RAISE EXCEPTION 'inventory balances start at zero; record a movement instead' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM warehouse_locations WHERE id = NEW.location_id AND warehouse_id = NEW.warehouse_id) THEN
      RAISE EXCEPTION 'location % is not in warehouse %', NEW.location_id, NEW.warehouse_id USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.variant_id <> OLD.variant_id OR NEW.location_id <> OLD.location_id OR NEW.warehouse_id <> OLD.warehouse_id THEN
    RAISE EXCEPTION 'inventory balance keys are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.on_hand <> OLD.on_hand OR NEW.reserved <> OLD.reserved)
     AND coalesce(current_setting('clicksp.inventory_write', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'stock changes only through inventory_movements and stock_reservations' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_balances_guard BEFORE INSERT OR UPDATE OR DELETE ON inventory_balances
  FOR EACH ROW EXECUTE FUNCTION inventory_balances_guard();

ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movements_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT inventory_movements_unit_cost CHECK (
    (unit_cost IS NULL AND currency_code IS NULL) OR (unit_cost >= 0 AND currency_code IS NOT NULL)),
  ADD CONSTRAINT inventory_movements_transfer_link CHECK (
    (type IN ('transfer_in', 'transfer_out')) = (transfer_id IS NOT NULL));

CREATE OR REPLACE FUNCTION inventory_movement_delta(t movement_type, q integer) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN t IN ('receipt', 'return', 'transfer_in', 'adjustment_plus', 'count_gain') THEN q ELSE -q END;
$$;

-- Applies the movement to its balance under the row lock taken by UPDATE.
-- A negative result violates inventory_balances CHECKs and aborts the insert.
CREATE OR REPLACE FUNCTION inventory_movements_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE wh uuid;
BEGIN
  SELECT warehouse_id INTO wh FROM warehouse_locations WHERE id = NEW.location_id;
  IF wh IS NULL OR wh <> NEW.warehouse_id THEN
    RAISE EXCEPTION 'location % is not in warehouse %', NEW.location_id, NEW.warehouse_id USING ERRCODE = '23514';
  END IF;
  IF NEW.actor_user_id IS NULL THEN NEW.actor_user_id := app_actor_id(); END IF;

  INSERT INTO inventory_balances (variant_id, location_id, warehouse_id)
  VALUES (NEW.variant_id, NEW.location_id, NEW.warehouse_id)
  ON CONFLICT (variant_id, location_id) DO NOTHING;

  PERFORM set_config('clicksp.inventory_write', 'on', true);
  UPDATE inventory_balances
     SET on_hand = on_hand + inventory_movement_delta(NEW.type, NEW.quantity), version = version + 1
   WHERE variant_id = NEW.variant_id AND location_id = NEW.location_id
  RETURNING on_hand INTO NEW.on_hand_after;
  PERFORM set_config('clicksp.inventory_write', 'off', true);
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_movements_apply BEFORE INSERT ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION inventory_movements_apply();
CREATE TRIGGER inventory_movements_append_only BEFORE UPDATE OR DELETE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

ALTER TABLE stock_reservations
  ADD CONSTRAINT stock_reservations_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT stock_reservations_owner CHECK (order_id IS NOT NULL OR cart_id IS NOT NULL),
  ADD CONSTRAINT stock_reservations_closed_at CHECK ((status = 'active') = (closed_at IS NULL));

-- Reservation lifecycle: insert as active (reserved += q, fails if not enough
-- available); active -> consumed | released | expired (reserved -= q).
-- Closed reservations are immutable, so a double release is a no-op error.
-- For a sale: consume the reservation first, then insert the 'sale' movement.
CREATE OR REPLACE FUNCTION stock_reservations_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stock_reservations rows cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' THEN
      RAISE EXCEPTION 'reservations are created active' USING ERRCODE = 'P0001';
    END IF;
    PERFORM set_config('clicksp.inventory_write', 'on', true);
    UPDATE inventory_balances SET reserved = reserved + NEW.quantity, version = version + 1
     WHERE variant_id = NEW.variant_id AND location_id = NEW.location_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('clicksp.inventory_write', 'off', true);
    IF n = 0 THEN
      RAISE EXCEPTION 'no stock for variant % at location %', NEW.variant_id, NEW.location_id USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE
  IF OLD.status <> 'active' THEN
    RAISE EXCEPTION 'reservation % is already %', OLD.id, OLD.status USING ERRCODE = 'P0001';
  END IF;
  IF NEW.quantity <> OLD.quantity OR NEW.variant_id <> OLD.variant_id OR NEW.location_id <> OLD.location_id
     OR (OLD.order_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM OLD.order_id) THEN
    RAISE EXCEPTION 'reservation quantity and target are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status <> 'active' THEN
    NEW.closed_at := coalesce(NEW.closed_at, now());
    PERFORM set_config('clicksp.inventory_write', 'on', true);
    UPDATE inventory_balances SET reserved = reserved - OLD.quantity, version = version + 1
     WHERE variant_id = OLD.variant_id AND location_id = OLD.location_id;
    PERFORM set_config('clicksp.inventory_write', 'off', true);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_reservations_apply BEFORE INSERT OR UPDATE OR DELETE ON stock_reservations
  FOR EACH ROW EXECUTE FUNCTION stock_reservations_apply();

ALTER TABLE stock_adjustment_lines ADD CONSTRAINT stock_adjustment_lines_delta_non_zero CHECK (quantity_delta <> 0);
ALTER TABLE stock_adjustments ADD CONSTRAINT stock_adjustments_applied CHECK (
  (status = 'applied') = (applied_by IS NOT NULL AND applied_at IS NOT NULL));

ALTER TABLE inventory_count_lines
  ADD CONSTRAINT inventory_count_lines_quantities CHECK (expected_qty >= 0 AND (counted_qty IS NULL OR counted_qty >= 0));
ALTER TABLE inventory_counts ADD CONSTRAINT inventory_counts_completed CHECK (
  (status = 'completed') = (completed_by IS NOT NULL AND completed_at IS NOT NULL));

ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_distinct_warehouses CHECK (from_warehouse_id <> to_warehouse_id);
ALTER TABLE stock_transfer_lines ADD CONSTRAINT stock_transfer_lines_quantity_positive CHECK (quantity > 0);

ALTER TABLE stock_alerts ADD CONSTRAINT stock_alerts_threshold_non_negative CHECK (threshold >= 0);

-- =====================================================================
-- 7. SALES
-- =====================================================================
ALTER TABLE cart_items ADD CONSTRAINT cart_items_quantity_range CHECK (quantity BETWEEN 1 AND 999);
ALTER TABLE carts
  ADD CONSTRAINT carts_owner CHECK (user_id IS NOT NULL OR guest_token_hash IS NOT NULL),
  ADD CONSTRAINT carts_guest_token_hash_hex CHECK (guest_token_hash IS NULL OR guest_token_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE orders
  ADD CONSTRAINT orders_amounts_non_negative CHECK (
    subtotal >= 0 AND discount_total >= 0 AND shipping_total >= 0 AND tax_total >= 0 AND grand_total >= 0),
  ADD CONSTRAINT orders_discount_le_subtotal CHECK (discount_total <= subtotal),
  ADD CONSTRAINT orders_grand_total_formula CHECK (grand_total = subtotal - discount_total + shipping_total + tax_total),
  ADD CONSTRAINT orders_customer_phone_e164 CHECK (customer_phone ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT orders_coupon_code_upper CHECK (coupon_code IS NULL OR coupon_code = upper(coupon_code));

ALTER TABLE order_items
  ADD CONSTRAINT order_items_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT order_items_amounts_non_negative CHECK (
    unit_price >= 0 AND discount_total >= 0 AND tax_total >= 0 AND line_total >= 0),
  ADD CONSTRAINT order_items_discount_le_gross CHECK (discount_total <= unit_price * quantity),
  ADD CONSTRAINT order_items_line_total_formula CHECK (line_total = unit_price * quantity - discount_total + tax_total),
  ADD CONSTRAINT order_items_tax_rate_range CHECK (tax_rate_bp BETWEEN 0 AND 10000);

ALTER TABLE order_addresses
  ADD CONSTRAINT order_addresses_postal_code CHECK (postal_code ~ '^[0-9]{10}$'),
  ADD CONSTRAINT order_addresses_phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE delivery_addresses
  ADD CONSTRAINT delivery_addresses_postal_code CHECK (postal_code ~ '^[0-9]{10}$'),
  ADD CONSTRAINT delivery_addresses_phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{7,14}$');

-- Order state machine. Transitions are validated here and every change
-- (including creation) writes order_status_history with the acting user and
-- the optional reason from SET LOCAL app.status_reason.
CREATE OR REPLACE FUNCTION order_status_allowed(from_s order_status, to_s order_status) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE from_s
    WHEN 'pending_payment'  THEN to_s IN ('paid', 'cancelled')
    WHEN 'paid'             THEN to_s IN ('processing', 'cancelled', 'refunded')
    WHEN 'processing'       THEN to_s IN ('shipped', 'cancelled', 'refunded')
    WHEN 'shipped'          THEN to_s IN ('delivered', 'returned')
    WHEN 'delivered'        THEN to_s IN ('return_requested', 'refunded')
    WHEN 'return_requested' THEN to_s IN ('returned', 'delivered', 'refunded')
    WHEN 'returned'         THEN to_s IN ('refunded')
    WHEN 'cancelled'        THEN to_s IN ('refunded')
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION orders_state_machine() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE reason text := nullif(current_setting('app.status_reason', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending_payment' THEN
      RAISE EXCEPTION 'orders are created in pending_payment' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'pending_payment' AND (
       NEW.subtotal <> OLD.subtotal OR NEW.discount_total <> OLD.discount_total
    OR NEW.shipping_total <> OLD.shipping_total OR NEW.tax_total <> OLD.tax_total
    OR NEW.grand_total <> OLD.grand_total OR NEW.currency_code <> OLD.currency_code
    OR NEW.coupon_id IS DISTINCT FROM OLD.coupon_id) THEN
    RAISE EXCEPTION 'order amounts are frozen once the order is %', OLD.status USING ERRCODE = 'P0001';
  END IF;
  IF NEW.order_number <> OLD.order_number OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'order number and customer are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT order_status_allowed(OLD.status, NEW.status) THEN
      RAISE EXCEPTION 'order status cannot change from % to %', OLD.status, NEW.status USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status = 'paid' THEN NEW.paid_at := coalesce(NEW.paid_at, now()); END IF;
    IF NEW.status = 'cancelled' THEN
      NEW.cancelled_at := coalesce(NEW.cancelled_at, now());
      NEW.cancel_reason := coalesce(NEW.cancel_reason, reason);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_state_machine BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_state_machine();
CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();

CREATE OR REPLACE FUNCTION orders_log_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status <> OLD.status THEN
    INSERT INTO order_status_history (order_id, from_status, to_status, actor_user_id, reason)
    VALUES (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status, app_actor_id(),
            nullif(current_setting('app.status_reason', true), ''));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER orders_log_status AFTER INSERT OR UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_log_status();

CREATE TRIGGER order_status_history_append_only BEFORE UPDATE OR DELETE ON order_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- Order lines are snapshots: added only while the order awaits payment and
-- never changed or removed.
CREATE OR REPLACE FUNCTION order_items_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'order_items are immutable snapshots' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT status FROM orders WHERE id = NEW.order_id) <> 'pending_payment' THEN
    RAISE EXCEPTION 'items can only be added while the order awaits payment' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_items_guard BEFORE INSERT OR UPDATE OR DELETE ON order_items
  FOR EACH ROW EXECUTE FUNCTION order_items_guard();

-- At commit: an order has items, subtotal = sum(unit_price * quantity) and
-- discount_total = sum(line discounts incl. allocated order discount).
CREATE OR REPLACE FUNCTION orders_assert_totals() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE oid uuid; o orders; s bigint; d bigint; n integer;
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN oid := NEW.id; ELSE oid := NEW.order_id; END IF;
  SELECT * INTO o FROM orders WHERE id = oid;
  SELECT count(*), coalesce(sum(unit_price * quantity), 0), coalesce(sum(discount_total), 0)
    INTO n, s, d FROM order_items WHERE order_id = oid;
  IF n = 0 THEN
    RAISE EXCEPTION 'order % has no items', o.order_number USING ERRCODE = '23514';
  END IF;
  IF s <> o.subtotal OR d <> o.discount_total THEN
    RAISE EXCEPTION 'order % totals do not match its items (subtotal % vs %, discount % vs %)',
      o.order_number, o.subtotal, s, o.discount_total, d USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER orders_assert_totals AFTER INSERT OR UPDATE ON orders
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orders_assert_totals();
CREATE CONSTRAINT TRIGGER order_items_assert_totals AFTER INSERT ON order_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orders_assert_totals();

ALTER TABLE coupons
  ADD CONSTRAINT coupons_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{2,49}$'),
  ADD CONSTRAINT coupons_type_values CHECK (
    (type = 'percent' AND percent_bp BETWEEN 1 AND 10000 AND amount IS NULL) OR
    (type = 'fixed_amount' AND amount > 0 AND percent_bp IS NULL) OR
    (type = 'free_shipping' AND amount IS NULL AND percent_bp IS NULL)),
  ADD CONSTRAINT coupons_limits CHECK (
    (max_discount IS NULL OR max_discount > 0) AND (min_subtotal IS NULL OR min_subtotal >= 0) AND
    (usage_limit IS NULL OR usage_limit > 0) AND (per_user_limit IS NULL OR per_user_limit > 0) AND
    used_count >= 0 AND (usage_limit IS NULL OR used_count <= usage_limit)),
  ADD CONSTRAINT coupons_dates CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at);
ALTER TABLE coupon_redemptions ADD CONSTRAINT coupon_redemptions_amount_non_negative CHECK (amount >= 0);

ALTER TABLE order_return_items ADD CONSTRAINT order_return_items_quantity_positive CHECK (quantity > 0);

-- Returned quantity per order line never exceeds the ordered quantity, and
-- the line belongs to the returned order.
CREATE OR REPLACE FUNCTION order_return_items_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE item order_items; ret order_returns; already integer;
BEGIN
  SELECT * INTO item FROM order_items WHERE id = NEW.order_item_id FOR UPDATE;
  SELECT * INTO ret FROM order_returns WHERE id = NEW.return_id;
  IF item.order_id <> ret.order_id THEN
    RAISE EXCEPTION 'order item % is not part of the returned order', NEW.order_item_id USING ERRCODE = '23514';
  END IF;
  SELECT coalesce(sum(ri.quantity), 0) INTO already
    FROM order_return_items ri JOIN order_returns r ON r.id = ri.return_id
   WHERE ri.order_item_id = NEW.order_item_id AND ri.id <> NEW.id AND r.status NOT IN ('rejected', 'cancelled');
  IF already + NEW.quantity > item.quantity THEN
    RAISE EXCEPTION 'cannot return % of item % (ordered %, already returned %)',
      NEW.quantity, NEW.order_item_id, item.quantity, already USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_return_items_guard BEFORE INSERT OR UPDATE ON order_return_items
  FOR EACH ROW EXECUTE FUNCTION order_return_items_guard();

ALTER TABLE order_refunds ADD CONSTRAINT order_refunds_amount_positive CHECK (amount > 0);

-- Refunds never exceed what the customer paid (the order's grand_total).
-- The order row is locked so concurrent refunds are serialized.
CREATE OR REPLACE FUNCTION order_refunds_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE total bigint; already bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.amount <> OLD.amount OR NEW.order_id <> OLD.order_id OR NEW.currency_code <> OLD.currency_code) THEN
    RAISE EXCEPTION 'refund amount, order and currency are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('completed', 'failed', 'cancelled') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'refund % is already %', OLD.id, OLD.status USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status IN ('failed', 'cancelled') THEN RETURN NEW; END IF;
  SELECT grand_total INTO total FROM orders WHERE id = NEW.order_id FOR UPDATE;
  SELECT coalesce(sum(amount), 0) INTO already FROM order_refunds
   WHERE order_id = NEW.order_id AND id <> NEW.id AND status NOT IN ('failed', 'cancelled');
  IF already + NEW.amount > total THEN
    RAISE EXCEPTION 'refunds (% + %) would exceed the order total %', already, NEW.amount, total USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_refunds_guard BEFORE INSERT OR UPDATE ON order_refunds
  FOR EACH ROW EXECUTE FUNCTION order_refunds_guard();
CREATE TRIGGER order_refunds_no_delete BEFORE DELETE ON order_refunds
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();

ALTER TABLE invoices
  ADD CONSTRAINT invoices_amounts_non_negative CHECK (
    subtotal >= 0 AND discount_total >= 0 AND shipping_total >= 0 AND tax_total >= 0 AND grand_total >= 0),
  ADD CONSTRAINT invoices_grand_total_formula CHECK (grand_total = subtotal - discount_total + shipping_total + tax_total),
  ADD CONSTRAINT invoices_credit_note_link CHECK ((type = 'credit_note') = (credits_invoice_id IS NOT NULL));

-- Issued invoices are immutable except the e-invoice submission fields.
CREATE OR REPLACE FUNCTION invoices_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoices cannot be deleted; issue a credit note' USING ERRCODE = 'P0001';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['einvoice_status', 'einvoice_reference', 'einvoice_message', 'updated_at'])
     <> (to_jsonb(OLD) - ARRAY['einvoice_status', 'einvoice_reference', 'einvoice_message', 'updated_at']) THEN
    RAISE EXCEPTION 'issued invoices are immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoices_guard BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_guard();

-- =====================================================================
-- 8. PAYMENTS
-- =====================================================================
ALTER TABLE payment_providers ADD CONSTRAINT payment_providers_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,49}$');

ALTER TABLE payment_transactions
  ADD CONSTRAINT payment_transactions_amount_positive CHECK (amount > 0),
  ADD CONSTRAINT payment_transactions_refund_link CHECK ((kind = 'refund') = (refund_id IS NOT NULL)),
  ADD CONSTRAINT payment_transactions_succeeded_verified CHECK (
    status <> 'succeeded' OR (verified_at IS NOT NULL AND provider_reference IS NOT NULL));

-- Final payment rows are immutable except for linking the journal entry;
-- identity columns never change. Rows are never deleted.
CREATE OR REPLACE FUNCTION payment_transactions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment_transactions rows cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.order_id <> OLD.order_id OR NEW.provider_id <> OLD.provider_id OR NEW.kind <> OLD.kind
     OR NEW.amount <> OLD.amount OR NEW.currency_code <> OLD.currency_code
     OR NEW.our_reference <> OLD.our_reference OR NEW.idempotency_key <> OLD.idempotency_key THEN
    RAISE EXCEPTION 'payment identity and amount are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status IN ('succeeded', 'failed', 'cancelled', 'expired') THEN
    IF (to_jsonb(NEW) - ARRAY['accounting_transaction_id', 'updated_at'])
       <> (to_jsonb(OLD) - ARRAY['accounting_transaction_id', 'updated_at'])
       OR (OLD.accounting_transaction_id IS NOT NULL
           AND NEW.accounting_transaction_id IS DISTINCT FROM OLD.accounting_transaction_id) THEN
      RAISE EXCEPTION 'payment % is final (%)', OLD.our_reference, OLD.status USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_transactions_guard BEFORE UPDATE OR DELETE ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION payment_transactions_guard();

CREATE TRIGGER payment_callback_logs_append_only BEFORE UPDATE OR DELETE ON payment_callback_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- =====================================================================
-- 9. ACCOUNTING (double entry)
-- =====================================================================
ALTER TABLE financial_accounts
  ADD CONSTRAINT financial_accounts_code_format CHECK (code ~ '^[0-9A-Z][0-9A-Z.-]{0,19}$'),
  ADD CONSTRAINT financial_accounts_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id);
CREATE TRIGGER financial_accounts_no_cycle BEFORE INSERT OR UPDATE OF parent_id ON financial_accounts
  FOR EACH ROW EXECUTE FUNCTION tree_no_cycle();

CREATE OR REPLACE FUNCTION financial_accounts_type_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND (SELECT type FROM financial_accounts WHERE id = NEW.parent_id) <> NEW.type THEN
    RAISE EXCEPTION 'account % must have the same type as its parent', NEW.code USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.type <> OLD.type AND (
       EXISTS (SELECT 1 FROM accounting_entries WHERE account_id = NEW.id)
    OR EXISTS (SELECT 1 FROM financial_accounts WHERE parent_id = NEW.id)) THEN
    RAISE EXCEPTION 'account % has entries or children; its type cannot change', NEW.code USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER financial_accounts_type_guard BEFORE INSERT OR UPDATE ON financial_accounts
  FOR EACH ROW EXECUTE FUNCTION financial_accounts_type_guard();
CREATE TRIGGER financial_accounts_no_delete BEFORE DELETE ON financial_accounts
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();

ALTER TABLE financial_periods
  ADD CONSTRAINT financial_periods_dates CHECK (end_date >= start_date),
  ADD CONSTRAINT financial_periods_closed CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  ADD CONSTRAINT financial_periods_no_overlap EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&);

-- A period's dates cannot change once it holds transactions.
CREATE OR REPLACE FUNCTION financial_periods_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM accounting_transactions WHERE period_id = OLD.id) THEN
      RAISE EXCEPTION 'period % has transactions and cannot be deleted', OLD.name USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.start_date <> OLD.start_date OR NEW.end_date <> OLD.end_date)
     AND EXISTS (SELECT 1 FROM accounting_transactions WHERE period_id = NEW.id) THEN
    RAISE EXCEPTION 'period % has transactions; its dates cannot change', NEW.name USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER financial_periods_guard BEFORE UPDATE OR DELETE ON financial_periods
  FOR EACH ROW EXECUTE FUNCTION financial_periods_guard();

ALTER TABLE accounting_transactions
  ADD CONSTRAINT accounting_transactions_posted_fields CHECK ((status = 'posted') = (posted_at IS NOT NULL)),
  ADD CONSTRAINT accounting_transactions_not_self_reversal CHECK (reverses_id IS NULL OR reverses_id <> id),
  ADD CONSTRAINT accounting_transactions_reversal_source CHECK ((source_type = 'reversal') = (reverses_id IS NOT NULL));

-- Journal flow: insert as draft -> add entries -> UPDATE status = 'posted'.
-- Posted transactions are immutable and cannot be deleted. The period must
-- be open and contain the entry date. A reversal must reverse a posted one.
CREATE OR REPLACE FUNCTION accounting_transactions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE p financial_periods;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'posted transaction % cannot be deleted; post a reversal', OLD.journal_number USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
    RAISE EXCEPTION 'posted transaction % is immutable; post a reversal', OLD.journal_number USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status = 'posted' THEN
    RAISE EXCEPTION 'insert transactions as draft, add entries, then post' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO p FROM financial_periods WHERE id = NEW.period_id;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'financial period % is closed', p.name USING ERRCODE = 'P0001';
  END IF;
  IF NEW.entry_date < p.start_date OR NEW.entry_date > p.end_date THEN
    RAISE EXCEPTION 'entry date % is outside period %', NEW.entry_date, p.name USING ERRCODE = '23514';
  END IF;
  IF NEW.reverses_id IS NOT NULL AND (SELECT status FROM accounting_transactions WHERE id = NEW.reverses_id) <> 'posted' THEN
    RAISE EXCEPTION 'only posted transactions can be reversed' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'posted' THEN
    NEW.posted_at := coalesce(NEW.posted_at, now());
    NEW.posted_by := coalesce(NEW.posted_by, app_actor_id());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accounting_transactions_guard BEFORE INSERT OR UPDATE OR DELETE ON accounting_transactions
  FOR EACH ROW EXECUTE FUNCTION accounting_transactions_guard();

ALTER TABLE accounting_entries
  ADD CONSTRAINT accounting_entries_amounts_non_negative CHECK (debit >= 0 AND credit >= 0),
  ADD CONSTRAINT accounting_entries_one_side CHECK ((debit > 0) <> (credit > 0)),
  ADD CONSTRAINT accounting_entries_line_no_positive CHECK (line_no > 0);

-- Entries change only while their transaction is a draft, and only on
-- active, postable accounts in the transaction's currency.
CREATE OR REPLACE FUNCTION accounting_entries_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE t accounting_transactions; a financial_accounts;
BEGIN
  SELECT * INTO t FROM accounting_transactions WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.transaction_id ELSE NEW.transaction_id END;
  IF t.status = 'posted' THEN
    RAISE EXCEPTION 'entries of posted transaction % are immutable', t.journal_number USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.transaction_id <> OLD.transaction_id THEN
    RAISE EXCEPTION 'an entry cannot move to another transaction' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT * INTO a FROM financial_accounts WHERE id = NEW.account_id;
  IF NOT a.is_postable OR NOT a.is_active THEN
    RAISE EXCEPTION 'account % is not postable or not active', a.code USING ERRCODE = '23514';
  END IF;
  IF a.currency_code <> t.currency_code THEN
    RAISE EXCEPTION 'account % currency % differs from transaction currency %', a.code, a.currency_code, t.currency_code
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accounting_entries_guard BEFORE INSERT OR UPDATE OR DELETE ON accounting_entries
  FOR EACH ROW EXECUTE FUNCTION accounting_entries_guard();

-- Every posted transaction balances: at least two lines, sum(debit) =
-- sum(credit) > 0. Checked at commit (deferred).
CREATE OR REPLACE FUNCTION accounting_assert_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE d bigint; c bigint; n integer; st journal_status;
BEGIN
  SELECT status INTO st FROM accounting_transactions WHERE id = NEW.id;
  IF st IS DISTINCT FROM 'posted' THEN RETURN NULL; END IF;
  SELECT count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) INTO n, d, c
    FROM accounting_entries WHERE transaction_id = NEW.id;
  IF n < 2 OR d <> c OR d = 0 THEN
    RAISE EXCEPTION 'transaction % does not balance (lines %, debit %, credit %)', NEW.journal_number, n, d, c
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER accounting_transactions_balanced AFTER UPDATE OF status ON accounting_transactions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION accounting_assert_balanced();

ALTER TABLE expenses ADD CONSTRAINT expenses_amount_positive CHECK (amount > 0);
ALTER TABLE income_records ADD CONSTRAINT income_records_amount_positive CHECK (amount > 0);
ALTER TABLE reconciliation_statements ADD CONSTRAINT reconciliation_statements_dates CHECK (period_end >= period_start);
ALTER TABLE reconciliation_lines
  ADD CONSTRAINT reconciliation_lines_amount_non_zero CHECK (amount <> 0),
  ADD CONSTRAINT reconciliation_lines_matched CHECK (
    (status = 'matched') = (payment_transaction_id IS NOT NULL OR accounting_entry_id IS NOT NULL));

-- =====================================================================
-- 10. SHIPPING
-- =====================================================================
ALTER TABLE shipping_providers
  ADD CONSTRAINT shipping_providers_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  ADD CONSTRAINT shipping_providers_tracking_https CHECK (tracking_url_template IS NULL OR tracking_url_template ~ '^https://');
ALTER TABLE shipping_methods
  ADD CONSTRAINT shipping_methods_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  ADD CONSTRAINT shipping_methods_days CHECK (
    (min_delivery_days IS NULL OR min_delivery_days >= 0) AND
    (max_delivery_days IS NULL OR max_delivery_days >= coalesce(min_delivery_days, 0)));
ALTER TABLE shipping_zones ADD CONSTRAINT shipping_zones_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,49}$');
ALTER TABLE shipping_rates
  ADD CONSTRAINT shipping_rates_weights CHECK (min_weight_grams >= 0 AND (max_weight_grams IS NULL OR max_weight_grams > min_weight_grams)),
  ADD CONSTRAINT shipping_rates_amounts CHECK (
    base_amount >= 0 AND per_kg_amount >= 0 AND (free_above_subtotal IS NULL OR free_above_subtotal > 0));
ALTER TABLE shipments ADD CONSTRAINT shipments_cost_non_negative CHECK (cost IS NULL OR cost >= 0);
ALTER TABLE shipment_items ADD CONSTRAINT shipment_items_quantity_positive CHECK (quantity > 0);
CREATE TRIGGER shipment_tracking_events_append_only BEFORE UPDATE OR DELETE ON shipment_tracking_events
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- =====================================================================
-- 11. CONTENT AND PAGE BUILDER
-- =====================================================================
ALTER TABLE media_library
  ADD CONSTRAINT media_library_size_positive CHECK (size_bytes > 0),
  ADD CONSTRAINT media_library_sha256_hex CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT media_library_dimensions CHECK ((width IS NULL OR width > 0) AND (height IS NULL OR height > 0)),
  ADD CONSTRAINT media_library_kind_mime CHECK (
    (kind = 'image' AND mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')) OR
    (kind = 'document' AND mime_type IN ('application/pdf', 'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) OR
    (kind = 'video' AND mime_type IN ('video/mp4', 'video/webm')));

ALTER TABLE article_categories ADD CONSTRAINT article_categories_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id);
CREATE TRIGGER article_categories_no_cycle BEFORE INSERT OR UPDATE OF parent_id ON article_categories
  FOR EACH ROW EXECUTE FUNCTION tree_no_cycle();
ALTER TABLE article_category_translations ADD CONSTRAINT article_category_translations_slug_format CHECK (slug ~ '^[a-z0-9؀-ۿ]+(-[a-z0-9؀-ۿ]+)*$');
ALTER TABLE article_tag_translations ADD CONSTRAINT article_tag_translations_slug_format CHECK (slug ~ '^[a-z0-9؀-ۿ]+(-[a-z0-9؀-ۿ]+)*$');
ALTER TABLE article_translations ADD CONSTRAINT article_translations_slug_format CHECK (slug ~ '^[a-z0-9؀-ۿ]+(-[a-z0-9؀-ۿ]+)*$');
ALTER TABLE page_translations ADD CONSTRAINT page_translations_slug_format CHECK (slug ~ '^[a-z0-9؀-ۿ]+(-[a-z0-9؀-ۿ]+)*(/[a-z0-9؀-ۿ]+(-[a-z0-9؀-ۿ]+)*)*$');
ALTER TABLE articles ADD CONSTRAINT articles_published_has_date CHECK (status <> 'published' OR published_at IS NOT NULL);
ALTER TABLE article_images ADD CONSTRAINT article_images_alt_has_fa CHECK (jsonb_typeof(alt) = 'object' AND alt ? 'fa');

ALTER TABLE page_revisions
  ADD CONSTRAINT page_revisions_revision_no_positive CHECK (revision_no > 0),
  ADD CONSTRAINT page_revisions_schema_version_positive CHECK (schema_version > 0),
  ADD CONSTRAINT page_revisions_document_object CHECK (jsonb_typeof(document) = 'object'),
  ADD CONSTRAINT page_revisions_published CHECK (
    (status = 'draft') OR (published_by IS NOT NULL AND published_at IS NOT NULL));

-- A revision's content never changes (rollback = publish an older revision);
-- only its status/publication fields move. Published revisions are kept.
CREATE OR REPLACE FUNCTION page_revisions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'published revisions are kept for rollback and cannot be deleted' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.document <> OLD.document OR NEW.schema_version <> OLD.schema_version
     OR NEW.page_id <> OLD.page_id OR NEW.revision_no <> OLD.revision_no OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'page revision content is immutable; create a new revision' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER page_revisions_guard BEFORE UPDATE OR DELETE ON page_revisions
  FOR EACH ROW EXECUTE FUNCTION page_revisions_guard();

-- The published revision of a page must belong to that page.
CREATE OR REPLACE FUNCTION pages_published_revision_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.published_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM page_revisions WHERE id = NEW.published_revision_id AND page_id = NEW.id) THEN
    RAISE EXCEPTION 'published revision does not belong to this page' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pages_published_revision_check BEFORE INSERT OR UPDATE OF published_revision_id ON pages
  FOR EACH ROW EXECUTE FUNCTION pages_published_revision_check();

ALTER TABLE page_sections ADD CONSTRAINT page_sections_document_object CHECK (jsonb_typeof(document) = 'object');
ALTER TABLE page_templates ADD CONSTRAINT page_templates_document_object CHECK (jsonb_typeof(document) = 'object');
ALTER TABLE menus ADD CONSTRAINT menus_document_object CHECK (jsonb_typeof(document) = 'object');
ALTER TABLE banners
  ADD CONSTRAINT banners_href_safe CHECK (href IS NULL OR href ~ '^(/[^/]|https://)'),
  ADD CONSTRAINT banners_dates CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at);
