import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { sha256Hex } from '../../src/server/storage/checksum';
import { assertProductionStorageConfigured, defaultDurableRoot, loadStorageLocations } from '../../src/server/storage/config';
import { writeObjectExport } from '../../src/server/storage/exportManifest';
import { createFilesystemObjectStore } from '../../src/server/storage/filesystemObjectStore';
import { relocateVerifiedObject } from '../../src/server/storage/objectLifecycle';
import { createS3CompatibleObjectStore } from '../../src/server/storage/s3CompatibleObjectStore';
import { authorizationHeader } from '../../src/server/storage/s3SigV4';

test('filesystem store copies, moves, and reports a missing object as null', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'object-store-'));
  try {
    const store = createFilesystemObjectStore(root);
    const stored = await store.put('tenants/t1/tenders/a/b', Buffer.from('plan'));
    assert.equal(stored.checksum, sha256Hex(Buffer.from('plan')));
    assert.equal((await store.head('tenants/t1/tenders/a/b'))?.checksum, stored.checksum);
    await store.copy('tenants/t1/tenders/a/b', 'tenants/t1/tenders/a/c');
    await store.move('tenants/t1/tenders/a/c', 'tenants/t1/archive/c');
    assert.equal(await store.get('tenants/t1/tenders/a/c'), null);
    assert.equal((await store.get('tenants/t1/archive/c'))?.toString(), 'plan');
    assert.equal(await store.createDownloadUrl('tenants/t1/archive/c', 60), null);
    await store.delete('tenants/t1/archive/c');
    assert.equal(await store.get('tenants/t1/archive/c'), null);
    const missing = await store.get('missing');
    assert.equal(missing, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('locations come from configuration and production rejects the default directory', () => {
  const locations = loadStorageLocations({ STORAGE_DRIVER: 'filesystem', ATTACHMENT_STORE_DIR: '/var/data/documents' });
  assert.deepEqual(locations.map((location) => location.purpose), ['temporary', 'durable', 'archive']);
  assert.equal(locations.find((location) => location.purpose === 'durable')?.driver, 'filesystem');
  assert.equal(locations.find((location) => location.purpose === 'durable')?.root, '/var/data/documents');
  assert.doesNotThrow(() => assertProductionStorageConfigured({ NODE_ENV: 'production', ATTACHMENT_STORE_DIR: '/var/data/documents' }));
  assert.throws(
    () => assertProductionStorageConfigured({ NODE_ENV: 'production' }),
    /default ephemeral directory/,
  );
  assert.equal(path.resolve(defaultDurableRoot()), path.resolve(path.join(process.cwd(), 'data', 'attachments')));
});

test('s3 driver treats 404 as missing and can presign a download', async () => {
  const calls: string[] = [];
  const store = createS3CompatibleObjectStore({
    endpoint: 'https://objects.example',
    bucket: 'files',
    region: 'auto',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    fetchImpl: async (input, init) => {
      calls.push(`${init?.method} ${input.toString()}`);
      const method = init?.method ?? 'GET';
      if (method === 'GET') return new Response(null, { status: 404 });
      if (method === 'HEAD') return new Response(null, { status: 404 });
      return new Response(null, { status: 200, headers: { 'content-length': '4', 'x-amz-meta-checksum': sha256Hex(Buffer.from('plan')) } });
    },
  });
  assert.equal(await store.get('tenants/t1/file'), null);
  const url = await store.createDownloadUrl('tenants/t1/file', 120);
  assert.match(url ?? '', /X-Amz-Signature=/);
  assert.match(url ?? '', /X-Amz-Expires=120/);
  assert.equal(calls[0]?.startsWith('GET '), true);
});

test('sigv4 authorization covers the AWS sample request', () => {
  const url = new URL('https://examplebucket.s3.amazonaws.com/test.txt');
  const signed = authorizationHeader({
    method: 'GET',
    url,
    headers: {
      range: 'bytes=0-9',
      'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'x-amz-date': '20130524T000000Z',
    },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    now: new Date('2013-05-24T00:00:00.000Z'),
  });
  assert.match(signed.authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41/);
});

test('export writes a portable manifest and relocate verifies checksums', async () => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'object-source-'));
  const destRoot = await mkdtemp(path.join(os.tmpdir(), 'object-dest-'));
  const exportDir = await mkdtemp(path.join(os.tmpdir(), 'object-export-'));
  const previous = process.env.STORAGE_LOCATIONS;
  try {
    const bytes = Buffer.from('%PDF-1.7');
    process.env.STORAGE_LOCATIONS = JSON.stringify([
      { id: 'source', purpose: 'durable', driver: 'filesystem', root: sourceRoot },
      { id: 'dest', purpose: 'archive', driver: 'filesystem', root: destRoot },
      { id: 'temp', purpose: 'temporary', driver: 'filesystem', root: sourceRoot },
    ]);
    const source = createFilesystemObjectStore(sourceRoot);
    const stored = await source.put('tenants/tenant/file', bytes);
    const manifest = await writeObjectExport(exportDir, [{
      entity: 'TenderAttachment',
      id: 'att1',
      storageKey: 'tenants/tenant/file',
      locationId: 'source',
      tenantId: 'tenant',
      fileName: 'plan.pdf',
      mimeType: 'application/pdf',
      sizeBytes: bytes.length,
      checksum: stored.checksum,
    }], async () => source.get('tenants/tenant/file'));
    assert.equal(manifest.objects.length, 1);
    assert.equal(manifest.objects[0]?.checksum, stored.checksum);
    await relocateVerifiedObject({
      sourceLocationId: 'source',
      destLocationId: 'dest',
      objectKey: 'tenants/tenant/file',
      expectedChecksum: stored.checksum,
    });
    const dest = createFilesystemObjectStore(destRoot);
    assert.equal(sha256Hex((await dest.get('tenants/tenant/file')) ?? Buffer.alloc(0)), stored.checksum);
    await assert.rejects(
      () => relocateVerifiedObject({ sourceLocationId: 'source', destLocationId: 'dest', objectKey: 'tenants/tenant/file', expectedChecksum: 'ab'.repeat(32) }),
      /checksum/,
    );
  } finally {
    if (previous === undefined) delete process.env.STORAGE_LOCATIONS;
    else process.env.STORAGE_LOCATIONS = previous;
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(destRoot, { recursive: true, force: true });
    await rm(exportDir, { recursive: true, force: true });
  }
});
