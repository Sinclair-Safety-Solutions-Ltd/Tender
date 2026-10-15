import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256Hex } from '@/server/storage/checksum';

export type ExportRecord = {
  entity: 'TenderAttachment' | 'VerificationDocument' | 'StoredObject';
  id: string;
  storageKey: string;
  locationId: string | null;
  tenantId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string | null;
};

export type ExportManifest = {
  exportedAt: string;
  objects: Array<ExportRecord & { relativePath: string; checksum: string }>;
};

export async function writeObjectExport(
  outputDir: string,
  records: ExportRecord[],
  readObject: (record: ExportRecord) => Promise<Buffer | null>,
): Promise<ExportManifest> {
  const filesDir = path.join(outputDir, 'files');
  await mkdir(filesDir, { recursive: true });
  const objects: ExportManifest['objects'] = [];
  for (const record of records) {
    const bytes = await readObject(record);
    if (!bytes) continue;
    const checksum = sha256Hex(bytes);
    if (record.checksum && record.checksum !== checksum) {
      throw new Error(`Checksum mismatch for ${record.entity} ${record.id}`);
    }
    const relativePath = path.posix.join('files', record.entity, record.id);
    await mkdir(path.dirname(path.join(outputDir, relativePath)), { recursive: true });
    await writeFile(path.join(outputDir, relativePath), bytes);
    objects.push({ ...record, relativePath, checksum, sizeBytes: bytes.length });
  }
  const manifest: ExportManifest = { exportedAt: new Date().toISOString(), objects };
  await writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
