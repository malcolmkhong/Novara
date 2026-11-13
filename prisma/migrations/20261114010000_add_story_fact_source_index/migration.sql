-- STEP 80 — the index the replacement rule needs.
--
-- Finalizing a chapter REPLACES that chapter's facts: every live fact whose
-- SOURCE is the chapter is retired and re-derived. StoryFact.sourceChapter
-- (the chapter INDEX) already existed — no column is added here — but it had
-- no index, so every projection scanned the whole novel's fact pool.
--
-- The statement is idempotent (IF NOT EXISTS), so it is safe to run against a
-- database where the index was already created by hand.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StoryFact_novelId_sourceChapter_idx" ON "StoryFact"("novelId", "sourceChapter");
