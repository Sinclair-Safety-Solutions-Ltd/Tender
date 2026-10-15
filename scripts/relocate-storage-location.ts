import { prisma } from '../src/server/data/prisma';
import { locationById } from '../src/server/storage/config';
import { relocateVerifiedObject, storeForLocation } from '../src/server/storage/objectLifecycle';

const destinationId = process.argv.find((arg, index) => process.argv[index - 1] === '--to');
const removeSource = process.argv.includes('--remove-source');
if (!destinationId || !locationById(destinationId)) {
  console.error('Usage: tsx scripts/relocate-storage-location.ts --to <locationId> [--remove-source]');
  process.exit(1);
}

const rows = await prisma.storedObject.findMany({
  where: { locationId: { not: destinationId }, purpose: { in: ['durable', 'archive'] } },
});

let moved = 0;
for (const row of rows) {
  const sourceLocationId = row.locationId;
  await relocateVerifiedObject({
    sourceLocationId,
    destLocationId: destinationId,
    objectKey: row.storageKey,
    expectedChecksum: row.checksum,
  });
  await prisma.storedObject.update({ where: { id: row.id }, data: { locationId: destinationId } });
  await prisma.tenderAttachment.updateMany({ where: { storedObjectId: row.id }, data: { locationId: destinationId } });
  await prisma.verificationDocument.updateMany({ where: { storedObjectId: row.id }, data: { locationId: destinationId } });
  if (removeSource) await storeForLocation(sourceLocationId).delete(row.storageKey);
  moved += 1;
}

console.log(`Relocated ${moved} object(s) to ${destinationId}. Source bytes were ${removeSource ? 'removed' : 'kept for rollback'}.`);
await prisma.$disconnect();
