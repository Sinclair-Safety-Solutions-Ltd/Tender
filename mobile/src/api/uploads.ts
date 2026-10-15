import * as FileSystem from 'expo-file-system/legacy';
import { getCachedMobileSession, loadMobileSession } from '../auth/session';
import { mobileApiBaseUrl } from './config';

export async function uploadMobileFile(file: { uri: string; name: string; mimeType: string }, purpose: 'tender-attachment' | 'verification-document'): Promise<{ uploadId: string; sizeBytes: number; checksum: string; fileName: string; mimeType: string }> {
  const session = getCachedMobileSession() ?? await loadMobileSession();
  if (!session) throw new Error('Sign in is required.');
  const result = await FileSystem.uploadAsync(`${mobileApiBaseUrl()}/api/uploads`, file.uri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/octet-stream',
      'x-file-name': file.name,
      'x-file-mime': file.mimeType,
      'x-upload-purpose': purpose,
    },
  });
  const body = JSON.parse(result.body || '{}') as { uploadId?: string; sizeBytes?: number; checksum?: string; fileName?: string; mimeType?: string; error?: string };
  if (result.status < 200 || result.status >= 300 || !body.uploadId) {
    throw new Error(body.error ?? 'Unable to upload the file.');
  }
  return {
    uploadId: body.uploadId,
    sizeBytes: body.sizeBytes ?? 0,
    checksum: body.checksum ?? '',
    fileName: body.fileName ?? file.name,
    mimeType: body.mimeType ?? file.mimeType,
  };
}
