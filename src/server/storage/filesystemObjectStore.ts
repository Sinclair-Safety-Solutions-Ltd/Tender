import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { sha256Hex } from '@/server/storage/checksum';
import { assertObjectKey } from '@/server/storage/keys';
import type { ObjectStat, ObjectStore, StoredBytes } from '@/server/storage/types';

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export function createFilesystemObjectStore(rootDir: string): ObjectStore {
  function resolve(objectKey: string): string {
    assertObjectKey(objectKey);
    const root = path.resolve(rootDir);
    const resolved = path.resolve(root, objectKey);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error('Invalid attachment object key');
    }
    return resolved;
  }

  const checksumPath = (objectKey: string) => `${resolve(objectKey)}.sha256`;

  async function readChecksum(objectKey: string): Promise<string | null> {
    try {
      const text = (await readFile(checksumPath(objectKey), 'utf8')).trim();
      return /^[a-f0-9]{64}$/.test(text) ? text : null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  return {
    async put(objectKey: string, bytes: Buffer): Promise<StoredBytes> {
      const filePath = resolve(objectKey);
      await mkdir(path.dirname(filePath), { recursive: true });
      const checksum = sha256Hex(bytes);
      await writeFile(filePath, bytes);
      await writeFile(`${filePath}.sha256`, checksum);
      return { checksum, sizeBytes: bytes.length };
    },

    async get(objectKey: string): Promise<Buffer | null> {
      try {
        return await readFile(resolve(objectKey));
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async openRead(objectKey: string): Promise<Readable | null> {
      try {
        await stat(resolve(objectKey));
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
      return createReadStream(resolve(objectKey));
    },

    async delete(objectKey: string): Promise<void> {
      await rm(resolve(objectKey), { force: true });
      await rm(checksumPath(objectKey), { force: true });
    },

    async copy(sourceKey: string, destKey: string): Promise<void> {
      const dest = resolve(destKey);
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(resolve(sourceKey), dest);
      const checksum = await readChecksum(sourceKey);
      if (checksum) await writeFile(`${dest}.sha256`, checksum);
    },

    async move(sourceKey: string, destKey: string): Promise<void> {
      const source = resolve(sourceKey);
      const dest = resolve(destKey);
      await mkdir(path.dirname(dest), { recursive: true });
      try {
        await rename(source, dest);
        try {
          await rename(checksumPath(sourceKey), `${dest}.sha256`);
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
        await copyFile(source, dest);
        const checksum = await readChecksum(sourceKey);
        if (checksum) await writeFile(`${dest}.sha256`, checksum);
        await rm(source, { force: true });
        await rm(checksumPath(sourceKey), { force: true });
      }
    },

    async head(objectKey: string): Promise<ObjectStat | null> {
      try {
        const info = await stat(resolve(objectKey));
        return { sizeBytes: info.size, checksum: await readChecksum(objectKey) };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async createDownloadUrl(): Promise<string | null> {
      return null;
    },
  };
}
