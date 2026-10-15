import { requireRole } from '@/server/auth/session';
import { toErrorResponse } from '@/server/http/errors';
import { privateFileResponse } from '@/server/http/privateFileResponse';
import { getTenderAttachmentForDownload } from '@/server/domain/tenderAttachmentService';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const params = await props.params;
  try {
    const user = await requireRole('USER');
    const attachment = await getTenderAttachmentForDownload(params.id, params.attachmentId, { id: user.id });
    return privateFileResponse(request, attachment);
  } catch (error) {
    return toErrorResponse(error);
  }
}