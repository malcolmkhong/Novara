-- AlterTable
ALTER TABLE "Novel" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "Novel_userId_idx" ON "Novel"("userId");
