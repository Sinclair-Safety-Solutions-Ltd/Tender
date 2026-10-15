export const MAX_TENDER_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TENDER_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;
/** Text PDFs for automated verification. Larger scans previously exhausted the Node heap on inflate. */
export const MAX_VERIFICATION_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const MAX_VERIFICATION_DOCUMENT_BASE64_CHARS = Math.ceil(MAX_VERIFICATION_DOCUMENT_BYTES * 4 / 3) + 4;

type AllowedMimeType = 'application/pdf' | 'image/jpeg' | 'image/png';

type VerifiedTenderAttachment = {
  mimeType: AllowedMimeType;
  sizeBytes: number;
  dataBase64: string;
};

type VerifiedBytes = {
  mimeType: AllowedMimeType;
  sizeBytes: number;
};

// A flat character class (no repeated group) avoids V8 regex stack overflows on large decoded files.
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const PDF_ACTIVE_CONTENT_NAMES = ['/AA', '/EmbeddedFile', '/JavaScript', '/JS', '/Launch', '/OpenAction', '/RichMedia', '/XFA'] as const;

function isPdfNameDelimiter(byte: number | undefined): boolean {
  if (byte == null || byte <= 32) return true;
  return byte === 37 || byte === 40 || byte === 41 || byte === 47 || byte === 60 || byte === 62 || byte === 91 || byte === 93 || byte === 123 || byte === 125;
}

/** Search PDF name tokens in the buffer so a 10 MiB file is never copied into a latin1 string. */
function pdfContainsActiveContent(bytes: Buffer): boolean {
  for (const name of PDF_ACTIVE_CONTENT_NAMES) {
    const needle = Buffer.from(name, 'ascii');
    let from = 0;
    while (from < bytes.length) {
      const index = bytes.indexOf(needle, from);
      if (index === -1) break;
      if (isPdfNameDelimiter(bytes[index + needle.length])) return true;
      from = index + 1;
    }
  }
  return false;
}

function hasFileExtension(fileName: string, extensions: readonly string[]): boolean {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return extensions.includes(extension);
}

function detectMimeType(bytes: Buffer): AllowedMimeType | null {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

export function verifyTenderAttachmentBytes(input: { name: string; mimeType: string; bytes: Buffer }): VerifiedBytes {
  if (input.bytes.length === 0 || input.bytes.length > MAX_TENDER_ATTACHMENT_BYTES) {
    throw new Error('Attachment exceeds the 10 MiB decoded file limit');
  }

  const detectedMimeType = detectMimeType(input.bytes);
  if (!detectedMimeType || input.mimeType.toLowerCase() !== detectedMimeType) {
    throw new Error('Attachment type does not match an allowed file signature');
  }

  const allowedExtensions = detectedMimeType === 'application/pdf'
    ? ['.pdf']
    : detectedMimeType === 'image/png'
      ? ['.png']
      : ['.jpg', '.jpeg'];
  if (!hasFileExtension(input.name, allowedExtensions)) {
    throw new Error('Attachment filename does not match its verified file type');
  }

  if (detectedMimeType === 'application/pdf' && pdfContainsActiveContent(input.bytes)) {
    throw new Error('Active PDF content is not allowed');
  }

  return { mimeType: detectedMimeType, sizeBytes: input.bytes.length };
}

export function verifyTenderAttachment(input: { name: string; mimeType: string; dataBase64: string }): VerifiedTenderAttachment {
  if (input.dataBase64.length === 0 || input.dataBase64.length % 4 !== 0 || !BASE64_PATTERN.test(input.dataBase64)) {
    throw new Error('Attachment content must be valid base64');
  }

  const bytes = Buffer.from(input.dataBase64, 'base64');
  const verified = verifyTenderAttachmentBytes({ name: input.name, mimeType: input.mimeType, bytes });
  return { ...verified, dataBase64: input.dataBase64 };
}

export function verifyVerificationDocumentBytes(input: { name: string; mimeType: string; bytes: Buffer }): { mimeType: 'application/pdf'; sizeBytes: number } {
  if (input.bytes.length > MAX_VERIFICATION_DOCUMENT_BYTES) {
    throw new Error('Verification PDF exceeds the 2 MB decoded file limit. Export a text PDF from Companies House or your insurer.');
  }
  const verified = verifyTenderAttachmentBytes(input);
  if (verified.mimeType !== 'application/pdf') {
    throw new Error('Verification evidence must be a PDF');
  }
  return { mimeType: 'application/pdf', sizeBytes: verified.sizeBytes };
}

export function verifyVerificationDocument(input: { name: string; mimeType: string; dataBase64: string }): { mimeType: 'application/pdf'; sizeBytes: number; dataBase64: string } {
  if (input.dataBase64.length > MAX_VERIFICATION_DOCUMENT_BASE64_CHARS) {
    throw new Error('Verification PDF exceeds the 2 MB decoded file limit. Export a text PDF from Companies House or your insurer.');
  }
  const verified = verifyTenderAttachment(input);
  if (verified.mimeType !== 'application/pdf') {
    throw new Error('Verification evidence must be a PDF');
  }
  if (verified.sizeBytes > MAX_VERIFICATION_DOCUMENT_BYTES) {
    throw new Error('Verification PDF exceeds the 2 MB decoded file limit. Export a text PDF from Companies House or your insurer.');
  }
  return { mimeType: 'application/pdf', sizeBytes: verified.sizeBytes, dataBase64: verified.dataBase64 };
}

export function buildSafeAttachmentName(input: string): string {
  const cleaned = input
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .replace(/-+/g, '-')
    .replace(/\.+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .toLowerCase();

  return cleaned && cleaned.length > 0 ? cleaned : 'attachment';
}
