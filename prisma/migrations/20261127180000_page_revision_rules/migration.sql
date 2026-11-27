-- Page revisions: at most one published revision per page, status moves only
-- forward (draft -> published -> superseded), and a restored revision
-- records which revision it was copied from.
ALTER TABLE page_revisions ADD COLUMN restored_from INTEGER;
ALTER TABLE page_revisions ADD CONSTRAINT page_revisions_restored_from_positive CHECK (restored_from IS NULL OR restored_from > 0);

CREATE UNIQUE INDEX page_revisions_one_published ON page_revisions (page_id) WHERE status = 'published';

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
     OR NEW.page_id <> OLD.page_id OR NEW.revision_no <> OLD.revision_no OR NEW.created_by <> OLD.created_by
     OR NEW.restored_from IS DISTINCT FROM OLD.restored_from THEN
    RAISE EXCEPTION 'page revision content is immutable; create a new revision' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'draft' AND NEW.status = 'published')
    OR (OLD.status = 'published' AND NEW.status = 'superseded')) THEN
    RAISE EXCEPTION 'page revision status can only move draft -> published -> superseded' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status <> 'draft' AND (NEW.published_by IS DISTINCT FROM OLD.published_by OR NEW.published_at IS DISTINCT FROM OLD.published_at OR NEW.note IS DISTINCT FROM OLD.note) THEN
    RAISE EXCEPTION 'a published revision''s publication record is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
