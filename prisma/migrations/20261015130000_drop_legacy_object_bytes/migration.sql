-- Drop inline file bytes only after they have been copied to the object store.
-- If this migration fails, run scripts/backfill-legacy-object-bytes.ts and deploy again.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "TenderAttachment" WHERE "content" IS NOT NULL AND octet_length("content") > 0) THEN
    RAISE EXCEPTION 'legacy tender attachment bytes remain; run scripts/backfill-legacy-object-bytes.ts before dropping content';
  END IF;
  IF EXISTS (SELECT 1 FROM "VerificationDocument" WHERE "content" IS NOT NULL AND octet_length("content") > 0) THEN
    RAISE EXCEPTION 'legacy verification document bytes remain; run scripts/backfill-legacy-object-bytes.ts before dropping content';
  END IF;
END $$;

ALTER TABLE "TenderAttachment" DROP COLUMN "content";
ALTER TABLE "VerificationDocument" DROP COLUMN "content";
