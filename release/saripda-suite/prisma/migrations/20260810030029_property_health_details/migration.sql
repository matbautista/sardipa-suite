-- CreateTable
CREATE TABLE "PropertyDetail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "policyId" TEXT NOT NULL,
    "propertyAddress" TEXT NOT NULL,
    "constructionType" TEXT,
    "occupancyUse" TEXT,
    "sumInsured" REAL,
    "perilsCovered" TEXT,
    CONSTRAINT "PropertyDetail_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HealthDetail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "policyId" TEXT NOT NULL,
    "insuredName" TEXT NOT NULL,
    "insuredBirthdate" DATETIME NOT NULL,
    "existingMedicalConditions" TEXT,
    "planCoverageTier" TEXT,
    "dependents" TEXT,
    "roomBoardLimit" REAL,
    "preexistingConditionDisclosure" TEXT,
    CONSTRAINT "HealthDetail_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PropertyDetail_policyId_key" ON "PropertyDetail"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "HealthDetail_policyId_key" ON "HealthDetail"("policyId");
