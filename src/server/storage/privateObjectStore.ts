import { locationForPurpose } from '@/server/storage/config';
import { legacyVerificationDocumentObjectKey, tenderAttachmentObjectKey, verificationDocumentObjectKey } from '@/server/storage/keys';
import { putForPurpose, readFromLocation } from '@/server/storage/objectLifecycle';

export { legacyVerificationDocumentObjectKey, tenderAttachmentObjectKey, verificationDocumentObjectKey };

export function attachmentStoreRoot(): string {
  return locationForPurpose('durable').root ?? '';
}

export async function putPrivateObject(objectKey: string, bytes: Buffer): Promise<void> {
  await putForPurpose('durable', objectKey, bytes);
}

export async function getPrivateObject(objectKey: string): Promise<Buffer> {
  const bytes = await locationForPurpose('durable').store.get(objectKey);
  if (!bytes) throw new Error('Object not found');
  return bytes;
}

export async function deletePrivateObject(objectKey: string): Promise<void> {
  await locationForPurpose('durable').store.delete(objectKey);
}

export async function readStoredObjectBytes(
  objectKey: string | null | undefined,
  content: Uint8Array | Buffer | null | undefined,
  locationId?: string | null,
  extraKeys: string[] = [],
): Promise<Buffer | null> {
  const keys = [objectKey, ...extraKeys].filter((key): key is string => Boolean(key));
  for (const key of keys) {
    const bytes = await readFromLocation(locationId, key);
    if (bytes) return bytes;
    if (locationId) {
      const durable = await locationForPurpose('durable').store.get(key);
      if (durable) return durable;
    }
  }
  if (!content || content.length === 0) return null;
  return Buffer.from(content);
}
