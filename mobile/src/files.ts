import * as DocumentPicker from 'expo-document-picker';

/** Keep in sync with src/lib/attachment-utils.ts MAX_VERIFICATION_DOCUMENT_BYTES. */
export const MAX_VERIFICATION_DOCUMENT_BYTES = 2 * 1024 * 1024;

export type PickedDocument = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  uri: string;
};

export async function pickDocument(): Promise<PickedDocument | null> {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: '*/*', multiple: false });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return {
    name: asset.name ?? 'document',
    mimeType: asset.mimeType ?? 'application/octet-stream',
    sizeBytes: asset.size ?? 0,
    uri: asset.uri,
  };
}

export async function pickVerificationDocument(): Promise<PickedDocument | null> {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    type: 'application/pdf',
    multiple: false,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const name = asset.name ?? 'document.pdf';
  if (!name.toLowerCase().endsWith('.pdf') && asset.mimeType !== 'application/pdf') {
    throw new Error('Upload a PDF. Photographs and other file types are not accepted.');
  }
  const sizeBytes = asset.size ?? 0;
  if (sizeBytes > MAX_VERIFICATION_DOCUMENT_BYTES) {
    throw new Error('Use a PDF smaller than 2 MB. Export a text PDF from Companies House or your insurer; large scans are not accepted.');
  }
  return {
    name,
    mimeType: 'application/pdf',
    sizeBytes,
    uri: asset.uri,
  };
}
