import { isAttachmentKind } from '@/lib/attachment-kinds';
import { prisma } from '@/server/data/prisma';
import { promoteTemporaryUpload, writeDurableObject } from '@/server/domain/stagedUpload';
import { deletePrivateObject, readStoredObjectBytes, tenderAttachmentObjectKey } from '@/server/storage/privateObjectStore';

export async function persistNewTenderAttachments(
  tenderId: string,
  tenantId: string,
  attachments: Array<{ name: string; mimeType: string; sizeBytes: number; dataBase64?: string; uploadId?: string; kind?: string }>,
): Promise<void> {
  for (const attachment of attachments) {
    const created = await prisma.tenderAttachment.create({
      data: {
        tenderId,
        fileName: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        kind: attachment.kind && isAttachmentKind(attachment.kind) ? attachment.kind : 'OTHER',
        version: 1,
        tenantId,
      },
    });
    const objectKey = tenderAttachmentObjectKey(tenderId, created.id, tenantId);
    try {
      const stored = attachment.uploadId
        ? await promoteTemporaryUpload({
          uploadId: attachment.uploadId,
          ownerTenantId: tenantId,
          destKey: objectKey,
          destTenantId: tenantId,
          fileName: attachment.name,
          mimeType: attachment.mimeType,
        })
        : await writeDurableObject({
          objectKey,
          bytes: Buffer.from(attachment.dataBase64 ?? '', 'base64'),
          tenantId,
          fileName: attachment.name,
          mimeType: attachment.mimeType,
        });
      await prisma.tenderAttachment.update({
        where: { id: created.id },
        data: {
          objectKey: stored.objectKey,
          checksum: stored.checksum,
          locationId: stored.locationId,
          storedObjectId: stored.storedObjectId,
          sizeBytes: stored.sizeBytes,
          mimeType: attachment.mimeType,
        },
      });
    } catch (error) {
      await prisma.tenderAttachment.delete({ where: { id: created.id } }).catch(() => null);
      throw error;
    }
  }
}

export async function readTenderAttachmentBytes(attachment: {
  objectKey: string | null;
  locationId?: string | null;
  content?: Uint8Array | Buffer | null;
}): Promise<Buffer | null> {
  return readStoredObjectBytes(attachment.objectKey, attachment.content, attachment.locationId);
}

export async function deleteStoredTenderAttachment(objectKey: string | null, locationId?: string | null): Promise<void> {
  if (!objectKey) return;
  if (locationId) {
    const { storeForLocation } = await import('@/server/storage/objectLifecycle');
    await storeForLocation(locationId).delete(objectKey);
    return;
  }
  await deletePrivateObject(objectKey);
}
