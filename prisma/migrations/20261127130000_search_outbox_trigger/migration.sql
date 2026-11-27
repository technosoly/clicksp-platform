-- Search index upkeep: any change to a product, its texts, variants or part
-- numbers writes a `search.product_changed` outbox event in the same
-- transaction, so the search index can never silently miss a change. At most
-- one such event per product waits at a time: the handler reads the product's
-- current state, so one delivery covers every change made before it.
--
-- The waiting event is locked until this transaction ends. The runner claims
-- events with SKIP LOCKED, so it can't take that event (and read the product
-- as it was before this change) until the change is committed. If the runner
-- claimed it first, it is no longer 'pending' and a new event is written.
CREATE OR REPLACE FUNCTION search_product_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  row_data record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  pid uuid;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    pid := row_data.id;
  ELSE
    pid := row_data.product_id;
  END IF;
  PERFORM 1 FROM outbox_events
   WHERE aggregate_type = 'product' AND aggregate_id = pid AND topic = 'search.product_changed' AND status = 'pending'
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload)
    VALUES ('search.product_changed', 'product', pid, '{}'::jsonb);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER products_search_changed AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION search_product_changed();
CREATE TRIGGER product_translations_search_changed AFTER INSERT OR UPDATE OR DELETE ON product_translations
  FOR EACH ROW EXECUTE FUNCTION search_product_changed();
CREATE TRIGGER product_variants_search_changed AFTER INSERT OR UPDATE OR DELETE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION search_product_changed();
CREATE TRIGGER product_identifiers_search_changed AFTER INSERT OR UPDATE OR DELETE ON product_identifiers
  FOR EACH ROW EXECUTE FUNCTION search_product_changed();
