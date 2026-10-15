import { ForbiddenError } from '@/server/auth/session';
import { recordAuditEvent } from '@/server/audit/auditLog';
import { prisma } from '@/server/data/prisma';
import { getCompanyMemberIds } from '@/server/domain/tenderService';
import { locationById, locationForPurpose } from '@/server/storage/config';
import { readTenderAttachmentBytes } from '@/server/storage/tenderAttachmentStore';

type AttachmentActor = { id: string };

/** Returns attachment bytes for the owning Client company, or a Provider with a persisted unlock. */
async function optionalDownloadUrl(locationId: string | null, objectKey: string | null): Promise<string | null> {
  if (process.env.STORAGE_DIRECT_URLS !== 'true' || !objectKey) return null;
  const store = (locationId ? locationById(locationId)?.store : null) ?? locationForPurpose('durable').store;
  return store.createDownloadUrl(objectKey, 120);
}

export async function getTenderAttachmentForDownload(tenderId: string, attachmentId: string, actor: AttachmentActor): Promise<{ id: string; fileName: string; mimeType: string; content: Buffer; downloadUrl: string | null }> {
  const companyMemberIds = await getCompanyMemberIds(actor.id);
  const attachment = await prisma.tenderAttachment.findFirst({
    where: {
      id: attachmentId,
      tenderId,
      OR: [
        { tender: { clientId: { in: companyMemberIds } } },
        { tender: { unlocks: { some: { retailerId: actor.id } } } },
      ],
    },
    select: { id: true, fileName: true, mimeType: true, objectKey: true, locationId: true },
  });
  if (!attachment) throw new ForbiddenError('Attachment is not available');

  const content = await readTenderAttachmentBytes(attachment);
  if (!content) throw new ForbiddenError('Attachment is not available');

  await recordAuditEvent({
    actorId: actor.id,
    action: 'TENDER_ATTACHMENT_DOWNLOADED',
    targetType: 'TenderAttachment',
    targetId: attachment.id,
    metadata: { tenderId },
  });

  return {
    id: attachment.id,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    content,
    downloadUrl: await optionalDownloadUrl(attachment.locationId, attachment.objectKey),
  };
}
