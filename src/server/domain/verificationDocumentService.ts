import { prisma } from '@/server/data/prisma';
import { ForbiddenError } from '@/server/auth/session';
import { recordAuditEvent } from '@/server/audit/auditLog';
import { getApplicableVerificationDocuments, getRequiredVerificationDocumentTypes, isDocumentApplicableForProfile, isSoleTraderEvidenceSufficient, SOLE_TRADER_EVIDENCE_DOCUMENT_TYPES, type VerificationDocumentType } from '@/lib/verification-documents';
import type { UploadVerificationDocumentInput } from '@/lib/schemas/verificationDocument';
import { assessVerificationDocument } from '@/server/domain/verificationAiAssessment';
import { getVerificationDocumentRequirements } from '@/server/domain/platformSettings';
import { storageTenantIdForUser } from '@/server/domain/stagedUpload';
import { locationById, locationForPurpose } from '@/server/storage/config';
import { deleteStoredObjectRefs } from '@/server/storage/objectLifecycle';
import { deleteStoredVerificationDocument, persistVerificationDocumentFile, readVerificationDocumentBytes } from '@/server/storage/verificationDocumentStore';

const verificationAssessmentSelect = {
  documentType: true,
  expiryDate: true,
  aiConfidencePercent: true,
  aiSummary: true,
  aiRequiresHumanReview: true,
} as const;

export async function getOwnRetailerProfileOrThrow(userId: string) {
  const profile = await prisma.retailerProfile.findUnique({ where: { userId } });
  if (!profile) throw new ForbiddenError('Retailer profile not found');
  return profile;
}

/** Provider-facing document list — never includes the AI assessment fields, which are Super User only. */
export async function listVerificationDocuments(retailerProfileId: string) {
  return prisma.verificationDocument.findMany({
    where: { retailerProfileId },
    select: { documentType: true, fileName: true, mimeType: true, sizeBytes: true, expiryDate: true, uploadedAt: true },
    orderBy: { documentType: 'asc' },
  });
}

/** Super User review list — includes the AI assessment report fields withheld from the Provider. */
export async function listVerificationDocumentsForReview(retailerProfileId: string) {
  return prisma.verificationDocument.findMany({
    where: { retailerProfileId },
    select: { documentType: true, fileName: true, mimeType: true, sizeBytes: true, expiryDate: true, uploadedAt: true, aiConfidencePercent: true, aiSummary: true, aiRequiresHumanReview: true, verified: true },
    orderBy: { documentType: 'asc' },
  });
}

/** A Provider may upload one file per document slot; re-uploading replaces the prior file and re-runs the AI assessment. */
export async function uploadVerificationDocument(userId: string, input: UploadVerificationDocumentInput) {
  const profile = await getOwnRetailerProfileOrThrow(userId);
  if (profile.verificationStatus === 'VERIFIED') {
    throw new ForbiddenError('This account is already verified');
  }
  if (!isDocumentApplicableForProfile(input.documentType as VerificationDocumentType, profile.categories, profile.isSoleTrader)) {
    throw new ForbiddenError('This document is not applicable to the services offered by this account');
  }

  const ownerTenantId = await storageTenantIdForUser(userId);
  const existing = await prisma.verificationDocument.findUnique({
    where: { retailerProfileId_documentType: { retailerProfileId: profile.id, documentType: input.documentType as VerificationDocumentType } },
    select: { objectKey: true, locationId: true, storedObjectId: true },
  });
  if (existing?.storedObjectId) {
    await prisma.storedObject.delete({ where: { id: existing.storedObjectId } }).catch(() => undefined);
  }
  const persisted = await persistVerificationDocumentFile(profile.id, input.documentType, input.dataBase64 ? Buffer.from(input.dataBase64, 'base64') : Buffer.alloc(0), {
    fileName: input.name,
    mimeType: input.mimeType,
    uploadId: input.uploadId,
    ownerTenantId,
  });
  const content = await readVerificationDocumentBytes({ objectKey: persisted.objectKey, locationId: persisted.locationId }, profile.id, input.documentType);
  if (!content) throw new ForbiddenError('Document is not available');
  const assessment = assessVerificationDocument({
    documentType: input.documentType as VerificationDocumentType,
    mimeType: input.mimeType,
    content,
    expiryDate: input.expiryDate,
    companyName: profile.companyName,
    companyNumber: profile.companyNumber,
    address: profile.address,
  });

  const data = {
    fileName: input.name,
    mimeType: input.mimeType,
    sizeBytes: persisted.sizeBytes,
    objectKey: persisted.objectKey,
    checksum: persisted.checksum,
    locationId: persisted.locationId,
    tenantId: profile.id,
    storedObjectId: persisted.storedObjectId,
    expiryDate: input.expiryDate,
    aiConfidencePercent: assessment.confidencePercent,
    aiSummary: assessment.summary,
    aiRequiresHumanReview: !assessment.passed,
    aiAssessedAt: new Date(),
    verified: false,
  };

  const document = await prisma.verificationDocument.upsert({
    where: { retailerProfileId_documentType: { retailerProfileId: profile.id, documentType: input.documentType as VerificationDocumentType } },
    update: data,
    create: { retailerProfileId: profile.id, documentType: input.documentType as VerificationDocumentType, ...data },
    select: { documentType: true, fileName: true, mimeType: true, sizeBytes: true, expiryDate: true, uploadedAt: true },
  });
  if (existing?.objectKey && existing.objectKey !== persisted.objectKey) {
    await deleteStoredObjectRefs([{ objectKey: existing.objectKey, locationId: existing.locationId }]);
  }
  await recordAuditEvent({ actorId: userId, action: 'PROVIDER_VERIFICATION_DOCUMENT_UPLOADED', targetType: 'RetailerProfile', targetId: profile.id, metadata: { documentType: input.documentType } });
  return document;
}

export async function deleteVerificationDocument(userId: string, documentType: VerificationDocumentType) {
  const profile = await getOwnRetailerProfileOrThrow(userId);
  const existing = await prisma.verificationDocument.findUnique({
    where: { retailerProfileId_documentType: { retailerProfileId: profile.id, documentType } },
    select: { objectKey: true, locationId: true, storedObjectId: true },
  });
  await prisma.verificationDocument.deleteMany({ where: { retailerProfileId: profile.id, documentType } });
  await deleteStoredVerificationDocument(profile.id, documentType, existing ?? undefined);
  await recordAuditEvent({ actorId: userId, action: 'PROVIDER_VERIFICATION_DOCUMENT_DELETED', targetType: 'RetailerProfile', targetId: profile.id, metadata: { documentType } });
}

type DocumentActor = { id: string; role: 'USER' | 'SUPER_USER' };

/** Returns document bytes only to the owning Provider or a Super User reviewing the account. */
export async function getVerificationDocumentForDownload(retailerUserId: string, documentType: VerificationDocumentType, actor: DocumentActor) {
  if (actor.id !== retailerUserId && actor.role !== 'SUPER_USER') {
    throw new ForbiddenError('Document is not available');
  }
  const profile = await prisma.retailerProfile.findUnique({ where: { userId: retailerUserId }, select: { id: true } });
  if (!profile) throw new ForbiddenError('Document is not available');

  const document = await prisma.verificationDocument.findUnique({
    where: { retailerProfileId_documentType: { retailerProfileId: profile.id, documentType } },
    select: { id: true, fileName: true, mimeType: true, objectKey: true, locationId: true },
  });
  if (!document) throw new ForbiddenError('Document is not available');

  const content = await readVerificationDocumentBytes(document, profile.id, documentType);
  if (!content) throw new ForbiddenError('Document is not available');

  await recordAuditEvent({ actorId: actor.id, action: 'PROVIDER_VERIFICATION_DOCUMENT_DOWNLOADED', targetType: 'RetailerProfile', targetId: profile.id, metadata: { documentType } });
  const store = (document.locationId ? locationById(document.locationId)?.store : null) ?? locationForPurpose('durable').store;
  const downloadUrl = process.env.STORAGE_DIRECT_URLS === 'true' && document.objectKey
    ? await store.createDownloadUrl(document.objectKey, 120)
    : null;
  return { id: document.id, fileName: document.fileName, mimeType: document.mimeType, content, downloadUrl };
}

export type VerificationEvaluation = {
  canProceed: boolean;
  passed: boolean;
  confidencePercent: number;
  report: string;
  missingOrExpiredRequiredTypes: VerificationDocumentType[];
};

/** Aggregates the per-document assessments into one decision: pass or fail. There is no human-review queue. */
export async function evaluateProviderVerification(retailerProfileId: string, categories: string, companyType?: string | null, isSoleTrader?: boolean | null): Promise<VerificationEvaluation> {
  const requirements = await getVerificationDocumentRequirements();
  const requiredTypes = getRequiredVerificationDocumentTypes(categories, companyType, requirements, isSoleTrader);
  const documents = await prisma.verificationDocument.findMany({ where: { retailerProfileId }, select: verificationAssessmentSelect });
  const applicableTypes = new Set(getApplicableVerificationDocuments(categories).map((document) => document.type));
  const reviewDocuments = documents.filter((document) => applicableTypes.has(document.documentType));
  const documentsByType = new Map(reviewDocuments.map((document) => [document.documentType, document] as const));
  const now = new Date();

  const missingOrExpiredRequiredTypes = requiredTypes.filter((type) => {
    const document = documentsByType.get(type);
    if (!document) return true;
    if (document.expiryDate === null) return false;
    return document.expiryDate <= now;
  });

  if (missingOrExpiredRequiredTypes.length > 0) {
    return {
      canProceed: false,
      passed: false,
      confidencePercent: 0,
      report: `Required documents missing or expired: ${missingOrExpiredRequiredTypes.join(', ')}.`,
      missingOrExpiredRequiredTypes,
    };
  }

  const requiredDocuments = requiredTypes.map((type) => documentsByType.get(type)!);
  const documentsForScore = requiredDocuments.length > 0 ? requiredDocuments : reviewDocuments;
  const confidencePercent = documentsForScore.length > 0
    ? Math.min(...documentsForScore.map((document) => document.aiConfidencePercent ?? 0))
    : 0;
  const passed = documentsForScore.length > 0
    && confidencePercent >= 90
    && documentsForScore.every((document) => document.aiRequiresHumanReview === false);

  const report = [
    'Basic legal eligibility assessment for the services declared by this User.',
    `Overall automated confidence score: ${confidencePercent}%.`,
    `Automated verification passed: ${passed ? 'yes' : 'no'}.`,
    ...reviewDocuments.map((document) => `- ${document.documentType}: ${document.aiSummary ?? 'No assessment recorded.'}`),
  ].join('\n');

  return { canProceed: true, passed, confidencePercent, report, missingOrExpiredRequiredTypes: [] };
}

/** Sole trader evidence rule: any one strong document (e.g. HMRC UTR, SA302, VAT certificate, CIS proof, PLI/PII insurance), or at least two distinct moderate documents (bank statement, invoices, quotations/contracts, trade body membership, trading activity evidence). */
export async function evaluateSoleTraderVerification(retailerProfileId: string): Promise<VerificationEvaluation> {
  const now = new Date();
  const documents = await prisma.verificationDocument.findMany({
    where: { retailerProfileId, documentType: { in: [...SOLE_TRADER_EVIDENCE_DOCUMENT_TYPES] } },
    select: verificationAssessmentSelect,
  });
  const validDocuments = documents.filter((document) => document.expiryDate === null || document.expiryDate > now);
  const validTypes = validDocuments.map((document) => document.documentType);

  if (!isSoleTraderEvidenceSufficient(validTypes)) {
    return {
      canProceed: false,
      passed: false,
      confidencePercent: 0,
      report: 'Insufficient sole trader evidence: upload one strong document (HMRC UTR confirmation, SA302 tax calculation, VAT registration certificate, CIS registration proof, or public liability/professional indemnity insurance), or at least two moderate documents (business bank statement, customer invoices, customer quotations or contracts, trade body membership, or trading activity evidence).',
      missingOrExpiredRequiredTypes: [],
    };
  }

  const confidencePercent = validDocuments.length > 0 ? Math.min(...validDocuments.map((document) => document.aiConfidencePercent ?? 0)) : 0;
  const passed = confidencePercent >= 90 && validDocuments.every((document) => document.aiRequiresHumanReview === false);

  const report = [
    'Sole trader self-employment evidence assessment.',
    `Overall automated confidence score: ${confidencePercent}%.`,
    `Automated verification passed: ${passed ? 'yes' : 'no'}.`,
    ...validDocuments.map((document) => `- ${document.documentType}: ${document.aiSummary ?? 'No assessment recorded.'}`),
  ].join('\n');

  return { canProceed: true, passed, confidencePercent, report, missingOrExpiredRequiredTypes: [] };
}

/** Marks every currently-uploaded applicable document as verified evidence, shown to Contractors as the "what was checked" list. */
export async function markUploadedDocumentsVerified(retailerProfileId: string, categories: string, verified: boolean, isSoleTrader = false) {
  const applicableTypes = isSoleTrader
    ? [...SOLE_TRADER_EVIDENCE_DOCUMENT_TYPES]
    : getApplicableVerificationDocuments(categories).map((doc) => doc.type);
  await prisma.verificationDocument.updateMany({ where: { retailerProfileId, documentType: { in: applicableTypes } }, data: { verified } });
}

/** A VERIFIED Provider loses that status the moment a required document's expiry date passes, until it is renewed and re-reviewed. */
export async function syncVerificationExpiryForUserIds(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const profiles = await prisma.retailerProfile.findMany({
    where: { userId: { in: userIds }, verificationStatus: 'VERIFIED' },
    select: { id: true, userId: true, categories: true, companyType: true, isSoleTrader: true },
  });
  if (profiles.length === 0) return;
  const now = new Date();
  const requirements = await getVerificationDocumentRequirements();

  for (const profile of profiles) {
    if (profile.isSoleTrader) {
      const documents = await prisma.verificationDocument.findMany({
        where: { retailerProfileId: profile.id, documentType: { in: [...SOLE_TRADER_EVIDENCE_DOCUMENT_TYPES] } },
        select: { documentType: true, expiryDate: true },
      });
      const validTypes = documents.filter((document) => document.expiryDate === null || document.expiryDate > now).map((document) => document.documentType);
      if (isSoleTraderEvidenceSufficient(validTypes)) continue;

      await prisma.retailerProfile.update({ where: { id: profile.id }, data: { verificationStatus: 'EXPIRED' } });
      await markUploadedDocumentsVerified(profile.id, profile.categories, false, true);
      await recordAuditEvent({ actorId: null, action: 'PROVIDER_VERIFICATION_EXPIRED', targetType: 'RetailerProfile', targetId: profile.id, metadata: { reason: 'sole_trader_evidence_expired' } });
      continue;
    }

    const requiredTypes = getRequiredVerificationDocumentTypes(profile.categories, profile.companyType, requirements, profile.isSoleTrader);
    const expired = await prisma.verificationDocument.findFirst({
      where: { retailerProfileId: profile.id, documentType: { in: requiredTypes }, expiryDate: { lte: now } },
      select: { documentType: true },
    });
    if (!expired) continue;

    await prisma.retailerProfile.update({ where: { id: profile.id }, data: { verificationStatus: 'EXPIRED' } });
    await markUploadedDocumentsVerified(profile.id, profile.categories, false);
    await recordAuditEvent({ actorId: null, action: 'PROVIDER_VERIFICATION_EXPIRED', targetType: 'RetailerProfile', targetId: profile.id, metadata: { documentType: expired.documentType } });
  }
}

export async function syncVerificationExpiry(userId: string): Promise<void> {
  await syncVerificationExpiryForUserIds([userId]);
}
