import { prisma } from '@/server/data/prisma';
import { archiveOrDelete } from '@/server/storage/objectLifecycle';

export const UNPURCHASED_QUOTE_RETENTION_DAYS = 30;
export const PURCHASED_DOCUMENT_RETENTION_YEARS = 5;
export const EXPIRED_AUTH_TOKEN_RETENTION_DAYS = 30;
export const PAGE_VIEW_RETENTION_DAYS = 90;

export function getUnpurchasedQuoteCutoff(now = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - UNPURCHASED_QUOTE_RETENTION_DAYS);
  return cutoff;
}

export function getPurchasedRetentionDeadline(now = new Date()): Date {
  const deadline = new Date(now);
  deadline.setUTCFullYear(deadline.getUTCFullYear() + PURCHASED_DOCUMENT_RETENTION_YEARS);
  return deadline;
}

function getCutoff(days: number, now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff;
}

export function expiredQuotePurgeWhere(cutoff: Date) {
  return {
    submittedAt: { lt: cutoff },
    status: { not: 'ACCEPTED' as const },
    releases: { none: {} },
    legalHolds: { none: { releasedAt: null } },
    tender: { legalHolds: { none: { releasedAt: null } } },
  };
}

export function expiredAttachmentPurgeWhere(cutoff: Date) {
  return {
    uploadedAt: { lt: cutoff },
    retentionLockedUntil: null,
    legalHolds: { none: { releasedAt: null } },
    tender: { status: { not: 'OPEN' as const }, legalHolds: { none: { releasedAt: null } } },
  };
}

export async function purgeExpiredUnpurchasedQuotes(now = new Date()): Promise<{ quotesDeleted: number; documentsDeleted: number; temporaryObjectsDeleted: number; emailVerificationTokensDeleted: number; passwordResetTokensDeleted: number; pageViewsDeleted: number }> {
  const cutoff = getUnpurchasedQuoteCutoff(now);
  const quotes = await prisma.quote.findMany({
    where: expiredQuotePurgeWhere(cutoff),
    select: { id: true, reference: true, tenderId: true, submittedAt: true },
  });

  const attachments = await prisma.tenderAttachment.findMany({
    where: expiredAttachmentPurgeWhere(cutoff),
    select: { id: true, fileName: true, tenderId: true, uploadedAt: true, objectKey: true, locationId: true, storedObjectId: true, checksum: true },
  });
  const temporaryCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const temporaryObjects = await prisma.storedObject.findMany({
    where: { purpose: 'temporary', createdAt: { lt: temporaryCutoff } },
    select: { id: true, storageKey: true, locationId: true, checksum: true },
  });

  const tokenCutoff = getCutoff(EXPIRED_AUTH_TOKEN_RETENTION_DAYS, now);
  const pageViewCutoff = getCutoff(PAGE_VIEW_RETENTION_DAYS, now);
  const operationalData = await prisma.$transaction(async (transaction) => {
    for (const quote of quotes) {
      await transaction.quote.delete({ where: { id: quote.id } });
      await transaction.auditLog.create({
        data: {
          actorId: null,
          action: 'QUOTE_DELETED_RETENTION',
          targetType: 'Quote',
          targetId: quote.id,
          metadata: JSON.stringify({ reference: quote.reference, tenderId: quote.tenderId, submittedAt: quote.submittedAt.toISOString(), cutoff: cutoff.toISOString() }),
        },
      });
    }
    for (const attachment of attachments) {
      await transaction.tenderAttachment.delete({ where: { id: attachment.id } });
      await transaction.auditLog.create({
        data: {
          actorId: null,
          action: 'DOCUMENT_DELETED_RETENTION',
          targetType: 'TenderAttachment',
          targetId: attachment.id,
          metadata: JSON.stringify({ fileName: attachment.fileName, tenderId: attachment.tenderId, uploadedAt: attachment.uploadedAt.toISOString(), cutoff: cutoff.toISOString() }),
        },
      });
    }
    const [emailVerificationTokens, passwordResetTokens, enhancedVerificationInvitations, pageViews] = await Promise.all([
      transaction.emailVerificationToken.deleteMany({ where: { expiresAt: { lt: tokenCutoff } } }),
      transaction.passwordResetToken.deleteMany({ where: { expiresAt: { lt: tokenCutoff } } }),
      transaction.enhancedVerificationInvitation.deleteMany({ where: { expiresAt: { lt: tokenCutoff } } }),
      transaction.pageView.deleteMany({ where: { createdAt: { lt: pageViewCutoff } } }),
    ]);
    return { emailVerificationTokensDeleted: emailVerificationTokens.count, passwordResetTokensDeleted: passwordResetTokens.count, enhancedVerificationInvitationsDeleted: enhancedVerificationInvitations.count, pageViewsDeleted: pageViews.count };
  });

  for (const attachment of attachments) {
    await archiveOrDelete({ objectKey: attachment.objectKey, locationId: attachment.locationId, storedObjectId: attachment.storedObjectId, checksum: attachment.checksum });
  }
  for (const temporary of temporaryObjects) {
    await archiveOrDelete({ objectKey: temporary.storageKey, locationId: temporary.locationId, storedObjectId: temporary.id, checksum: temporary.checksum });
  }

  return { quotesDeleted: quotes.length, documentsDeleted: attachments.length, temporaryObjectsDeleted: temporaryObjects.length, ...operationalData };
}
