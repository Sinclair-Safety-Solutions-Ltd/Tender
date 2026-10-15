import type { Readable } from 'node:stream';

export type StoragePurpose = 'temporary' | 'durable' | 'archive';

export type ObjectStat = {
  sizeBytes: number;
  checksum: string | null;
};

export type StoredBytes = {
  checksum: string;
  sizeBytes: number;
};

/** Provider-independent byte store. Missing objects are null, not a filesystem error. */
export type ObjectStore = {
  put(objectKey: string, bytes: Buffer): Promise<StoredBytes>;
  get(objectKey: string): Promise<Buffer | null>;
  openRead(objectKey: string): Promise<Readable | null>;
  delete(objectKey: string): Promise<void>;
  copy(sourceKey: string, destKey: string): Promise<void>;
  move(sourceKey: string, destKey: string): Promise<void>;
  head(objectKey: string): Promise<ObjectStat | null>;
  createDownloadUrl(objectKey: string, ttlSeconds: number): Promise<string | null>;
};

export type StoredObjectRef = {
  objectKey: string | null;
  locationId: string | null;
  storedObjectId?: string | null;
  checksum?: string | null;
};
