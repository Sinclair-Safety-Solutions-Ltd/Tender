import { NextResponse } from 'next/server';
import { buildSafeAttachmentName } from '@/lib/attachment-utils';
import { MAX_TENDER_ATTACHMENT_BYTES, MAX_VERIFICATION_DOCUMENT_BYTES } from '@/lib/attachment-utils';
import { requireRole } from '@/server/auth/session';
import { stageUpload, storageTenantIdForUser, type UploadPurpose } from '@/server/domain/stagedUpload';
import { toErrorResponse } from '@/server/http/errors';
import { rejectCrossOrigin } from '@/server/http/origin';
import { PayloadTooLargeError, readLimitedBody } from '@/server/storage/readLimitedBody';

export const dynamic = 'force-dynamic';

function uploadPurpose(value: string | null): UploadPurpose | null {
  if (value === 'tender-attachment' || value === 'verification-document') return value;
  return null;
}

export async function POST(request: Request) {
  try {
    const originError = rejectCrossOrigin(request);
    if (originError) return originError;
    const user = await requireRole('USER');
    const purpose = uploadPurpose(request.headers.get('x-upload-purpose'));
    if (!purpose) return NextResponse.json({ error: 'Upload purpose is required' }, { status: 400 });
    const fileName = buildSafeAttachmentName(request.headers.get('x-file-name') ?? 'attachment');
    const mimeType = request.headers.get('x-file-mime')?.trim() || 'application/octet-stream';
    const maxBytes = purpose === 'verification-document' ? MAX_VERIFICATION_DOCUMENT_BYTES : MAX_TENDER_ATTACHMENT_BYTES;
    const bytes = await readLimitedBody(request, maxBytes);
    const upload = await stageUpload({
      tenantId: await storageTenantIdForUser(user.id),
      fileName,
      mimeType,
      bytes,
      purpose,
    });
    return NextResponse.json(upload, { status: 201 });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413 });
    return toErrorResponse(error);
  }
}
