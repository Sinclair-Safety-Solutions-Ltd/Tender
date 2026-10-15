import { randomUUID } from 'node:crypto';
import { ValidationError } from '@/server/auth/session';
import { prisma } from '@/server/data/prisma';
import { verifyTenderAttachmentBytes, verifyVerificationDocumentBytes } from '@/lib/attachment-utils';
import { sha256Hex } from '@/server/storage/checksum';
import { assertStorageId, temporaryUploadObjectKey } from '@/server/storage/keys';
import { deleteStoredObjectRefs, putForPurpose, readFromLocation } from '@/server/storage/objectLifecycle';

export type UploadPurpose = 'tender-attachment' | 'verification-document';

export async function storageTenantIdForUser(userId: string): Promise<string> {
  const membership = await prisma.clientCompanyMember.findUnique({ where: { userId }, select: { companyId: true } });
  const tenantId = membership?.companyId ?? userId;
  assertStorageId(tenantId);
  return tenantId;
}

export async function stageUpload(input: {
  tenantId: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  purpose: UploadPurpose;
}): Promise<{ uploadId: string; checksum: string; sizeBytes: number; fileName: string; mimeType: string }> {
  const verified = input.purpose === 'verification-document'
    ? verifyVerificationDocumentBytes({ name: input.fileName, mimeType: input.mimeType, bytes: input.bytes })
    : verifyTenderAttachmentBytes({ name: input.fileName, mimeType: input.mimeType, bytes: input.bytes });
  const uploadId = randomUUID().replace(/-/g, '');
  const storageKey = temporaryUploadObjectKey(input.tenantId, uploadId);
  const stored = await putForPurpose('temporary', storageKey, input.bytes);
  await prisma.storedObject.create({
    data: {
      id: uploadId,
      storageKey,
      locationId: stored.locationId,
      fileName: input.fileName,
      mimeType: verified.mimeType,
      sizeBytes: verified.sizeBytes,
      checksum: stored.checksum,
      purpose: 'temporary',
      tenantId: input.tenantId,
    },
  });
  return { uploadId, checksum: stored.checksum, sizeBytes: verified.sizeBytes, fileName: input.fileName, mimeType: verified.mimeType };
}

export async function claimTemporaryUpload(uploadId: string, ownerTenantId: string): Promise<{
  id: string;
  storageKey: string;
  locationId: string;
  checksum: string;
  bytes: Buffer;
}> {
  assertStorageId(uploadId);
  const row = await prisma.storedObject.findFirst({
    where: { id: uploadId, tenantId: ownerTenantId, purpose: 'temporary' },
  });
  if (!row) throw new ValidationError('Upload is not available');
  const bytes = await readFromLocation(row.locationId, row.storageKey);
  if (!bytes || sha256Hex(bytes) !== row.checksum) throw new ValidationError('Upload is not available');
  return { id: row.id, storageKey: row.storageKey, locationId: row.locationId, checksum: row.checksum, bytes };
}

export async function promoteTemporaryUpload(input: {
  uploadId: string;
  ownerTenantId: string;
  destKey: string;
  destTenantId: string;
  fileName: string;
  mimeType: string;
}): Promise<{ storedObjectId: string; objectKey: string; locationId: string; checksum: string; sizeBytes: number; bytes: Buffer }> {
  const claimed = await claimTemporaryUpload(input.uploadId, input.ownerTenantId);
  const stored = await putForPurpose('durable', input.destKey, claimed.bytes);
  if (stored.checksum !== claimed.checksum) throw new ValidationError('Upload checksum does not match');
  const confirmed = await readFromLocation(stored.locationId, input.destKey);
  if (!confirmed || sha256Hex(confirmed) !== stored.checksum) throw new ValidationError('Upload could not be stored');
  await prisma.storedObject.update({
    where: { id: claimed.id },
    data: {
      storageKey: input.destKey,
      locationId: stored.locationId,
      purpose: 'durable',
      tenantId: input.destTenantId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: claimed.bytes.length,
      checksum: stored.checksum,
    },
  });
  if (claimed.locationId !== stored.locationId || claimed.storageKey !== input.destKey) {
    await deleteStoredObjectRefs([{ objectKey: claimed.storageKey, locationId: claimed.locationId }]);
  }
  return {
    storedObjectId: claimed.id,
    objectKey: input.destKey,
    locationId: stored.locationId,
    checksum: stored.checksum,
    sizeBytes: claimed.bytes.length,
    bytes: claimed.bytes,
  };
}

export async function writeDurableObject(input: {
  objectKey: string;
  bytes: Buffer;
  tenantId: string;
  fileName: string;
  mimeType: string;
}): Promise<{ storedObjectId: string; objectKey: string; locationId: string; checksum: string; sizeBytes: number }> {
  const stored = await putForPurpose('durable', input.objectKey, input.bytes);
  const data = {
    storageKey: input.objectKey,
    locationId: stored.locationId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.length,
    checksum: stored.checksum,
    purpose: 'durable',
    tenantId: input.tenantId,
  };
  const existing = await prisma.storedObject.findUnique({
    where: { locationId_storageKey: { locationId: stored.locationId, storageKey: input.objectKey } },
  });
  const row = existing
    ? await prisma.storedObject.update({ where: { id: existing.id }, data })
    : await prisma.storedObject.create({ data });
  return { storedObjectId: row.id, objectKey: input.objectKey, locationId: stored.locationId, checksum: stored.checksum, sizeBytes: input.bytes.length };
}
