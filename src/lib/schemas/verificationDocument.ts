import { z } from 'zod';
import { verifyVerificationDocument, MAX_VERIFICATION_DOCUMENT_BASE64_CHARS } from '@/lib/attachment-utils';
import { VERIFICATION_DOCUMENT_TYPES, verificationDocumentExpires, type VerificationDocumentType } from '@/lib/verification-documents';

const documentTypeSchema = z.enum(VERIFICATION_DOCUMENT_TYPES.map((doc) => doc.type) as [string, ...string[]]);

export const uploadVerificationDocumentSchema = z.object({
  documentType: documentTypeSchema,
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(128),
  sizeBytes: z.number().int().nonnegative(),
  dataBase64: z.string().min(1).max(MAX_VERIFICATION_DOCUMENT_BASE64_CHARS).optional(),
  uploadId: z.string().trim().min(1).max(128).optional(),
  expiryDate: z.coerce.date().optional(),
}).transform((document, context) => {
  const expires = verificationDocumentExpires(document.documentType as VerificationDocumentType);
  if (expires && (!document.expiryDate || document.expiryDate.getTime() <= Date.now())) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Expiry date must be in the future', path: ['expiryDate'] });
    return z.NEVER;
  }
  if (!expires && document.expiryDate && document.expiryDate.getTime() <= Date.now()) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Expiry date must be in the future', path: ['expiryDate'] });
    return z.NEVER;
  }
  if (document.uploadId && !document.dataBase64) {
    return { ...document, expiryDate: expires ? document.expiryDate! : null };
  }
  if (!document.dataBase64) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Document upload is required', path: ['uploadId'] });
    return z.NEVER;
  }
  try {
    return { ...document, expiryDate: expires ? document.expiryDate! : null, ...verifyVerificationDocument({ ...document, dataBase64: document.dataBase64 }) };
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : 'Document is invalid',
      path: ['dataBase64'],
    });
    return z.NEVER;
  }
});

export type UploadVerificationDocumentInput = z.infer<typeof uploadVerificationDocumentSchema>;
