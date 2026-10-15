import { promoteTemporaryUpload, writeDurableObject } from '@/server/domain/stagedUpload';
import { deleteStoredObjectRefs } from '@/server/storage/objectLifecycle';
import { legacyVerificationDocumentObjectKey, readStoredObjectBytes, verificationDocumentObjectKey } from '@/server/storage/privateObjectStore';

export async function persistVerificationDocumentFile(
  profileId: string,
  documentType: string,
  bytes: Buffer,
  meta: { fileName: string; mimeType: string; uploadId?: string; ownerTenantId?: string },
): Promise<{ objectKey: string; checksum: string; locationId: string; storedObjectId: string; sizeBytes: number }> {
  const objectKey = verificationDocumentObjectKey(profileId, documentType, profileId);
  if (meta.uploadId && meta.ownerTenantId) {
    const promoted = await promoteTemporaryUpload({
      uploadId: meta.uploadId,
      ownerTenantId: meta.ownerTenantId,
      destKey: objectKey,
      destTenantId: profileId,
      fileName: meta.fileName,
      mimeType: meta.mimeType,
    });
    return promoted;
  }
  return writeDurableObject({ objectKey, bytes, tenantId: profileId, fileName: meta.fileName, mimeType: meta.mimeType });
}

export async function readVerificationDocumentBytes(
  document: { objectKey?: string | null; locationId?: string | null; content?: Uint8Array | Buffer | null },
  profileId: string,
  documentType: string,
): Promise<Buffer | null> {
  return readStoredObjectBytes(document.objectKey, document.content, document.locationId, [
    verificationDocumentObjectKey(profileId, documentType, profileId),
    legacyVerificationDocumentObjectKey(profileId, documentType),
  ]);
}

export async function deleteStoredVerificationDocument(profileId: string, documentType: string, ref?: { objectKey?: string | null; locationId?: string | null; storedObjectId?: string | null }): Promise<void> {
  const objectKey = ref?.objectKey || verificationDocumentObjectKey(profileId, documentType, profileId);
  await deleteStoredObjectRefs([
    { objectKey, locationId: ref?.locationId ?? null, storedObjectId: ref?.storedObjectId },
    { objectKey: legacyVerificationDocumentObjectKey(profileId, documentType), locationId: ref?.locationId ?? null },
  ]);
}
