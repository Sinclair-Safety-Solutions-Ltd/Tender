import { NextResponse } from 'next/server';
import { requireFullSuperUser } from '@/server/auth/session';
import { toErrorResponse } from '@/server/http/errors';
import { privateFileResponse } from '@/server/http/privateFileResponse';
import { getVerificationDocumentForDownload } from '@/server/domain/verificationDocumentService';
import { VERIFICATION_DOCUMENT_TYPES, type VerificationDocumentType } from '@/lib/verification-documents';

function parseDocumentType(value: string): VerificationDocumentType | null {
  return VERIFICATION_DOCUMENT_TYPES.some((doc) => doc.type === value) ? (value as VerificationDocumentType) : null;
}

export async function GET(request: Request, props: { params: Promise<{ id: string; documentType: string }> }) {
  const params = await props.params;
  try {
    const admin = await requireFullSuperUser();
    const documentType = parseDocumentType(params.documentType);
    if (!documentType) return NextResponse.json({ error: 'Unknown document type' }, { status: 404 });

    const document = await getVerificationDocumentForDownload(params.id, documentType, { id: admin.id, role: 'SUPER_USER' });
    return privateFileResponse(request, document);
  } catch (error) {
    return toErrorResponse(error);
  }
}
