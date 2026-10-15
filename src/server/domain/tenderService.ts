import { prisma } from '@/server/data/prisma';
import { Prisma } from '@prisma/client';
import { buildTenderReference } from '@/lib/identifiers';
import { recordAuditEvent } from '@/server/audit/auditLog';
import { sendTenderOpportunityEmail, sendTenderUpdatedEmail, sendTransactionalEmail } from '@/server/notifications/resend';
import { tenderFlaggedForReviewTemplate } from '@/server/notifications/emailTemplates';
import type { CreateTenderInput, UpdateTenderInput } from '@/lib/schemas/tender';
import { enforceContentModeration } from '@/server/moderation/contentModeration';
import { retailerCoversTenderLocation, formatRetailerSummaryLocation, UK_COUNTIES, UK_REGIONS } from '@/lib/geography';
import { ForbiddenError } from '@/server/auth/session';
import { flagDuplicateTenders } from '@/server/domain/complianceMonitoringService';
import { parseMatchingServiceProvisions } from '@/lib/service-provisions';
import { serialiseSpec } from '@/lib/tender-spec';
import { parseQuantity } from '@/lib/quote-pricing';
import { hashPackageSpec, issuedTenderSpecHash } from '@/lib/package-spec';
import { missingCredentials, type CredentialRecord } from '@/lib/package-credentials';
import { storageTenantIdForUser } from '@/server/domain/stagedUpload';
import { persistNewTenderAttachments } from '@/server/storage/tenderAttachmentStore';
import { OPPORTUNITY_MATCH_READ_LIMIT, openMatchedOpportunityWhere, openOpportunityTenderWhere } from '@/lib/opportunity-search';

type RetailerTenderEligibilityProfile = {
  coverageScope: string;
  counties: string;
  regions: string;
  categories: string;
  serviceProvisions?: string | null;
};

export type TenderMatchPackage = { category: string; subcategory: string; specJson?: string | null };

type CompanyMatchFields = { services: string; operatingLocations: string; serviceProvisions: string };

function quantityFields(quantity: string): { quantity: string; quantityValue: number | null; unit: string | null } {
  const parsed = parseQuantity(quantity);
  return { quantity, quantityValue: parsed?.value ?? null, unit: parsed?.unit ?? null };
}

function packagePayload(input: {
  category: string;
  subcategory: string;
  item: string | null;
  quantity: string;
  description: string;
  specJson: string;
  requirements: string;
}) {
  const qty = quantityFields(input.quantity);
  return {
    ...input,
    ...qty,
    specHash: hashPackageSpec({
      category: input.category,
      subcategory: input.subcategory,
      item: input.item,
      quantity: qty.quantity,
      quantityValue: qty.quantityValue,
      unit: qty.unit,
      description: input.description,
      specJson: input.specJson,
      requirements: input.requirements,
    }),
  };
}

export async function getTenderReviewSnapshot(tenderId: string) {
  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    include: { items: true, packages: true, attachments: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true, uploadedAt: true } } },
  });
  if (!tender) return null;
  return {
    id: tender.id,
    reference: tender.reference,
    clientId: tender.clientId,
    category: tender.category,
    subcategory: tender.subcategory,
    service: tender.service,
    item: tender.item,
    location: tender.location,
    quantity: tender.quantity,
    urgency: tender.urgency,
    closingDate: tender.closingDate,
    supplyDate: tender.supplyDate,
    requirements: tender.requirements,
    description: tender.description,
    status: tender.status,
    createdAt: tender.createdAt,
    items: tender.items,
    packages: tender.packages,
      attachments: tender.attachments.map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        uploadedAt: attachment.uploadedAt,
      })),
  };
}

async function notifyTenderOwnerOfHighRisk(tenderId: string) {
  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    select: { id: true, reference: true, clientId: true, category: true, subcategory: true, location: true, createdAt: true, client: { select: { email: true } } },
  });
  if (!tender) return;

  const since = new Date(tender.createdAt);
  since.setUTCDate(since.getUTCDate() - 7);
  const candidates = await prisma.tender.findMany({
    where: { clientId: tender.clientId, category: tender.category, subcategory: tender.subcategory, location: tender.location, createdAt: { gte: since } },
    select: { id: true, reference: true, clientId: true, category: true, subcategory: true, location: true, createdAt: true },
  });
  const isHighRisk = flagDuplicateTenders(candidates).some((flag) => flag.severity === 'HIGH' && flag.targetId === tender.id);
  if (!isHighRisk) return;

  const alreadyNotified = await prisma.auditLog.findFirst({ where: { action: 'TENDER_HIGH_RISK_NOTIFICATION_SENT', targetType: 'Tender', targetId: tender.id }, select: { id: true } });
  if (alreadyNotified) return;
  const result = await sendTransactionalEmail(tender.client.email, tenderFlaggedForReviewTemplate({ reference: tender.reference }));
  await recordAuditEvent({
    actorId: null,
    action: result.sent ? 'TENDER_HIGH_RISK_NOTIFICATION_SENT' : 'TENDER_HIGH_RISK_NOTIFICATION_FAILED',
    targetType: 'Tender',
    targetId: tender.id,
    metadata: { reason: result.sent ? undefined : result.reason },
  });
}

export async function getCompanyMemberIds(userId: string): Promise<string[]> {
  const membership = await prisma.clientCompanyMember.findUnique({ where: { userId }, select: { companyId: true } });
  if (!membership) return [userId];
  const members = await prisma.clientCompanyMember.findMany({ where: { companyId: membership.companyId }, select: { userId: true } });
  return members.map((member) => member.userId);
}

/** Returns the active tender categories a company is permitted to receive. */
export async function getUserTenderServiceCategories(userId: string): Promise<string[]> {
  const membership = await prisma.clientCompanyMember.findUnique({
    where: { userId },
    select: { company: { select: { services: true } } },
  });
  return membership?.company.services.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
}

/** Returns Service::Provision keys the company is permitted to receive. Empty means fail-closed. */
export async function getUserTenderServiceProvisions(userId: string): Promise<string[]> {
  const membership = await prisma.clientCompanyMember.findUnique({
    where: { userId },
    select: { company: { select: { services: true, serviceProvisions: true } } },
  });
  const services = membership?.company.services.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
  return parseMatchingServiceProvisions(membership?.company.serviceProvisions, services);
}

export function tenderProvisionPackageWhere(provisions: string[]): { id: { in: string[] } } | { OR: Array<{ category: string; subcategory: string }> } {
  if (provisions.length === 0) return { id: { in: [] } };
  return {
    OR: provisions.map((entry) => {
      const [category, ...provisionParts] = entry.split('::');
      return { category: category ?? '', subcategory: provisionParts.join('::') };
    }),
  };
}

/** Categories this supplier is matched to on a tender. Used for unlock fee and site-visit contact release. */
export async function retailerMatchedCategories(retailerId: string, tenderId: string): Promise<string[]> {
  const provisions = await getUserTenderServiceProvisions(retailerId);
  if (provisions.length === 0) return [];
  const provisionWhere = tenderProvisionPackageWhere(provisions);
  const [items, packages] = await Promise.all([
    prisma.tenderItem.findMany({ where: { tenderId, ...provisionWhere }, select: { category: true } }),
    prisma.tenderPackage.findMany({ where: { tenderId, ...provisionWhere }, select: { category: true } }),
  ]);
  return [...new Set((items.length > 0 ? items : packages).map((entry) => entry.category))];
}

export async function userOwnsTender(userId: string, tenderId: string): Promise<boolean> {
  const memberIds = await getCompanyMemberIds(userId);
  return Boolean(await prisma.tender.findFirst({ where: { id: tenderId, clientId: { in: memberIds } }, select: { id: true } }));
}

export function retailerCanMatchTender(
  retailer: RetailerTenderEligibilityProfile,
  tenderLocation: string,
  packages: readonly TenderMatchPackage[],
  credentials: readonly CredentialRecord[] = [],
): boolean {
  if (!retailerCoversTenderLocation(retailer, tenderLocation)) return false;
  const services = retailer.categories.split(',').map((value) => value.trim()).filter(Boolean);
  const provisions = parseMatchingServiceProvisions(retailer.serviceProvisions, services);
  if (provisions.length === 0) return false;
  if (!packages.some((pkg) => provisions.includes(`${pkg.category}::${pkg.subcategory}`))) return false;
  return missingCredentials(packages, credentials, 'match').length === 0;
}

export function getTenderMatchPackages(
  packages: readonly TenderMatchPackage[] | null | undefined,
  items: readonly TenderMatchPackage[] | null | undefined = []
): TenderMatchPackage[] {
  const source = (packages ?? []).length > 0 ? packages ?? [] : items ?? [];
  return source.map((pkg) => ({ category: pkg.category, subcategory: pkg.subcategory, specJson: pkg.specJson ?? null }));
}

function matchingItemsForRetailer<T extends TenderMatchPackage>(retailer: RetailerTenderEligibilityProfile, items: readonly T[]): T[] {
  const services = retailer.categories.split(',').map((value) => value.trim()).filter(Boolean);
  const provisions = parseMatchingServiceProvisions(retailer.serviceProvisions, services);
  return items.filter((item) => provisions.includes(`${item.category}::${item.subcategory}`));
}

function companyEligibility(profile: RetailerTenderEligibilityProfile, company: CompanyMatchFields): RetailerTenderEligibilityProfile {
  const locations = company.operatingLocations.split(',').map((value) => value.trim()).filter(Boolean);
  return {
    ...profile,
    categories: company.services,
    serviceProvisions: company.serviceProvisions,
    coverageScope: locations.includes('United Kingdom') ? 'UK' : locations.some((location) => UK_REGIONS.includes(location as typeof UK_REGIONS[number])) ? 'REGION' : 'COUNTY',
    counties: locations.filter((location) => UK_COUNTIES.includes(location as typeof UK_COUNTIES[number])).join(','),
    regions: locations.filter((location) => UK_REGIONS.includes(location as typeof UK_REGIONS[number])).join(','),
  };
}

/** Rechecks the mutable retailer capability and coverage controls before paid tender activity. */
export async function assertRetailerEligibleForTender(retailerId: string, tenderId: string): Promise<void> {
  if (await userOwnsTender(retailerId, tenderId)) {
    throw new ForbiddenError('A User cannot unlock or quote for their own tender');
  }
  const [match, profile, membership] = await Promise.all([
    prisma.tenderMatch.findUnique({
      where: { tenderId_retailerId: { tenderId, retailerId } },
      include: { tender: { select: { location: true, items: { select: { category: true, subcategory: true, specJson: true } }, packages: { select: { category: true, subcategory: true, specJson: true } } } } },
    }),
    prisma.retailerProfile.findUnique({
      where: { userId: retailerId },
      select: { coverageScope: true, counties: true, regions: true, categories: true, verificationDocuments: { select: { documentType: true, expiryDate: true, verified: true } } },
    }),
    prisma.clientCompanyMember.findUnique({ where: { userId: retailerId }, select: { company: { select: { services: true, operatingLocations: true, serviceProvisions: true } } } }),
  ]);
  const packages = getTenderMatchPackages(match?.tender.packages, match?.tender.items);
  if (!match || !profile || !membership || !retailerCanMatchTender(companyEligibility(profile, membership.company), match.tender.location, packages, profile.verificationDocuments)) {
    throw new ForbiddenError('Tender is not eligible for this Retailer');
  }
}

/** Rejects new tender activity once the tender is closed or its response deadline has passed. */
export async function assertTenderOpenForActivity(tenderId: string): Promise<void> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, status: 'OPEN', closingDate: { gt: new Date() } },
    select: { id: true },
  });
  if (!tender) throw new ForbiddenError('Tender is no longer open for new activity');
}

/** Creates a tender, assigns its reference, and matches it to eligible Retailers. Ownership is the caller's job. */
export async function createTender(clientId: string, input: CreateTenderInput) {
  await enforceContentModeration(clientId, 'TENDER_SUBMISSION', [
    { name: 'project name', value: input.projectName },
    { name: 'category', value: input.category },
    { name: 'subcategory', value: input.subcategory },
    { name: 'item', value: input.item },
    { name: 'location', value: input.location },
    { name: 'quantity', value: input.quantity },
    { name: 'item specification', value: input.itemDescription ?? '' },
    { name: 'requirements', value: input.requirements.join(', ') },
    { name: 'description', value: input.description },
    ...(input.items ?? []).flatMap((item, index) => [
      { name: `item ${index + 1} category`, value: item.category },
      { name: `item ${index + 1} subcategory`, value: item.subcategory },
      { name: `item ${index + 1} item`, value: item.item },
      { name: `item ${index + 1} description`, value: item.description },
      { name: `item ${index + 1} quantity`, value: item.quantity },
    ]),
    ...(input.attachments ?? []).map((attachment, index) => ({ name: `attachment ${index + 1} filename`, value: attachment.name })),
  ], { type: 'TENDER_SUBMISSION', ...input });
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const tendersToday = await prisma.tender.count({ where: { createdAt: { gte: startOfDay } } });
  const membership = await prisma.clientCompanyMember.findUnique({ where: { userId: clientId }, select: { companyId: true } });
  const project = membership
    ? await prisma.project.upsert({
      where: { companyId_name: { companyId: membership.companyId, name: input.projectName } },
      create: { companyId: membership.companyId, name: input.projectName, location: input.location, createdById: clientId },
      update: { location: input.location },
    })
    : null;
  const issuedAt = new Date();
  const requirementList = input.requirements.join(',');
  const primaryPayload = packagePayload({
    category: input.category,
    subcategory: input.subcategory,
    item: input.item ?? null,
    quantity: input.quantity,
    description: input.itemDescription ?? '',
    specJson: serialiseSpec(input.spec),
    requirements: requirementList,
  });
  const extraPayloads = (input.items ?? []).map((item) => packagePayload({
    category: item.category,
    subcategory: item.subcategory,
    item: item.item ?? null,
    quantity: item.quantity,
    description: item.description,
    specJson: serialiseSpec(item.spec),
    requirements: requirementList,
  }));
  const issuedHash = issuedTenderSpecHash([primaryPayload, ...extraPayloads].map((pkg) => pkg.specHash));
  const tenderData = {
      clientId,
      projectId: project?.id ?? null,
      category: input.category,
      subcategory: input.subcategory,
      service: input.category,
      item: input.item ?? null,
      location: input.location,
      quantity: input.quantity,
      urgency: input.urgency,
      closingDate: input.closingDate,
      supplyDate: input.supplyDate ?? null,
      requirements: requirementList,
      description: input.description,
      status: 'OPEN' as const,
      allowDirectContact: Boolean(input.allowDirectContact),
      allowProfessionalInterest: Boolean(input.allowProfessionalInterest),
      items: {
        create: [
          { ...quantityFields(input.quantity), category: input.category, subcategory: input.subcategory, item: input.item ?? null, description: input.itemDescription ?? '', specJson: serialiseSpec(input.spec), packageIndex: 0 },
          ...(input.items ?? []).map((item, index) => ({
            ...quantityFields(item.quantity),
            category: item.category,
            subcategory: item.subcategory,
            item: item.item ?? null,
            description: item.description,
            specJson: serialiseSpec(item.spec),
            packageIndex: index + 1,
          })),
        ],
      },
  };

  let tender;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      tender = await prisma.tender.create({
        data: { ...tenderData, reference: buildTenderReference(new Date(), tendersToday + attempt + 1) },
      });
      break;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002' || attempt === 4) throw error;
    }
  }
  if (!tender) throw new Error('Unable to allocate a unique tender reference');
  await persistNewTenderAttachments(tender.id, await storageTenantIdForUser(clientId), input.attachments ?? []);

  const packages = [
    {
      ...primaryPayload,
      service: input.category,
      location: input.location,
      urgency: input.urgency,
      closingDate: input.closingDate,
      supplyDate: input.supplyDate ?? null,
    },
    ...extraPayloads.map((payload) => ({
      ...payload,
      service: payload.category,
      location: input.location,
      urgency: input.urgency,
      closingDate: input.closingDate,
      supplyDate: input.supplyDate ?? null,
    })),
  ];

  await prisma.tenderPackage.createMany({
    data: packages.map((pkg, index) => ({
      tenderId: tender.id,
      reference: `${tender.reference}-PK${index + 1}`,
      category: pkg.category,
      subcategory: pkg.subcategory,
      service: pkg.service,
      item: pkg.item,
      location: pkg.location,
      quantity: pkg.quantity,
      urgency: pkg.urgency,
      closingDate: pkg.closingDate,
      supplyDate: pkg.supplyDate,
      requirements: pkg.requirements,
      description: pkg.description,
      specJson: pkg.specJson,
      revision: 1,
      specHash: pkg.specHash,
      issuedAt,
      packageIndex: index,
      status: 'OPEN',
    })),
  });

  await recordAuditEvent({
    actorId: clientId,
    action: 'TENDER_CREATED',
    targetType: 'Tender',
    targetId: tender.id,
    metadata: { reference: tender.reference, category: tender.category, projectId: project?.id ?? null, specHash: issuedHash },
  });

  const tenderItems = await prisma.tenderItem.findMany({ where: { tenderId: tender.id }, orderBy: { createdAt: 'asc' } });
  const services = [...new Set(tenderItems.map((item) => item.category))];
  // Write-time match: candidate companies by registered service string. Inbox reads never scan Tender.
  const candidateRetailers = await prisma.retailerProfile.findMany({
    where: { OR: services.map((service) => ({ categories: { contains: service } })) },
    include: {
      verificationDocuments: { select: { documentType: true, expiryDate: true, verified: true } },
      user: { select: { email: true, clientCompanyMembership: { select: { company: { select: { services: true, operatingLocations: true, serviceProvisions: true } } } } } },
    },
  });
  const matchPackages = getTenderMatchPackages(undefined, tenderItems);
  const matchedRetailers = candidateRetailers.filter((retailer) => retailer.userId !== clientId && retailer.user.clientCompanyMembership && retailerCanMatchTender(companyEligibility(retailer, retailer.user.clientCompanyMembership.company), tender.location, matchPackages, retailer.verificationDocuments));

  if (matchedRetailers.length > 0) {
    const uniqueRetailerIds = [...new Set(matchedRetailers.map((retailer) => retailer.userId))];
    const itemMatches = tenderItems.flatMap((item) =>
      matchedRetailers
        .filter((retailer) => retailer.user.clientCompanyMembership && matchingItemsForRetailer(companyEligibility(retailer, retailer.user.clientCompanyMembership.company), [item]).length > 0)
        .map((retailer) => ({ tenderItemId: item.id, retailerId: retailer.userId }))
    );
    await prisma.$transaction([
      prisma.tenderMatch.createMany({ data: uniqueRetailerIds.map((retailerId) => ({ tenderId: tender.id, retailerId })) }),
      ...(itemMatches.length > 0 ? [prisma.tenderItemMatch.createMany({ data: itemMatches })] : []),
    ]);
    await recordAuditEvent({
      actorId: null,
      action: 'TENDER_MATCHED',
      targetType: 'Tender',
      targetId: tender.id,
      metadata: { matchedRetailerCount: uniqueRetailerIds.length, matchedItemCount: itemMatches.length },
    });

    void notifyMatchedRetailers(tender, tenderItems, matchedRetailers);
  }

  await notifyTenderOwnerOfHighRisk(tender.id);
  return tender;
}

/** Updates a Contractor-owned tender in place, preserving its reference, matches, and unlock entitlement records. */
export async function updateTender(clientId: string, tenderId: string, input: UpdateTenderInput) {
  const companyMemberIds = await getCompanyMemberIds(clientId);
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, clientId: { in: companyMemberIds } },
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      packages: { orderBy: { createdAt: 'asc' } },
      matches: true,
    },
  });
  if (!tender) throw new ForbiddenError('Tender not found for this Contractor');
  if (tender.status !== 'OPEN') throw new ForbiddenError('Only open tenders can be edited');

  const existingItemIds = new Set(tender.items.map((item) => item.id));
  if (input.items.length !== tender.items.length || input.items.some((item) => !existingItemIds.has(item.id))) {
    throw new ForbiddenError('Tender packages cannot be added or removed after submission');
  }

  await enforceContentModeration(clientId, 'TENDER_UPDATE', [
    { name: 'location', value: input.location },
    { name: 'requirements', value: input.requirements.join(', ') },
    { name: 'description', value: input.description },
    ...input.items.flatMap((item, index) => [
      { name: `item ${index + 1} quantity`, value: item.quantity },
      { name: `item ${index + 1} description`, value: item.description },
    ]),
  ]);

  const itemsById = new Map(input.items.map((item) => [item.id, item]));
  const updatedTender = await prisma.$transaction(async (transaction) => {
    const updated = await transaction.tender.update({
      where: { id: tender.id },
      data: {
        location: input.location,
        urgency: input.urgency,
        closingDate: input.closingDate,
        supplyDate: input.supplyDate ?? null,
        requirements: input.requirements.join(','),
        description: input.description,
      },
    });

    await Promise.all(tender.items.map((item) => {
      const update = itemsById.get(item.id)!;
      const qty = quantityFields(update.quantity);
      return transaction.tenderItem.update({ where: { id: item.id }, data: { quantity: qty.quantity, quantityValue: qty.quantityValue, unit: qty.unit, description: update.description } });
    }));
    const issuedAt = new Date();
    await Promise.all(tender.packages.map((pkg, index) => {
      const item = itemsById.get(tender.items[index]?.id ?? '');
      const qty = quantityFields(item?.quantity ?? pkg.quantity);
      const payload = packagePayload({
        category: pkg.category,
        subcategory: pkg.subcategory,
        item: pkg.item,
        quantity: qty.quantity,
        description: item?.description ?? pkg.description,
        specJson: pkg.specJson,
        requirements: input.requirements.join(','),
      });
      return transaction.tenderPackage.update({
        where: { id: pkg.id },
        data: {
          location: input.location,
          urgency: input.urgency,
          closingDate: input.closingDate,
          supplyDate: input.supplyDate ?? null,
          requirements: input.requirements.join(','),
          quantity: payload.quantity,
          description: payload.description,
          revision: pkg.revision + 1,
          specHash: payload.specHash,
          issuedAt,
        },
      });
    }));
    await recordAuditEvent({
      actorId: clientId,
      action: 'TENDER_UPDATED',
      targetType: 'Tender',
      targetId: tender.id,
      metadata: { reference: tender.reference, matchedRetailerCount: tender.matches.length },
    }, transaction);
    return updated;
  });

  const matchedRetailers = await prisma.user.findMany({
    where: { id: { in: tender.matches.map((match) => match.retailerId) }, role: 'USER' },
    select: { id: true, email: true },
  });
  await Promise.allSettled(matchedRetailers.map(async (retailer) => {
    const result = await sendTenderUpdatedEmail(retailer.email, {
      id: tender.id,
      reference: tender.reference,
      category: tender.category,
      locationArea: formatRetailerSummaryLocation(input.location),
      closingDate: input.closingDate,
    });
    await recordAuditEvent({
      actorId: clientId,
      action: result.sent ? 'TENDER_UPDATE_NOTIFICATION_SENT' : 'TENDER_UPDATE_NOTIFICATION_SKIPPED',
      targetType: 'Tender',
      targetId: tender.id,
      metadata: { retailerId: retailer.id, reason: result.sent ? undefined : result.reason },
    });
  }));

  await notifyTenderOwnerOfHighRisk(updatedTender.id);
  return updatedTender;
}

/**
 * Retroactively matches a Retailer to already-open tenders that now qualify under their current
 * categories. Matching normally only runs once, at tender creation time, so this must be called
 * after a Retailer registers or changes their categories/coverage — otherwise they would never
 * see open opportunities that existed before they configured their profile. Category capability
 * and geographic coverage are both required for visibility and notification.
 */
export async function matchRetailerToOpenTenders(retailerId: string) {
  const [profile, membership] = await Promise.all([
    prisma.retailerProfile.findUnique({
      where: { userId: retailerId },
      include: { verificationDocuments: { select: { documentType: true, expiryDate: true, verified: true } } },
    }),
    prisma.clientCompanyMember.findUnique({ where: { userId: retailerId }, select: { company: { select: { services: true, operatingLocations: true, serviceProvisions: true } } } }),
  ]);
  if (!profile || !membership) return;

  const categories = membership.company.services.split(',').map((value) => value.trim()).filter(Boolean);
  if (categories.length === 0) return;

  const candidateTenders = await prisma.tender.findMany({
    where: {
      ...openOpportunityTenderWhere(),
      OR: [
        { items: { some: { category: { in: categories } } } },
        { packages: { some: { category: { in: categories } } } },
      ],
      matches: { none: { retailerId } },
    },
    include: {
      items: true,
      packages: true,
      client: { select: { clientCompanyMembership: { select: { company: { select: { tradeTenderId: true } } } } } },
    },
  });
  if (candidateTenders.length === 0) return;

  const retailer = await prisma.user.findUnique({ where: { id: retailerId }, select: { email: true } });

  for (const tender of candidateTenders) {
    if (tender.clientId === retailerId) continue;
    const eligibility = companyEligibility(profile, membership.company);
    const packages = getTenderMatchPackages(tender.packages, tender.items);
    if (!retailerCanMatchTender(eligibility, tender.location, packages, profile.verificationDocuments)) continue;
    const matchingItems = matchingItemsForRetailer(eligibility, tender.items);

    await prisma.$transaction([
      prisma.tenderMatch.create({ data: { tenderId: tender.id, retailerId } }),
      ...(matchingItems.length > 0
        ? [prisma.tenderItemMatch.createMany({ data: matchingItems.map((item) => ({ tenderItemId: item.id, retailerId })) })]
        : []),
    ]);
    await recordAuditEvent({
      actorId: retailerId,
      action: 'TENDER_MATCHED',
      targetType: 'Tender',
      targetId: tender.id,
      metadata: { matchedRetailerCount: 1, matchedItemCount: matchingItems.length, reason: 'RETROACTIVE_COVERAGE_UPDATE' },
    });

    if (!retailer?.email) continue;
    for (const item of matchingItems) {
      const result = await sendTenderOpportunityEmail(retailer.email, {
        id: tender.id,
        reference: tender.reference,
        category: `${item.category} / ${item.subcategory}`,
        locationArea: formatRetailerSummaryLocation(tender.location),
        closingDate: tender.closingDate,
        requirementSummary: [item.item, item.quantity].filter(Boolean).join(' · '),
      });
      await recordAuditEvent({
        actorId: null,
        action: result.sent ? 'TENDER_NOTIFICATION_SENT' : 'TENDER_NOTIFICATION_SKIPPED',
        targetType: 'Tender',
        targetId: tender.id,
        metadata: { retailerId, tenderItemId: item.id, reason: result.sent ? undefined : result.reason },
      });
    }
  }
}

type MatchedOpportunityRetailer = RetailerTenderEligibilityProfile & {
  userId: string;
  user: { email: string; clientCompanyMembership: { company: CompanyMatchFields } | null };
};

async function notifyMatchedRetailers(
  tender: { id: string; reference: string; location: string; closingDate: Date },
  tenderItems: Array<{ id: string; category: string; subcategory: string; item: string | null; quantity: string }>,
  matchedRetailers: MatchedOpportunityRetailer[],
) {
  const notified = new Set<string>();
  await Promise.allSettled(matchedRetailers.map(async (retailer) => {
    if (notified.has(retailer.userId) || !retailer.user.clientCompanyMembership) return;
    notified.add(retailer.userId);
    const eligibility = companyEligibility(retailer, retailer.user.clientCompanyMembership.company);
    const matchingItem = tenderItems.find((item) => matchingItemsForRetailer(eligibility, [item]).length > 0) ?? tenderItems[0];
    if (!matchingItem) return;
    const result = await sendTenderOpportunityEmail(retailer.user.email, {
      id: tender.id,
      reference: tender.reference,
      category: `${matchingItem.category} / ${matchingItem.subcategory}`,
      locationArea: formatRetailerSummaryLocation(tender.location),
      closingDate: tender.closingDate,
      requirementSummary: [matchingItem.item, matchingItem.quantity].filter(Boolean).join(' · '),
    });
    await recordAuditEvent({
      actorId: null,
      action: result.sent ? 'TENDER_NOTIFICATION_SENT' : 'TENDER_NOTIFICATION_SKIPPED',
      targetType: 'Tender',
      targetId: tender.id,
      metadata: { retailerId: retailer.userId, tenderItemId: matchingItem.id, reason: result.sent ? undefined : result.reason },
    });
  }));
}

/** Own tenders only — the repository call itself enforces ownership via the where clause. */
export function listTendersForClient(clientId: string) {
  return getCompanyMemberIds(clientId).then((memberIds) => prisma.tender.findMany({
    where: { clientId: { in: memberIds } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      reference: true,
      status: true,
      closingDate: true,
      location: true,
      category: true,
      subcategory: true,
      createdAt: true,
    },
  }));
}

export function buildRetailerTenderSummary(requirements: string | null | undefined): string[] {
  if (!requirements || requirements.trim().length === 0) return ['No specific requirements listed'];
  return ['Unlock required to view detailed requirements'];
}

/** Approved non-sensitive summary fields only (SEC-030/031) — the full free-text description
 *  remains hidden until unlock. Reads the TenderMatch index for this retailer, not Tender. */
export async function listMatchedSummariesForRetailer(retailerId: string) {
  const provisions = await getUserTenderServiceProvisions(retailerId);
  if (provisions.length === 0) return [];
  const [matches, retailer, membership] = await Promise.all([
    prisma.tenderMatch.findMany({
      where: openMatchedOpportunityWhere(retailerId),
      include: {
        tender: {
          select: {
            id: true,
            reference: true,
            category: true,
            location: true,
            urgency: true,
            closingDate: true,
            status: true,
            requirements: true,
            packages: { select: { category: true, subcategory: true, specJson: true } },
          },
        },
      },
      orderBy: { notifiedAt: 'desc' },
      take: OPPORTUNITY_MATCH_READ_LIMIT,
    }),
    prisma.retailerProfile.findUnique({
      where: { userId: retailerId },
      select: { coverageScope: true, counties: true, regions: true, verificationDocuments: { select: { documentType: true, expiryDate: true, verified: true } } },
    }),
    prisma.clientCompanyMember.findUnique({ where: { userId: retailerId }, select: { company: { select: { services: true, operatingLocations: true, serviceProvisions: true } } } }),
  ]);

  return matches.filter((match) => {
    const eligibility = membership ? companyEligibility({ ...(retailer ?? { coverageScope: '', counties: '', regions: '' }), categories: '' }, membership.company) : null;
    const packages = getTenderMatchPackages(match.tender.packages);
    return Boolean(eligibility && retailerCanMatchTender(eligibility, match.tender.location, packages, retailer?.verificationDocuments ?? []));
  }).map((match) => {
    const eligibility = membership ? companyEligibility({ ...(retailer ?? { coverageScope: '', counties: '', regions: '' }), categories: '' }, membership.company) : null;
    const visiblePackages = matchingItemsForRetailer(eligibility ?? { coverageScope: '', counties: '', regions: '', categories: '', serviceProvisions: '' }, match.tender.packages);
    const packageCategories = [...new Set(visiblePackages.map((pkg) => pkg.category))];
    return {
      id: match.id,
      notifiedAt: match.notifiedAt,
      viewedAt: match.viewedAt,
      tender: {
        id: match.tender.id,
        reference: match.tender.reference,
        category: packageCategories[0] ?? match.tender.category,
        packageCategories,
        packageCount: packageCategories.length,
        location: formatRetailerSummaryLocation(match.tender.location),
        urgency: match.tender.urgency,
        closingDate: match.tender.closingDate,
        status: match.tender.status,
        requirements: buildRetailerTenderSummary(match.tender.requirements),
        categoryMatch: true,
        locationMatch: eligibility ? retailerCoversTenderLocation(eligibility, match.tender.location) : false,
      },
    };
  });
}

export async function countUnreadMatchedOpportunities(retailerId: string): Promise<number> {
  const provisions = await getUserTenderServiceProvisions(retailerId);
  if (provisions.length === 0) return 0;
  const [matches, retailer, membership] = await Promise.all([
    prisma.tenderMatch.findMany({
      where: { ...openMatchedOpportunityWhere(retailerId), viewedAt: null },
      select: {
        tender: {
          select: {
            location: true,
            packages: { select: { category: true, subcategory: true, specJson: true } },
          },
        },
      },
      take: OPPORTUNITY_MATCH_READ_LIMIT,
    }),
    prisma.retailerProfile.findUnique({
      where: { userId: retailerId },
      select: { coverageScope: true, counties: true, regions: true, verificationDocuments: { select: { documentType: true, expiryDate: true, verified: true } } },
    }),
    prisma.clientCompanyMember.findUnique({ where: { userId: retailerId }, select: { company: { select: { services: true, operatingLocations: true, serviceProvisions: true } } } }),
  ]);
  const eligibility = membership
    ? companyEligibility({ ...(retailer ?? { coverageScope: '', counties: '', regions: '' }), categories: '' }, membership.company)
    : null;
  if (!eligibility) return 0;
  return matches.filter((match) =>
    retailerCanMatchTender(eligibility, match.tender.location, getTenderMatchPackages(match.tender.packages), retailer?.verificationDocuments ?? []),
  ).length;
}

export { formatRetailerSummaryLocation };

/** Marks a matched tender as viewed by this Retailer — drives the "New" / unread indicator. */
export async function markMatchViewed(retailerId: string, tenderId: string) {
  await prisma.tenderMatch.updateMany({
    where: { tenderId, retailerId, viewedAt: null },
    data: { viewedAt: new Date() },
  });
}
