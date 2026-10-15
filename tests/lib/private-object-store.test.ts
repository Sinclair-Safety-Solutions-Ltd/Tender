import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deletePrivateObject, getPrivateObject, putPrivateObject, tenderAttachmentObjectKey, verificationDocumentObjectKey } from '../../src/server/storage/privateObjectStore';
import { readTenderAttachmentBytes } from '../../src/server/storage/tenderAttachmentStore';
import { readVerificationDocumentBytes } from '../../src/server/storage/verificationDocumentStore';

test('object keys stay inside the private store', async () => {
  const previous = process.env.ATTACHMENT_STORE_DIR;
  const root = await mkdtemp(path.join(os.tmpdir(), 'tender-attachments-'));
  process.env.ATTACHMENT_STORE_DIR = root;
  try {
    assert.equal(tenderAttachmentObjectKey('tender1', 'file1'), 'tenders/tender1/file1');
    assert.equal(tenderAttachmentObjectKey('tender1', 'file1', 'tenant1'), 'tenants/tenant1/tenders/tender1/file1');
    assert.equal(verificationDocumentObjectKey('profile1', 'PUBLIC_LIABILITY_INSURANCE'), 'tenants/profile1/verification/profile1/PUBLIC_LIABILITY_INSURANCE');
    assert.throws(() => tenderAttachmentObjectKey('../tender', 'file1'), /Invalid/);
    assert.throws(() => verificationDocumentObjectKey('../profile', 'PUBLIC_LIABILITY_INSURANCE'), /Invalid/);
    await assert.rejects(() => putPrivateObject('../secret', Buffer.from('no')), /Invalid/);
    await putPrivateObject('tenders/tender1/file1', Buffer.from('%PDF-1.7'));
    assert.equal((await getPrivateObject('tenders/tender1/file1')).toString(), '%PDF-1.7');
    await deletePrivateObject('tenders/tender1/file1');
    await assert.rejects(() => getPrivateObject('tenders/tender1/file1'));
  } finally {
    if (previous === undefined) delete process.env.ATTACHMENT_STORE_DIR;
    else process.env.ATTACHMENT_STORE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('attachment reads prefer the object store over legacy Postgres bytes', async () => {
  const previous = process.env.ATTACHMENT_STORE_DIR;
  const root = await mkdtemp(path.join(os.tmpdir(), 'tender-attachments-'));
  process.env.ATTACHMENT_STORE_DIR = root;
  try {
    await putPrivateObject('tenders/t1/a1', Buffer.from('store-bytes'));
    const fromStore = await readTenderAttachmentBytes({ objectKey: 'tenders/t1/a1', content: Buffer.from('db-bytes') });
    assert.equal(fromStore?.toString(), 'store-bytes');
    const fromDb = await readTenderAttachmentBytes({ objectKey: null, content: Buffer.from('db-bytes') });
    assert.equal(fromDb?.toString(), 'db-bytes');
    const missing = await readTenderAttachmentBytes({ objectKey: null, content: null });
    assert.equal(missing, null);
  } finally {
    if (previous === undefined) delete process.env.ATTACHMENT_STORE_DIR;
    else process.env.ATTACHMENT_STORE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('new tender attachments are stored privately and not as Postgres bytes', () => {
  const create = readFileSync('src/server/domain/tenderService.ts', 'utf8');
  const persist = readFileSync('src/server/storage/tenderAttachmentStore.ts', 'utf8');
  const snapshot = readFileSync('src/server/domain/tenderService.ts', 'utf8');
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  assert.match(create, /persistNewTenderAttachments\(tender\.id/);
  assert.doesNotMatch(create, /content: Buffer\.from\(attachment\.dataBase64/);
  assert.match(persist, /writeDurableObject|promoteTemporaryUpload/);
  assert.doesNotMatch(persist, /content: Buffer/);
  assert.doesNotMatch(snapshot, /contentBase64/);
  const attachmentModel = schema.match(/model TenderAttachment \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(attachmentModel, /checksum\s+String\?/);
  assert.match(attachmentModel, /locationId\s+String\?/);
  assert.doesNotMatch(attachmentModel, /content\s+Bytes/);
  assert.match(readFileSync('src/server/domain/tenderAttachmentService.ts', 'utf8'), /readTenderAttachmentBytes/);
});

test('verification documents round-trip through the private store', async () => {
  const previous = process.env.ATTACHMENT_STORE_DIR;
  const root = await mkdtemp(path.join(os.tmpdir(), 'tender-verification-'));
  process.env.ATTACHMENT_STORE_DIR = root;
  try {
    await putPrivateObject(verificationDocumentObjectKey('profile1', 'PUBLIC_LIABILITY_INSURANCE'), Buffer.from('%PDF-1.7'));
    const fromStore = await readVerificationDocumentBytes({ objectKey: null, content: Buffer.from('db-bytes') }, 'profile1', 'PUBLIC_LIABILITY_INSURANCE');
    assert.equal(fromStore?.toString(), '%PDF-1.7');
  } finally {
    if (previous === undefined) delete process.env.ATTACHMENT_STORE_DIR;
    else process.env.ATTACHMENT_STORE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('verification documents are stored privately and not as Postgres bytes', () => {
  const service = readFileSync('src/server/domain/verificationDocumentService.ts', 'utf8');
  const persist = readFileSync('src/server/storage/verificationDocumentStore.ts', 'utf8');
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  assert.match(service, /persistVerificationDocumentFile/);
  assert.match(service, /objectKey: persisted.objectKey/);
  assert.match(service, /readVerificationDocumentBytes/);
  assert.match(persist, /writeDurableObject|promoteTemporaryUpload/);
  assert.doesNotMatch(service, /content: Buffer/);
  const documentModel = schema.match(/model VerificationDocument \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(documentModel, /objectKey\s+String\?/);
  assert.match(documentModel, /checksum\s+String\?/);
  assert.doesNotMatch(documentModel, /content\s+Bytes/);
});

test('Render blueprint stays on free until a persistent disk is attached later', () => {
  const blueprint = readFileSync('render.yaml', 'utf8');
  assert.match(blueprint, /plan: free/);
  assert.doesNotMatch(blueprint, /^ {4}disk:/m);
  assert.doesNotMatch(blueprint, /^\s+- key: ATTACHMENT_STORE_DIR/m);
});
