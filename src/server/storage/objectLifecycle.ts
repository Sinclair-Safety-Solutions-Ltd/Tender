import { sha256Hex } from '@/server/storage/checksum';
import { locationById, locationForPurpose } from '@/server/storage/config';
import type { ObjectStore, StoragePurpose, StoredObjectRef } from '@/server/storage/types';

export function storeForLocation(locationId: string | null | undefined): ObjectStore {
  if (locationId) {
    const location = locationById(locationId);
    if (location) return location.store;
  }
  return locationForPurpose('durable').store;
}

export async function putForPurpose(purpose: StoragePurpose, objectKey: string, bytes: Buffer): Promise<{ checksum: string; sizeBytes: number; locationId: string }> {
  const location = locationForPurpose(purpose);
  const stored = await location.store.put(objectKey, bytes);
  return { ...stored, locationId: location.id };
}

export async function readFromLocation(locationId: string | null | undefined, objectKey: string): Promise<Buffer | null> {
  return storeForLocation(locationId).get(objectKey);
}

export async function deleteStoredObjectRefs(rows: StoredObjectRef[]): Promise<void> {
  const { prisma } = await import('@/server/data/prisma');
  for (const row of rows) {
    if (row.objectKey) await storeForLocation(row.locationId).delete(row.objectKey);
    if (row.storedObjectId) {
      await prisma.storedObject.delete({ where: { id: row.storedObjectId } }).catch(() => undefined);
    }
  }
}

export async function archiveOrDelete(row: StoredObjectRef & { checksum?: string | null }): Promise<'archived' | 'deleted'> {
  if (process.env.STORAGE_RETENTION_ACTION === 'archive' && row.objectKey) {
    const bytes = await readFromLocation(row.locationId, row.objectKey);
    if (!bytes) {
      await deleteStoredObjectRefs([row]);
      return 'deleted';
    }
    const checksum = sha256Hex(bytes);
    if (row.checksum && row.checksum !== checksum) throw new Error('Stored object checksum does not match the record');
    const archived = await putForPurpose('archive', row.objectKey, bytes);
    const confirmed = await readFromLocation(archived.locationId, row.objectKey);
    if (!confirmed || sha256Hex(confirmed) !== checksum) throw new Error('Archived object failed checksum verification');
    const { prisma } = await import('@/server/data/prisma');
    if (row.storedObjectId) {
      await prisma.storedObject.update({
        where: { id: row.storedObjectId },
        data: { locationId: archived.locationId, purpose: 'archive', checksum },
      });
    }
    if (row.locationId && row.locationId !== archived.locationId) {
      await storeForLocation(row.locationId).delete(row.objectKey);
    }
    return 'archived';
  }
  await deleteStoredObjectRefs([row]);
  return 'deleted';
}

export async function relocateVerifiedObject(input: {
  sourceLocationId: string;
  objectKey: string;
  destLocationId: string;
  expectedChecksum: string;
}): Promise<void> {
  const source = locationById(input.sourceLocationId);
  const dest = locationById(input.destLocationId);
  if (!source || !dest) throw new Error('Storage location is not configured');
  if (source.id === dest.id) return;
  const bytes = await source.store.get(input.objectKey);
  if (!bytes) throw new Error('Stored object was not found');
  if (sha256Hex(bytes) !== input.expectedChecksum) throw new Error('Stored object checksum does not match the record');
  await dest.store.put(input.objectKey, bytes);
  const confirmed = await dest.store.get(input.objectKey);
  if (!confirmed || sha256Hex(confirmed) !== input.expectedChecksum) throw new Error('Relocated object failed checksum verification');
}
