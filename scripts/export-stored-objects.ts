import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/server/data/prisma';
import { writeObjectExport, type ExportRecord } from '../src/server/storage/exportManifest';
import { readFromLocation } from '../src/server/storage/objectLifecycle';

const outputDir = path.resolve(process.argv[2] ?? 'storage-export');
const tenantId = process.env.STORAGE_EXPORT_TENANT?.trim();

const [attachments, documents] = await Promise.all([
  prisma.tenderAttachment.findMany({
    where: tenantId ? { tenantId } : undefined,
    select: { id: true, objectKey: true, locationId: true, tenantId: true, fileName: true, mimeType: true, sizeBytes: true, checksum: true },
  }),
  prisma.verificationDocument.findMany({
    where: tenantId ? { tenantId } : undefined,
    select: { id: true, objectKey: true, locationId: true, tenantId: true, fileName: true, mimeType: true, sizeBytes: true, checksum: true },
  }),
]);

const records: ExportRecord[] = [
  ...attachments.flatMap((row) => row.objectKey ? [{
    entity: 'TenderAttachment' as const,
    id: row.id,
    storageKey: row.objectKey,
    locationId: row.locationId,
    tenantId: row.tenantId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    checksum: row.checksum,
  }] : []),
  ...documents.flatMap((row) => row.objectKey ? [{
    entity: 'VerificationDocument' as const,
    id: row.id,
    storageKey: row.objectKey,
    locationId: row.locationId,
    tenantId: row.tenantId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    checksum: row.checksum,
  }] : []),
];

await mkdir(outputDir, { recursive: true });
const manifest = await writeObjectExport(outputDir, records, (record) => readFromLocation(record.locationId, record.storageKey));
console.log(`Exported ${manifest.objects.length} object(s) to ${outputDir}`);
await prisma.$disconnect();
