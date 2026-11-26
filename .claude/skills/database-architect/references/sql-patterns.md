# SQL patterns used in migrations

## Append-only ledger
```sql
CREATE OR REPLACE FUNCTION forbid_update_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER inventory_movements_append_only
BEFORE UPDATE OR DELETE ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
```

## Balanced journal (checked at commit)
```sql
CREATE OR REPLACE FUNCTION assert_transaction_balanced() RETURNS trigger AS $$
DECLARE d BIGINT; c BIGINT; st TEXT;
BEGIN
  SELECT status INTO st FROM accounting_transactions WHERE id = NEW.transaction_id;
  IF st <> 'posted' THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO d, c
    FROM accounting_entries WHERE transaction_id = NEW.transaction_id;
  IF d <> c OR d = 0 THEN
    RAISE EXCEPTION 'transaction % unbalanced (debit %, credit %)', NEW.transaction_id, d, c;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER accounting_entries_balanced
AFTER INSERT ON accounting_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_transaction_balanced();
```
Also add a deferred trigger on `accounting_transactions` when status changes to `posted`.

## Stock balance guards
```sql
ALTER TABLE inventory_balances
  ADD CONSTRAINT on_hand_non_negative CHECK (on_hand >= 0),
  ADD CONSTRAINT reserved_non_negative CHECK (reserved >= 0),
  ADD CONSTRAINT reserved_le_on_hand CHECK (reserved <= on_hand);
```

## Soft-delete aware uniqueness
```sql
CREATE UNIQUE INDEX product_variants_sku_active ON product_variants (sku) WHERE deleted_at IS NULL;
```

## Trigram search fallback
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX product_translations_title_trgm ON product_translations USING gin (search_title gin_trgm_ops);
```
`search_title` holds the normalized text produced by `src/lib/persian-text`.

## Money columns
```sql
amount BIGINT NOT NULL CHECK (amount >= 0),
currency_code CHAR(3) NOT NULL DEFAULT 'IRR' REFERENCES currencies(code)
```
