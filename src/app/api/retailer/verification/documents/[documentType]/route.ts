import { NextResponse } from 'next/server';
import { requireRole } from '@/server/auth/session';
import { toErrorResponse } from '@/server/http/errors';
import { privateFileResponse } from '@/server/http/privateFileResponse';
import { rejectCrossOrigin } from '@/server/http/origin';
import { deleteVerificationDocument, getVerificationDocumentForDownload } from '@/server/domain/verificationDocumentService';
import { VERIFICATION_DOCUMENT_TYPES, type VerificationDocumentType } from '@/lib/verification-documents';

function parseDocumentType(value: string): VerificationDocumentType | null {
  return VERIFICATION_DOCUMENT_TYPES.some((doc) => doc.type === value) ? (value as VerificationDocumentType) : null;
}

export async function GET(request: Request, props: { params: Promise<{ documentType: string }> }) {
  const params = await props.params;
  try {
    const user = await requireRole('USER');
    const documentType = parseDocumentType(params.documentType);
    if (!documentType) return NextResponse.json({ error: 'Unknown document type' }, { status: 404 });

    const document = await getVerificationDocumentForDownload(user.id, documentType, { id: user.id, role: user.role });
    return privateFileResponse(request, document);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ documentType: string }> }) {
  const params = await props.params;
  try {
    const originError = rejectCrossOrigin(request);
    if (originError) return originError;
    const user = await requireRole('USER');
    const documentType = parseDocumentType(params.documentType);
    if (!documentType) return NextResponse.json({ error: 'Unknown document type' }, { status: 404 });

    await deleteVerificationDocument(user.id, documentType);
    return NextResponse.json({ status: 'deleted' });
  } catch (error) {
    return toErrorResponse(error);
  }
}
