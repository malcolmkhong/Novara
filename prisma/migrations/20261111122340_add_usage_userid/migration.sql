-- AlterTable
ALTER TABLE "UsageCall" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "UsageDaily" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "UsageCall_userId_idx" ON "UsageCall"("userId");

-- CreateIndex
CREATE INDEX "UsageDaily_userId_idx" ON "UsageDaily"("userId");

