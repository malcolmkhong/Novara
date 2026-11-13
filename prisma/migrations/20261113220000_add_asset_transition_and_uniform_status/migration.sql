-- STEP 79 — the uniform canon status and the transition log.
--
-- 1. The new AssetTransition table (every reopen and every finalize is logged).
-- 2. ChapterPack joins the uniform status layer (it had none).
-- 3. Chapter gets the finalizedAt stamp every other authored entity has.
-- 4. The data migration: "revised" is retired as a stored value (a reopened
--    chapter is a draft) and the final chapters get their stamp.
--
-- The columns are added with IF NOT EXISTS so this migration is safe to run
-- against a database where the columns were already added by hand.

-- CreateTable
CREATE TABLE IF NOT EXISTS "AssetTransition" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "byUid" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'author',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "AssetTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AssetTransition_novelId_kind_assetId_idx" ON "AssetTransition"("novelId", "kind", "assetId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AssetTransition_assetId_at_idx" ON "AssetTransition"("assetId", "at");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = "AssetTransition_novelId_fkey"
    ) THEN
        ALTER TABLE "AssetTransition" ADD CONSTRAINT "AssetTransition_novelId_fkey"
        FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AlterTable
ALTER TABLE "ChapterPack" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE "ChapterPack" ADD COLUMN IF NOT EXISTS "finalizedAt" TIMESTAMP(3);
ALTER TABLE "Chapter" ADD COLUMN IF NOT EXISTS "finalizedAt" TIMESTAMP(3);

-- The vocabulary: one uniform status with exactly two values, draft | final.
UPDATE "Chapter" SET "status" = 'draft' WHERE "status" = 'revised';
UPDATE "Chapter" SET "finalizedAt" = "updatedAt" WHERE "status" = 'final' AND "finalizedAt" IS NULL;
