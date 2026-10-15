import { Readable } from 'node:stream';
import { sha256Hex } from '@/server/storage/checksum';
import { assertObjectKey } from '@/server/storage/keys';
import { amzDate, authorizationHeader, emptyPayloadHash, payloadHash, presignGetUrl } from '@/server/storage/s3SigV4';
import type { ObjectStat, ObjectStore, StoredBytes } from '@/server/storage/types';

export type S3CompatibleOptions = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

function objectUrl(options: S3CompatibleOptions, objectKey: string): URL {
  assertObjectKey(objectKey);
  const endpoint = new URL(options.endpoint);
  const encodedKey = objectKey.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  if (options.forcePathStyle !== false) {
    const base = endpoint.pathname.replace(/\/$/, '');
    return new URL(`${endpoint.origin}${base}/${options.bucket}/${encodedKey}`);
  }
  return new URL(`${endpoint.protocol}//${options.bucket}.${endpoint.host}/${encodedKey}`);
}

async function readBody(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

export function createS3CompatibleObjectStore(options: S3CompatibleOptions): ObjectStore {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = () => options.now?.() ?? new Date();

  async function request(method: string, objectKey: string, body?: Buffer, extraHeaders?: Record<string, string>): Promise<Response> {
    const url = objectUrl(options, objectKey);
    const instant = now();
    const hash = body ? payloadHash(body) : emptyPayloadHash();
    const headers: Record<string, string> = {
      ...(extraHeaders ?? {}),
      'x-amz-date': amzDate(instant),
      'x-amz-content-sha256': hash,
    };
    const signed = authorizationHeader({
      method,
      url,
      headers,
      payloadHash: hash,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      region: options.region,
      now: instant,
    });
    return fetchImpl(url, {
      method,
      headers: {
        ...headers,
        host: url.host,
        authorization: signed.authorization,
      },
      body: body ? new Uint8Array(body) : undefined,
    });
  }

  return {
    async put(objectKey: string, bytes: Buffer): Promise<StoredBytes> {
      const checksum = sha256Hex(bytes);
      const response = await request('PUT', objectKey, bytes, { 'x-amz-meta-checksum': checksum });
      if (!response.ok) throw new Error(`Object store put failed (${response.status})`);
      return { checksum, sizeBytes: bytes.length };
    },

    async get(objectKey: string): Promise<Buffer | null> {
      const response = await request('GET', objectKey);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Object store get failed (${response.status})`);
      return readBody(response);
    },

    async openRead(objectKey: string): Promise<Readable | null> {
      const bytes = await this.get(objectKey);
      return bytes ? Readable.from(bytes) : null;
    },

    async delete(objectKey: string): Promise<void> {
      const response = await request('DELETE', objectKey);
      if (response.status === 404 || response.ok) return;
      throw new Error(`Object store delete failed (${response.status})`);
    },

    async copy(sourceKey: string, destKey: string): Promise<void> {
      const source = objectUrl(options, sourceKey);
      const copySource = `${source.pathname}`;
      const response = await request('PUT', destKey, Buffer.alloc(0), { 'x-amz-copy-source': copySource });
      if (!response.ok) throw new Error(`Object store copy failed (${response.status})`);
    },

    async move(sourceKey: string, destKey: string): Promise<void> {
      await this.copy(sourceKey, destKey);
      await this.delete(sourceKey);
    },

    async head(objectKey: string): Promise<ObjectStat | null> {
      const response = await request('HEAD', objectKey);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Object store head failed (${response.status})`);
      const length = Number(response.headers.get('content-length') ?? '0');
      const checksum = response.headers.get('x-amz-meta-checksum');
      return { sizeBytes: Number.isFinite(length) ? length : 0, checksum };
    },

    async createDownloadUrl(objectKey: string, ttlSeconds: number): Promise<string | null> {
      return presignGetUrl({
        url: objectUrl(options, objectKey),
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        region: options.region,
        ttlSeconds,
        now: now(),
      });
    },
  };
}
