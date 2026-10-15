import path from 'node:path';
import { createFilesystemObjectStore } from '@/server/storage/filesystemObjectStore';
import { createS3CompatibleObjectStore } from '@/server/storage/s3CompatibleObjectStore';
import type { ObjectStore, StoragePurpose } from '@/server/storage/types';

export type StorageDriverName = 'filesystem' | 's3';

export type StorageLocation = {
  id: string;
  purpose: StoragePurpose;
  driver: StorageDriverName;
  store: ObjectStore;
  root?: string;
};

type LocationJson = {
  id?: string;
  purpose?: string;
  driver?: string;
  root?: string;
  rootEnv?: string;
  endpoint?: string;
  bucket?: string;
  region?: string;
  accessKeyEnv?: string;
  secretKeyEnv?: string;
  forcePathStyle?: boolean;
};

const PURPOSES: StoragePurpose[] = ['temporary', 'durable', 'archive'];

export function defaultDurableRoot(): string {
  return path.join(process.cwd(), 'data', 'attachments');
}

function envRoot(env: NodeJS.ProcessEnv, name: string | undefined, fallback: string): string {
  const fromNamed = name ? env[name]?.trim() : '';
  return fromNamed || fallback;
}

function filesystemLocation(id: string, purpose: StoragePurpose, root: string): StorageLocation {
  return { id, purpose, driver: 'filesystem', root, store: createFilesystemObjectStore(root) };
}

function s3Location(id: string, purpose: StoragePurpose, env: NodeJS.ProcessEnv, bucketEnv = 'OBJECT_STORE_BUCKET'): StorageLocation {
  const endpoint = env.OBJECT_STORE_ENDPOINT?.trim();
  const bucket = env[bucketEnv]?.trim() || env.OBJECT_STORE_BUCKET?.trim();
  const accessKeyId = env.OBJECT_STORE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.OBJECT_STORE_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('S3-compatible storage requires OBJECT_STORE_ENDPOINT, OBJECT_STORE_BUCKET, OBJECT_STORE_ACCESS_KEY_ID, and OBJECT_STORE_SECRET_ACCESS_KEY');
  }
  return {
    id,
    purpose,
    driver: 's3',
    store: createS3CompatibleObjectStore({
      endpoint,
      bucket,
      region: env.OBJECT_STORE_REGION?.trim() || 'auto',
      accessKeyId,
      secretAccessKey,
      forcePathStyle: env.OBJECT_STORE_FORCE_PATH_STYLE !== 'false',
    }),
  };
}

function locationFromJson(entry: LocationJson, env: NodeJS.ProcessEnv): StorageLocation {
  if (!entry.id || !entry.purpose || !PURPOSES.includes(entry.purpose as StoragePurpose)) {
    throw new Error('STORAGE_LOCATIONS entries need an id and a purpose of temporary, durable, or archive');
  }
  const purpose = entry.purpose as StoragePurpose;
  if (entry.driver === 's3') {
    const accessKeyId = entry.accessKeyEnv ? env[entry.accessKeyEnv]?.trim() : env.OBJECT_STORE_ACCESS_KEY_ID?.trim();
    const secretAccessKey = entry.secretKeyEnv ? env[entry.secretKeyEnv]?.trim() : env.OBJECT_STORE_SECRET_ACCESS_KEY?.trim();
    if (!entry.endpoint || !entry.bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(`Storage location ${entry.id} is missing endpoint, bucket, or credentials`);
    }
    return {
      id: entry.id,
      purpose,
      driver: 's3',
      store: createS3CompatibleObjectStore({
        endpoint: entry.endpoint,
        bucket: entry.bucket,
        region: entry.region?.trim() || 'auto',
        accessKeyId,
        secretAccessKey,
        forcePathStyle: entry.forcePathStyle !== false,
      }),
    };
  }
  const root = entry.root?.trim() || envRoot(env, entry.rootEnv, defaultDurableRoot());
  return filesystemLocation(entry.id, purpose, root);
}

export function loadStorageLocations(env: NodeJS.ProcessEnv = process.env): StorageLocation[] {
  if (env.STORAGE_LOCATIONS?.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(env.STORAGE_LOCATIONS);
    } catch {
      throw new Error('STORAGE_LOCATIONS must be JSON');
    }
    if (!Array.isArray(parsed)) throw new Error('STORAGE_LOCATIONS must be a JSON array');
    const configured = parsed.map((entry) => locationFromJson(entry as LocationJson, env));
    return PURPOSES.map((purpose) => {
      const match = configured.find((location) => location.purpose === purpose);
      if (match) return match;
      return filesystemLocation(`filesystem-${purpose}`, purpose, fallbackRoot(env, purpose));
    });
  }

  const driver = (env.STORAGE_DRIVER?.trim() || 'filesystem').toLowerCase();
  if (driver === 's3') {
    const archiveBucket = env.OBJECT_STORE_ARCHIVE_BUCKET?.trim();
    return [
      filesystemLocation('filesystem-temporary', 'temporary', fallbackRoot(env, 'temporary')),
      s3Location('s3-durable', 'durable', env),
      archiveBucket ? s3Location('s3-archive', 'archive', env, 'OBJECT_STORE_ARCHIVE_BUCKET') : s3Location('s3-archive', 'archive', env),
    ];
  }
  if (driver !== 'filesystem') throw new Error('STORAGE_DRIVER must be filesystem or s3');
  return PURPOSES.map((purpose) => filesystemLocation(`filesystem-${purpose}`, purpose, fallbackRoot(env, purpose)));
}

function fallbackRoot(env: NodeJS.ProcessEnv, purpose: StoragePurpose): string {
  if (purpose === 'temporary') return env.ATTACHMENT_TEMP_DIR?.trim() || path.join(process.cwd(), 'data', 'attachments-temporary');
  if (purpose === 'archive') return env.ATTACHMENT_ARCHIVE_DIR?.trim() || path.join(process.cwd(), 'data', 'attachments-archive');
  return env.ATTACHMENT_STORE_DIR?.trim() || defaultDurableRoot();
}

export function locationForPurpose(purpose: StoragePurpose, env: NodeJS.ProcessEnv = process.env): StorageLocation {
  const location = loadStorageLocations(env).find((entry) => entry.purpose === purpose);
  if (!location) throw new Error(`No storage location configured for ${purpose}`);
  return location;
}

export function locationById(locationId: string, env: NodeJS.ProcessEnv = process.env): StorageLocation | null {
  return loadStorageLocations(env).find((entry) => entry.id === locationId) ?? null;
}

export function assertProductionStorageConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const durable = locationForPurpose('durable', env);
  if (durable.driver === 'filesystem' && durable.root && path.resolve(durable.root) === path.resolve(defaultDurableRoot())) {
    throw new Error('Production storage is still the default ephemeral directory. Set ATTACHMENT_STORE_DIR to a durable path or STORAGE_DRIVER to a configured object location.');
  }
}
