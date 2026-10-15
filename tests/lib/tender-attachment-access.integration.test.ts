import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ForbiddenError } from '../../src/server/auth/session';
import { prisma } from '../../src/server/data/prisma';
import { getTenderAttachmentForDownload } from '../../src/server/domain/tenderAttachmentService';
import { putPrivateObject } from '../../src/server/storage/privateObjectStore';
import { getUnlockedTenderForRetailer } from '../../src/server/domain/unlockService';

test('only the owning Client or a matched unlocked Retailer can retrieve a tender attachment', async (context) => {
  const suffix = randomUUID();
  let clientId: string | undefined;
  let retailerId: string | undefined;
  let lockedRetailerId: string | undefined;
  let retailerCompanyId: string | undefined;
  let tenderId: string | undefined;

  context.after(async () => {
    if (tenderId) await prisma.unlock.deleteMany({ where: { tenderId } });
    if (tenderId) await prisma.tenderMatch.deleteMany({ where: { tenderId } });
    if (tenderId) await prisma.tender.deleteMany({ where: { id: tenderId } });
    if (retailerCompanyId) await prisma.clientCompany.deleteMany({ where: { id: retailerCompanyId } });
    const userIds = [clientId, retailerId, lockedRetailerId].filter((id): id is string => Boolean(id));
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  const [client, retailer, lockedRetailer] = await Promise.all([
    prisma.user.create({ data: { email: `attachment-client-${suffix}@example.test`, passwordHash: 'not-used', role: 'USER', contactName: 'Attachment Client' } }),
    prisma.user.create({ data: { email: `attachment-retailer-${suffix}@example.test`, passwordHash: 'not-used', role: 'USER', contactName: 'Attachment Retailer' } }),
    prisma.user.create({ data: { email: `attachment-locked-${suffix}@example.test`, passwordHash: 'not-used', role: 'USER', contactName: 'Locked Retailer' } }),
  ]);
  clientId = client.id;
  retailerId = retailer.id;
  lockedRetailerId = lockedRetailer.id;

  const retailerCompany = await prisma.clientCompany.create({
    data: {
      companyName: `Attachment Retailer ${suffix}`,
      branchIdentifier: suffix,
      primaryUserId: retailer.id,
      services: 'Materials',
      serviceProvisions: JSON.stringify(['Materials::Bricks']),
      operatingLocations: 'United Kingdom',
      members: { create: { userId: retailer.id } },
    },
  });
  retailerCompanyId = retailerCompany.id;

  const tender = await prisma.tender.create({
    data: {
      reference: `ATT-${suffix}`,
      clientId,
      category: 'Construction Materials',
      subcategory: 'Aggregate',
      location: 'Leeds',
      quantity: '20 tonnes',
      urgency: 'Standard',
      closingDate: new Date(Date.now() + 86_400_000),
      requirements: 'Delivery',
      description: 'Fictional attachment access test tender',
      attachments: { create: { fileName: 'site-plan.pdf', mimeType: 'application/pdf', sizeBytes: 4, objectKey: `tenders/${suffix}/plan` } },
    },
    include: { attachments: true },
  });
  tenderId = tender.id;
  const attachmentId = tender.attachments[0]!.id;
  await putPrivateObject(`tenders/${suffix}/plan`, Buffer.from('test'));
  await prisma.tenderMatch.createMany({ data: [{ tenderId, retailerId }, { tenderId, retailerId: lockedRetailerId }] });

  await assert.rejects(
    () => getTenderAttachmentForDownload(tenderId!, attachmentId, { id: lockedRetailerId!, role: 'USER' }),
    (error: unknown) => error instanceof ForbiddenError
  );
  await assert.rejects(
    () => getUnlockedTenderForRetailer(retailerId!, tenderId!),
    (error: unknown) => error instanceof ForbiddenError
  );

  await prisma.unlock.create({ data: { tenderId, retailerId, method: 'PAID' } });

  const unlockedTender = await getUnlockedTenderForRetailer(retailerId, tenderId);
  assert.equal(unlockedTender.attachments.length, 1);
  assert.equal(unlockedTender.attachments[0]?.id, attachmentId);
  assert.equal(unlockedTender.attachments[0]?.fileName, 'site-plan.pdf');
  assert.equal('content' in unlockedTender.attachments[0]!, false);

  const retailerAttachment = await getTenderAttachmentForDownload(tenderId, attachmentId, { id: retailerId, role: 'USER' });
  assert.equal(retailerAttachment.content.toString(), 'test');
  const clientAttachment = await getTenderAttachmentForDownload(tenderId, attachmentId, { id: clientId, role: 'USER' });
  assert.equal(clientAttachment.content.toString(), 'test');

  const auditEvents = await prisma.auditLog.findMany({ where: { targetId: attachmentId, action: 'TENDER_ATTACHMENT_DOWNLOADED' } });
  assert.equal(auditEvents.length, 2);
  assert.deepEqual(new Set(auditEvents.map((event) => event.actorId)), new Set([clientId, retailerId]));

  await prisma.tenderAttachment.delete({ where: { id: attachmentId } });
  await assert.rejects(
    () => getTenderAttachmentForDownload(tenderId, attachmentId, { id: retailerId, role: 'USER' }),
    (error: unknown) => error instanceof ForbiddenError
  );
});