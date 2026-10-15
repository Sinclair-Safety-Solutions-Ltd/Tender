const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const OBJECT_KEY_PATTERN = /^[A-Za-z0-9/_-]+$/;

export function assertStorageId(value: string): void {
  if (!ID_PATTERN.test(value)) throw new Error('Invalid attachment object key');
}

export function assertObjectKey(objectKey: string): void {
  if (!OBJECT_KEY_PATTERN.test(objectKey) || objectKey.includes('..') || objectKey.startsWith('/')) {
    throw new Error('Invalid attachment object key');
  }
}

export function tenderAttachmentObjectKey(tenderId: string, attachmentId: string, tenantId?: string): string {
  assertStorageId(tenderId);
  assertStorageId(attachmentId);
  if (!tenantId) return `tenders/${tenderId}/${attachmentId}`;
  assertStorageId(tenantId);
  return `tenants/${tenantId}/tenders/${tenderId}/${attachmentId}`;
}

export function verificationDocumentObjectKey(profileId: string, documentType: string, tenantId?: string): string {
  assertStorageId(profileId);
  assertStorageId(documentType);
  const tenant = tenantId ?? profileId;
  assertStorageId(tenant);
  return `tenants/${tenant}/verification/${profileId}/${documentType}`;
}

/** Keys written before tenant prefixes. Readers still resolve them. */
export function legacyVerificationDocumentObjectKey(profileId: string, documentType: string): string {
  assertStorageId(profileId);
  assertStorageId(documentType);
  return `verification/${profileId}/${documentType}`;
}

export function temporaryUploadObjectKey(tenantId: string, uploadId: string): string {
  assertStorageId(tenantId);
  assertStorageId(uploadId);
  return `tenants/${tenantId}/uploads/${uploadId}`;
}
