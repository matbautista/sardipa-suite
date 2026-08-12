-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agencyId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "managerId" TEXT,
    CONSTRAINT "User_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("agencyId", "createdAt", "email", "failedLoginAttempts", "id", "isActive", "lockedUntil", "managerId", "name", "passwordHash", "role") SELECT "agencyId", "createdAt", "email", "failedLoginAttempts", "id", "isActive", "lockedUntil", "managerId", "name", "passwordHash", "role" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_agencyId_idx" ON "User"("agencyId");
CREATE INDEX "User_managerId_idx" ON "User"("managerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
