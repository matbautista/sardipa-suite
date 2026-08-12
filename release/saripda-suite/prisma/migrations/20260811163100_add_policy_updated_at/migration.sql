/*
  Warnings:

  - Added the required column `updatedAt` to the `Policy` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Policy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agencyId" TEXT NOT NULL,
    "leadId" TEXT,
    "ownerId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "premium" REAL NOT NULL,
    "commission" REAL,
    "startDate" DATETIME NOT NULL,
    "renewalDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "gracePeriodEndsAt" DATETIME,
    "vulFundBalance" REAL,
    "vulFundBalanceUpdatedAt" DATETIME,
    -- DEFAULT CURRENT_TIMESTAMP added by hand: Prisma's own generated
    -- migration left this column NOT NULL with no default, which only
    -- applied cleanly here because dev.db's Policy table happened to be
    -- empty at the time — it would fail outright against any database
    -- with existing policies. Backfilling existing rows to "now" (their
    -- real prior-update history isn't recoverable) is the same tradeoff
    -- Prisma's interactive CLI would have prompted for by default.
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proofOfPaymentDocId" TEXT,
    "metadata" TEXT,
    CONSTRAINT "Policy_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Policy_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Policy_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Policy_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "InsuranceLine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Policy_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Policy_proofOfPaymentDocId_fkey" FOREIGN KEY ("proofOfPaymentDocId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Policy" ("agencyId", "commission", "gracePeriodEndsAt", "id", "leadId", "lineId", "metadata", "ownerId", "premium", "productId", "proofOfPaymentDocId", "renewalDate", "startDate", "status", "vulFundBalance", "vulFundBalanceUpdatedAt") SELECT "agencyId", "commission", "gracePeriodEndsAt", "id", "leadId", "lineId", "metadata", "ownerId", "premium", "productId", "proofOfPaymentDocId", "renewalDate", "startDate", "status", "vulFundBalance", "vulFundBalanceUpdatedAt" FROM "Policy";
DROP TABLE "Policy";
ALTER TABLE "new_Policy" RENAME TO "Policy";
CREATE UNIQUE INDEX "Policy_proofOfPaymentDocId_key" ON "Policy"("proofOfPaymentDocId");
CREATE INDEX "Policy_agencyId_status_idx" ON "Policy"("agencyId", "status");
CREATE INDEX "Policy_ownerId_idx" ON "Policy"("ownerId");
CREATE INDEX "Policy_leadId_idx" ON "Policy"("leadId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
