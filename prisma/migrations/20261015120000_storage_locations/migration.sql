-- Logical storage records so bytes can move between locations without rewriting product identity.

CREATE TABLE "StoredObject" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StoredObject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoredObject_locationId_storageKey_key" ON "StoredObject"("locationId", "storageKey");
CREATE INDEX "StoredObject_tenantId_purpose_createdAt_idx" ON "StoredObject"("tenantId", "purpose", "createdAt");

ALTER TABLE "TenderAttachment" ADD COLUMN "checksum" TEXT;
ALTER TABLE "TenderAttachment" ADD COLUMN "locationId" TEXT;
ALTER TABLE "TenderAttachment" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "TenderAttachment" ADD COLUMN "storedObjectId" TEXT;
CREATE UNIQUE INDEX "TenderAttachment_storedObjectId_key" ON "TenderAttachment"("storedObjectId");
ALTER TABLE "TenderAttachment" ADD CONSTRAINT "TenderAttachment_storedObjectId_fkey" FOREIGN KEY ("storedObjectId") REFERENCES "StoredObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VerificationDocument" ADD COLUMN "checksum" TEXT;
ALTER TABLE "VerificationDocument" ADD COLUMN "locationId" TEXT;
ALTER TABLE "VerificationDocument" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "VerificationDocument" ADD COLUMN "storedObjectId" TEXT;
CREATE UNIQUE INDEX "VerificationDocument_storedObjectId_key" ON "VerificationDocument"("storedObjectId");
ALTER TABLE "VerificationDocument" ADD CONSTRAINT "VerificationDocument_storedObjectId_fkey" FOREIGN KEY ("storedObjectId") REFERENCES "StoredObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
