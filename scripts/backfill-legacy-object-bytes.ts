import { prisma } from '../src/server/data/prisma';
import { sha256Hex } from '../src/server/storage/checksum';
import { legacyVerificationDocumentObjectKey, tenderAttachmentObjectKey } from '../src/server/storage/keys';
import { putForPurpose } from '../src/server/storage/objectLifecycle';

async function columnExists(table: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = 'content'
  `;
  return rows.length > 0;
}

let attachments = 0;
let documents = 0;

if (await columnExists('TenderAttachment')) {
  const rows = await prisma.$queryRaw<Array<{ id: string; tenderId: string; content: Buffer }>>`
    SELECT id, "tenderId", content FROM "TenderAttachment"
    WHERE content IS NOT NULL AND octet_length(content) > 0
  `;
  for (const row of rows) {
    const tender = await prisma.tender.findUnique({ where: { id: row.tenderId }, select: { clientId: true } });
    const membership = tender ? await prisma.clientCompanyMember.findUnique({ where: { userId: tender.clientId }, select: { companyId: true } }) : null;
    const tenantId = membership?.companyId ?? tender?.clientId ?? 'legacy';
    const objectKey = tenderAttachmentObjectKey(row.tenderId, row.id, /^[A-Za-z0-9_-]+$/.test(tenantId) ? tenantId : undefined);
    const bytes = Buffer.from(row.content);
    const stored = await putForPurpose('durable', objectKey, bytes);
    await prisma.tenderAttachment.update({
      where: { id: row.id },
      data: { objectKey, checksum: sha256Hex(bytes), locationId: stored.locationId, tenantId: /^[A-Za-z0-9_-]+$/.test(tenantId) ? tenantId : null, sizeBytes: bytes.length },
    });
    await prisma.$executeRaw`UPDATE "TenderAttachment" SET content = ''::bytea WHERE id = ${row.id}`;
    attachments += 1;
  }
}

if (await columnExists('VerificationDocument')) {
  const rows = await prisma.$queryRaw<Array<{ id: string; retailerProfileId: string; documentType: string; content: Buffer; fileName: string; mimeType: string }>>`
    SELECT id, "retailerProfileId", "documentType"::text, content, "fileName", "mimeType" FROM "VerificationDocument"
    WHERE content IS NOT NULL AND octet_length(content) > 0
  `;
  for (const row of rows) {
    const objectKey = /^[A-Za-z0-9_-]+$/.test(row.retailerProfileId) && /^[A-Za-z0-9_-]+$/.test(row.documentType)
      ? legacyVerificationDocumentObjectKey(row.retailerProfileId, row.documentType)
      : null;
    if (!objectKey) continue;
    const bytes = Buffer.from(row.content);
    const stored = await putForPurpose('durable', objectKey, bytes);
    await prisma.verificationDocument.update({
      where: { id: row.id },
      data: { objectKey, checksum: sha256Hex(bytes), locationId: stored.locationId, tenantId: row.retailerProfileId, sizeBytes: bytes.length },
    });
    await prisma.$executeRaw`UPDATE "VerificationDocument" SET content = ''::bytea WHERE id = ${row.id}`;
    documents += 1;
  }
}

console.log(`Backfilled ${attachments} tender attachment(s) and ${documents} verification document(s).`);
await prisma.$disconnect();
