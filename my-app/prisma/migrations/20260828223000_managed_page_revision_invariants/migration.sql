-- Managed page editing is a single-draft/single-published contract. Refuse to
-- guess which existing duplicate is authoritative; operators must reconcile
-- conflicting history before this migration can proceed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ManagedPageRevision"
    WHERE "status" = 'draft'
    GROUP BY "pageKey"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'ManagedPageRevision contains multiple drafts for one page';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ManagedPageRevision"
    WHERE "status" = 'published'
    GROUP BY "pageKey"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'ManagedPageRevision contains multiple published revisions for one page';
  END IF;
END $$;

CREATE UNIQUE INDEX "ManagedPageRevision_one_draft_per_page"
  ON "ManagedPageRevision" ("pageKey")
  WHERE "status" = 'draft';

CREATE UNIQUE INDEX "ManagedPageRevision_one_published_per_page"
  ON "ManagedPageRevision" ("pageKey")
  WHERE "status" = 'published';
