-- AlterTable
ALTER TABLE "TeamTurnLog" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "UsageInvoice" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "TeamTurnLog_userId_idx" ON "TeamTurnLog"("userId");

-- CreateIndex
CREATE INDEX "UsageInvoice_userId_idx" ON "UsageInvoice"("userId");

