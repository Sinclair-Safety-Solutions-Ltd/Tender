import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../../src/server/data/prisma';
import { createLegalHold, releaseLegalHold } from '../../src/server/domain/legalHoldService';
import { purgeExpiredUnpurchasedQuotes } from '../../src/server/domain/retentionService';

test('active legal holds exclude expired quotes and tender attachments until released', async (context) => {
  const suffix = randomUUID();
  let adminId: string | undefined;
  let clientId: string | undefined;
  let retailerId: string | undefined;
  let tenderId: string | undefined;
  let quoteId: string | undefined;
  let attachmentId: string | undefined;

  context.after(async () => {
    if (tenderId) await prisma.legalHold.deleteMany({ where: { targetId: { in: [tenderId, quoteId, attachmentId].filter((id): id is string => Boolean(id)) } } });
    if (tenderId) await prisma.tenderAttachment.deleteMany({ where: { tenderId } });
    if (tenderId) await prisma.quote.deleteMany({ where: { tenderId } });
    if (tenderId) await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, clientId, retailerId].filter((id): id is string => Boolean(id)) } } });
  });

  const [admin, client, retailer] = await Promise.all([
    prisma.user.create({ data: { email: `hold-admin-${suffix}@example.test`, passwordHash: 'not-used', role: 'SUPER_USER', contactName: 'Hold Admin' } }),
    prisma.user.create({ data: { email: `hold-client-${suffix}@example.test`, passwordHash: 'not-used', role: 'USER', contactName: 'Hold Client' } }),
    prisma.user.create({ data: { email: `hold-retailer-${suffix}@example.test`, passwordHash: 'not-used', role: 'USER', contactName: 'Hold Retailer' } }),
  ]);
  adminId = admin.id;
  clientId = client.id;
  retailerId = retailer.id;

  const tender = await prisma.tender.create({
    data: { reference: `HOLD-${suffix}`, clientId, category: 'Materials', subcategory: 'Aggregate', location: 'Leeds', quantity: '20 tonnes', urgency: 'Standard', status: 'CLOSED', closingDate: new Date('2026-01-02T00:00:00.000Z'), requirements: 'Delivery', description: 'Fictional legal hold test tender' },
  });
  tenderId = tender.id;
  const [quote, attachment] = await Promise.all([
    prisma.quote.create({ data: { reference: `HOLD-${suffix}-Q01`, tenderId, retailerId, priceGbp: 1000, leadTimeDays: 2, deliveryInfo: 'Fictional test delivery', validityDays: 14, submittedAt: new Date('2026-01-01T00:00:00.000Z') } }),
    prisma.tenderAttachment.create({ data: { tenderId, fileName: 'hold-test.pdf', mimeType: 'application/pdf', sizeBytes: 5, uploadedAt: new Date('2026-01-01T00:00:00.000Z') } }),
  ]);
  quoteId = quote.id;
  attachmentId = attachment.id;

  const tenderHold = await createLegalHold(admin.id, { scope: 'TENDER', targetId: tender.id, reason: 'Legal investigation requires retention.' });
  assert.equal((await purgeExpiredUnpurchasedQuotes(new Date('2026-03-01T00:00:00.000Z'))).quotesDeleted, 0);
  assert.equal(await prisma.tenderAttachment.count({ where: { id: attachment.id } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { action: 'LEGAL_HOLD_CREATED', targetId: tender.id } }), 1);

  await releaseLegalHold(admin.id, tenderHold.id, 'Investigation concluded and retention may resume.');
  const deleted = await purgeExpiredUnpurchasedQuotes(new Date('2026-03-01T00:00:00.000Z'));
  assert.equal(deleted.quotesDeleted, 1);
  assert.equal(deleted.documentsDeleted, 1);
  assert.equal(typeof deleted.emailVerificationTokensDeleted, 'number');
  assert.equal(typeof deleted.passwordResetTokensDeleted, 'number');
  assert.equal(typeof deleted.pageViewsDeleted, 'number');
  assert.equal(await prisma.auditLog.count({ where: { action: 'LEGAL_HOLD_RELEASED', targetId: tender.id } }), 1);
});