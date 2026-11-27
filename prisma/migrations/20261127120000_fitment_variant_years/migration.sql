-- A link to a specific variant must lie within that variant's own years
-- (falling back to its generation's years where the variant has none), and
-- a variant's years cannot be narrowed so that its links fall outside them.

CREATE OR REPLACE FUNCTION years_within_variant(var_id uuid, y_from smallint, y_to smallint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(y_from, lo) >= lo
     AND coalesce(y_to, y_from, lo) >= lo
     AND (hi IS NULL OR (coalesce(y_to, y_from, lo) <= hi AND coalesce(y_from, lo) <= hi))
  FROM (
    SELECT coalesce(v.year_from, g.year_from) AS lo, coalesce(v.year_to, g.year_to) AS hi
      FROM motorcycle_variants v JOIN motorcycle_generations g ON g.id = v.generation_id
     WHERE v.id = var_id
  ) r;
$$;

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
  IF NEW.motorcycle_variant_id IS NOT NULL AND NOT years_within_variant(NEW.motorcycle_variant_id, NEW.year_from, NEW.year_to) THEN
    RAISE EXCEPTION 'fitment years %-% are outside the motorcycle variant', NEW.year_from, NEW.year_to
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

-- Changing a variant's years or generation must not strand its fitment rows.
CREATE OR REPLACE FUNCTION motorcycle_variants_links_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM product_compatibilities c WHERE c.motorcycle_variant_id = NEW.id
             AND NOT (years_within_variant(NEW.id, c.year_from, c.year_to)
                      AND years_within_generation(NEW.generation_id, c.year_from, c.year_to))) THEN
    RAISE EXCEPTION 'variant years would exclude existing fitment rows' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER motorcycle_variants_links_check AFTER UPDATE OF year_from, year_to, generation_id ON motorcycle_variants
  FOR EACH ROW EXECUTE FUNCTION motorcycle_variants_links_check();
