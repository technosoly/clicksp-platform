-- Security hardening after the independent Phase 3 review.
-- Each block names the finding it closes. Triggers are a correctness layer:
-- the Phase 10 least-privilege application role (no TRUNCATE, no direct
-- writes to balances or permissions) is still required before launch.

-- ---------------------------------------------------------------------
-- 1. Permission keys are immutable (the app checks keys, so renaming a
--    key could move a Super Admin-only meaning onto a lower-level grant).
--    A scope type cannot change while the permission is granted scoped.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION permissions_identity_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.key <> OLD.key THEN
    RAISE EXCEPTION 'permission keys are immutable (% -> %)', OLD.key, NEW.key USING ERRCODE = 'P0001';
  END IF;
  IF NEW.scope_type IS DISTINCT FROM OLD.scope_type
     AND EXISTS (SELECT 1 FROM role_permissions WHERE permission_id = NEW.id AND is_scoped) THEN
    RAISE EXCEPTION 'permission % is granted scoped; its scope type cannot change', NEW.key USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER permissions_identity_guard BEFORE UPDATE ON permissions
  FOR EACH ROW EXECUTE FUNCTION permissions_identity_guard();

-- ---------------------------------------------------------------------
-- 2. Journals: lock the parent transaction while writing entries, and the
--    period while writing a transaction, so posting, adding entries and
--    closing a period are serialized (FOR SHARE conflicts with the
--    FOR NO KEY UPDATE lock an UPDATE takes).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION accounting_entries_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE t accounting_transactions; a financial_accounts;
BEGIN
  SELECT * INTO t FROM accounting_transactions
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.transaction_id ELSE NEW.transaction_id END
   FOR SHARE;
  IF t.status = 'posted' THEN
    RAISE EXCEPTION 'entries of posted transaction % are immutable', t.journal_number USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.transaction_id <> OLD.transaction_id THEN
    RAISE EXCEPTION 'an entry cannot move to another transaction' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT * INTO a FROM financial_accounts WHERE id = NEW.account_id FOR SHARE;
  IF NOT a.is_postable OR NOT a.is_active THEN
    RAISE EXCEPTION 'account % is not postable or not active', a.code USING ERRCODE = '23514';
  END IF;
  IF a.currency_code <> t.currency_code THEN
    RAISE EXCEPTION 'account % currency % differs from transaction currency %', a.code, a.currency_code, t.currency_code
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

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
  SELECT * INTO p FROM financial_periods WHERE id = NEW.period_id FOR SHARE;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'financial period % is closed', p.name USING ERRCODE = 'P0001';
  END IF;
  IF NEW.entry_date < p.start_date OR NEW.entry_date > p.end_date THEN
    RAISE EXCEPTION 'entry date % is outside period %', NEW.entry_date, p.name USING ERRCODE = '23514';
  END IF;
  IF NEW.reverses_id IS NOT NULL
     AND (SELECT status FROM accounting_transactions WHERE id = NEW.reverses_id FOR SHARE) <> 'posted' THEN
    RAISE EXCEPTION 'only posted transactions can be reversed' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'posted' THEN
    NEW.posted_at := coalesce(NEW.posted_at, now());
    NEW.posted_by := coalesce(NEW.posted_by, app_actor_id());
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 3. TRUNCATE bypasses row triggers: refuse it on every ledger, log and
--    never-delete table.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% cannot be truncated', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audit_logs', 'login_attempts', 'security_events', 'system_logs', 'users', 'admin_approvals',
    'product_prices', 'inventory_balances', 'inventory_movements', 'stock_reservations',
    'orders', 'order_items', 'order_status_history', 'order_refunds', 'invoices',
    'payment_transactions', 'payment_callback_logs', 'shipment_tracking_events',
    'financial_accounts', 'financial_periods', 'accounting_transactions', 'accounting_entries',
    'page_revisions'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate()',
                   t || '_no_truncate', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 5. Approvals: created pending, the request never changes, and a
--    decision is final (approved may then only become executed or failed).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_approvals_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'approvals cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL THEN
      RAISE EXCEPTION 'approvals are created pending and undecided' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.action <> OLD.action OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id OR NEW.payload <> OLD.payload
     OR NEW.requested_by <> OLD.requested_by OR NEW.expires_at <> OLD.expires_at
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'the approval request is immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.decided_by IS NOT NULL AND (NEW.decided_by IS DISTINCT FROM OLD.decided_by
     OR NEW.decided_at IS DISTINCT FROM OLD.decided_at OR NEW.decision_note IS DISTINCT FROM OLD.decision_note) THEN
    RAISE EXCEPTION 'an approval decision is final' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'cancelled', 'expired'))
    OR (OLD.status = 'approved' AND NEW.status IN ('executed', 'failed'))) THEN
    RAISE EXCEPTION 'approval status cannot change from % to %', OLD.status, NEW.status USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'approved' AND OLD.status = 'pending' AND NEW.expires_at <= now() THEN
    RAISE EXCEPTION 'approval request has expired' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER admin_approvals_guard BEFORE INSERT OR UPDATE OR DELETE ON admin_approvals
  FOR EACH ROW EXECUTE FUNCTION admin_approvals_guard();

-- ---------------------------------------------------------------------
-- 6. An order becomes paid only with one succeeded payment for exactly
--    its grand total and currency.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION orders_require_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'paid' AND OLD.status = 'pending_payment' AND NOT EXISTS (
       SELECT 1 FROM payment_transactions
        WHERE order_id = NEW.id AND kind = 'payment' AND status = 'succeeded'
          AND amount = NEW.grand_total AND currency_code = NEW.currency_code) THEN
    RAISE EXCEPTION 'order % has no succeeded payment of % %', NEW.order_number, NEW.grand_total, NEW.currency_code
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_require_payment BEFORE UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_require_payment();

-- Refunds only for orders that were paid (never while awaiting payment).
CREATE OR REPLACE FUNCTION order_refunds_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE total bigint; o_status order_status; already bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.amount <> OLD.amount OR NEW.order_id <> OLD.order_id OR NEW.currency_code <> OLD.currency_code) THEN
    RAISE EXCEPTION 'refund amount, order and currency are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('completed', 'failed', 'cancelled') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'refund % is already %', OLD.id, OLD.status USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status IN ('failed', 'cancelled') THEN RETURN NEW; END IF;
  SELECT grand_total, status INTO total, o_status FROM orders WHERE id = NEW.order_id FOR UPDATE;
  IF TG_OP = 'INSERT' AND o_status = 'pending_payment' THEN
    RAISE EXCEPTION 'an order awaiting payment cannot be refunded' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(sum(amount), 0) INTO already FROM order_refunds
   WHERE order_id = NEW.order_id AND id <> NEW.id AND status NOT IN ('failed', 'cancelled');
  IF already + NEW.amount > total THEN
    RAISE EXCEPTION 'refunds (% + %) would exceed the order total %', already, NEW.amount, total USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 7. Relative links: no "/\host" (browsers read "\" as "/") and no
--    control characters.
-- ---------------------------------------------------------------------
ALTER TABLE banners DROP CONSTRAINT banners_href_safe,
  ADD CONSTRAINT banners_href_safe CHECK (
    href IS NULL OR (href ~ '^(/[^/\\]|https://[^/\\])' AND href !~ '[[:cntrl:]\\]'));
ALTER TABLE seo_metadata DROP CONSTRAINT seo_metadata_canonical_relative,
  ADD CONSTRAINT seo_metadata_canonical_relative CHECK (
    canonical_path IS NULL OR (canonical_path ~ '^/[^/\\]' AND canonical_path !~ '[[:cntrl:]\\]'));

-- ---------------------------------------------------------------------
-- 8. Last Super Admin: only non-expiring grants count, so an expiry date
--    cannot lock everyone out later. The check needs a fresh snapshot, so
--    it refuses REPEATABLE READ (SERIALIZABLE detects the conflict itself).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION active_super_admin_count() RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM users u
  WHERE u.status = 'active' AND EXISTS (
    SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = u.id AND r.level = 1 AND r.is_active AND ur.expires_at IS NULL);
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
    IF current_setting('transaction_isolation') = 'repeatable read' THEN
      RAISE EXCEPTION 'Super Admin changes must run in READ COMMITTED or SERIALIZABLE' USING ERRCODE = 'P0001';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('clicksp.last_super_admin'));
    IF active_super_admin_count() = 0 THEN
      RAISE EXCEPTION 'the last active Super Admin cannot be removed, disabled or demoted' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NULL;
END $$;
