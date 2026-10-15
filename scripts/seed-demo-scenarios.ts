import { PrismaClient, Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { buildClientTradeTenderId, buildQuoteReference } from '../src/lib/identifiers';
import { createTender } from '../src/server/domain/tenderService';
import { coverageFieldsFromOperatingLocations, normaliseOperatingLocations } from '../src/lib/geography';
import { splitContactName } from '../src/lib/person-name';
import { issuedTenderSpecHash } from '../src/lib/package-spec';

const prisma = new PrismaClient();
const DEFAULT_PASSWORD = 'TradeTenderDev!2026';

function sandboxPassword(): string {
  return process.env.SANDBOX_USER_PASSWORD?.trim() || DEFAULT_PASSWORD;
}

async function ensureClient() {
  const passwordHash = await hash(sandboxPassword(), 12);
  const names = splitContactName('Demo Client');
  const client = await prisma.user.upsert({
    where: { email: 'client@example.test' },
    update: {
      passwordHash,
      role: Role.USER,
      firstName: names.firstName,
      lastName: names.lastName,
      contactName: `${names.firstName} ${names.lastName}`,
      contactPhone: '07123456789',
      emailVerifiedAt: new Date(),
      termsAcceptedAt: new Date(),
    },
    create: {
      email: 'client@example.test',
      passwordHash,
      role: Role.USER,
      firstName: names.firstName,
      lastName: names.lastName,
      contactName: `${names.firstName} ${names.lastName}`,
      contactPhone: '07123456789',
      emailVerifiedAt: new Date(),
      termsAcceptedAt: new Date(),
    },
  });

  const coverage = coverageFieldsFromOperatingLocations(normaliseOperatingLocations(['Birmingham', 'Cardiff', 'Manchester', 'Liverpool']));
  const company = await prisma.clientCompany.upsert({
    where: { primaryUserId: client.id },
    update: { companyName: 'Demo Construction Client Ltd', services: 'Materials,Waste,Plant Hire', operatingLocations: coverage.operatingLocations },
    create: { companyName: 'Demo Construction Client Ltd', primaryUserId: client.id, services: 'Materials,Waste,Plant Hire', operatingLocations: coverage.operatingLocations, tradeTenderId: buildClientTradeTenderId() },
  });
  await prisma.clientCompanyMember.upsert({
    where: { companyId_userId: { companyId: company.id, userId: client.id } },
    update: {},
    create: { companyId: company.id, userId: client.id },
  });

  return client;
}

async function ensureRetailerScenario(input: {
  email: string;
  companyName: string;
  services: string;
  operatingLocations: string;
  verificationStatus?: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';
  independentReviewStatus?: 'NOT_PURCHASED' | 'PURCHASED' | 'APPROVED' | 'DECLINED';
  independentReviewTier?: 'BRONZE' | 'SILVER' | 'GOLD' | null;
}) {
  const passwordHash = await hash(sandboxPassword(), 12);
  const names = splitContactName(input.companyName, input.companyName);
  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: {
      passwordHash,
      role: Role.USER,
      firstName: names.firstName,
      lastName: names.lastName,
      contactName: `${names.firstName} ${names.lastName}`,
      contactPhone: '07000000000',
      emailVerifiedAt: new Date(),
      termsAcceptedAt: new Date(),
    },
    create: {
      email: input.email,
      passwordHash,
      role: Role.USER,
      firstName: names.firstName,
      lastName: names.lastName,
      contactName: `${names.firstName} ${names.lastName}`,
      contactPhone: '07000000000',
      emailVerifiedAt: new Date(),
      termsAcceptedAt: new Date(),
    },
  });

  const coverage = coverageFieldsFromOperatingLocations(normaliseOperatingLocations(input.operatingLocations.split(',')));
  const company = await prisma.clientCompany.upsert({
    where: { primaryUserId: user.id },
    update: { companyName: input.companyName, services: input.services, operatingLocations: coverage.operatingLocations },
    create: { companyName: input.companyName, primaryUserId: user.id, services: input.services, operatingLocations: coverage.operatingLocations, tradeTenderId: buildClientTradeTenderId() },
  });

  await prisma.clientCompanyMember.upsert({
    where: { companyId_userId: { companyId: company.id, userId: user.id } },
    update: {},
    create: { companyId: company.id, userId: user.id },
  });

  await prisma.retailerProfile.upsert({
    where: { userId: user.id },
    update: {
      companyName: input.companyName,
      categories: input.services,
      coverageAreas: input.operatingLocations,
      coverageScope: coverage.coverageScope,
      counties: coverage.counties,
      regions: coverage.regions,
      verificationStatus: input.verificationStatus ?? 'UNVERIFIED',
      independentReviewStatus: input.independentReviewStatus ?? 'NOT_PURCHASED',
      independentReviewTier: input.independentReviewTier ?? null,
    },
    create: {
      userId: user.id,
      masterUserId: user.id,
      companyName: input.companyName,
      categories: input.services,
      coverageAreas: input.operatingLocations,
      coverageScope: coverage.coverageScope,
      counties: coverage.counties,
      regions: coverage.regions,
      verificationStatus: input.verificationStatus ?? 'UNVERIFIED',
      independentReviewStatus: input.independentReviewStatus ?? 'NOT_PURCHASED',
      independentReviewTier: input.independentReviewTier ?? null,
    },
  });

  return user;
}

async function addDemoVerificationDocument(profileId: string, documentType: 'PUBLIC_LIABILITY_INSURANCE' | 'CERTIFICATE_OF_INCORPORATION' | 'EMPLOYERS_LIABILITY_INSURANCE' | 'SSIP_ACCREDITATION', expiryDays: number, verified = true) {
  const expiryDate = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
  const bytes = Buffer.from('%PDF-1.7\ndemo-document-content');
  const { persistVerificationDocumentFile } = await import('../src/server/storage/verificationDocumentStore');
  const stored = await persistVerificationDocumentFile(profileId, documentType, bytes, {
    fileName: `${documentType.toLowerCase()}.pdf`,
    mimeType: 'application/pdf',
  });
  await prisma.verificationDocument.upsert({
    where: { retailerProfileId_documentType: { retailerProfileId: profileId, documentType } },
    update: {
      fileName: `${documentType.toLowerCase()}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: stored.sizeBytes,
      objectKey: stored.objectKey,
      checksum: stored.checksum,
      locationId: stored.locationId,
      tenantId: profileId,
      storedObjectId: stored.storedObjectId,
      expiryDate,
      aiConfidencePercent: 96,
      aiSummary: 'Demo assessment accepted for scenario seed.',
      aiRequiresHumanReview: false,
      aiAssessedAt: new Date(),
      verified,
    },
    create: {
      retailerProfileId: profileId,
      documentType,
      fileName: `${documentType.toLowerCase()}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: stored.sizeBytes,
      objectKey: stored.objectKey,
      checksum: stored.checksum,
      locationId: stored.locationId,
      tenantId: profileId,
      storedObjectId: stored.storedObjectId,
      expiryDate,
      aiConfidencePercent: 96,
      aiSummary: 'Demo assessment accepted for scenario seed.',
      aiRequiresHumanReview: false,
      aiAssessedAt: new Date(),
      verified,
    },
  });
}

async function createQuoteRecord({ tenderId, retailerId, priceGbp, status, declarationAccepted }: { tenderId: string; retailerId: string; priceGbp: number; status: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED'; declarationAccepted?: boolean; }) {
  const tender = await prisma.tender.findUnique({ where: { id: tenderId }, include: { items: true } });
  if (!tender) throw new Error(`Tender ${tenderId} not found`);
  const reference = buildQuoteReference(tender.reference, (await prisma.quote.count({ where: { tenderId } })) + 1);

  const quote = await prisma.quote.create({
    data: {
      tenderId,
      retailerId,
      reference,
      priceGbp,
      leadTimeDays: 7,
      deliveryDateConfirmed: true,
      deliveryInfo: 'Demonstration quote created for scenario testing.',
      validityDays: 30,
      status,
      verificationDeclarationAcceptedAt: declarationAccepted ? new Date() : null,
      lines: { create: tender.items.map((item, index) => ({
        tenderItemId: item.id,
        priceGbp: priceGbp + (index * 100),
        available: true,
      })) },
      charges: { create: [{ description: 'Delivery and offloading', priceGbp: 180 }] },
    },
  });

  if (status === 'ACCEPTED') {
    await prisma.quote.update({ where: { id: quote.id }, data: { retentionLockedUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) } });
    const packages = await prisma.tenderPackage.findMany({ where: { tenderId }, select: { specHash: true } });
    await prisma.award.upsert({
      where: { quoteId: quote.id },
      create: {
        projectId: tender.projectId,
        tenderId,
        quoteId: quote.id,
        packageSpecHash: issuedTenderSpecHash(packages.map((pkg) => pkg.specHash).filter(Boolean)),
        awardedById: tender.clientId,
        purchaseOrderNumber: 'LEGACY',
      },
      update: {},
    });
  }

  await prisma.unlock.upsert({
    where: { tenderId_retailerId: { tenderId, retailerId } },
    update: {},
    create: { tenderId, retailerId, method: 'WAIVED' },
  });

  return quote;
}

async function main() {
  const client = await ensureClient();

  const scenarioRetailers = [
    { email: 'demo-unverified@example.test', companyName: 'Northline Materials Ltd', services: 'Materials', operatingLocations: 'Birmingham', verificationStatus: 'UNVERIFIED' as const },
    { email: 'demo-verified-ai@example.test', companyName: 'Ridgeway Brickworks Ltd', services: 'Materials', operatingLocations: 'Birmingham', verificationStatus: 'VERIFIED' as const },
    { email: 'demo-pending@example.test', companyName: 'Stoke Stone Merchants', services: 'Materials', operatingLocations: 'Birmingham', verificationStatus: 'PENDING' as const },
    { email: 'demo-expired@example.test', companyName: 'Midland Supply Group', services: 'Materials', operatingLocations: 'Birmingham', verificationStatus: 'EXPIRED' as const },
    { email: 'demo-independent@example.test', companyName: 'Civil Safety Plus Ltd', services: 'Waste', operatingLocations: 'Cardiff', verificationStatus: 'VERIFIED' as const, independentReviewStatus: 'APPROVED' as const, independentReviewTier: 'GOLD' as const },
    { email: 'demo-rejected@example.test', companyName: 'Urban Egress Waste', services: 'Waste', operatingLocations: 'Cardiff', verificationStatus: 'REJECTED' as const },
    { email: 'demo-unmatched@example.test', companyName: 'Southport Plant Centre', services: 'Plant Hire', operatingLocations: 'Liverpool', verificationStatus: 'UNVERIFIED' as const },
  ];

  for (const retailer of scenarioRetailers) {
    const user = await ensureRetailerScenario(retailer);
    const profile = await prisma.retailerProfile.findUnique({ where: { userId: user.id }, select: { id: true, verificationStatus: true } });
    if (!profile) continue;

    if (retailer.verificationStatus === 'VERIFIED' || retailer.verificationStatus === 'PENDING' || retailer.verificationStatus === 'REJECTED' || retailer.verificationStatus === 'EXPIRED') {
      await addDemoVerificationDocument(profile.id, 'PUBLIC_LIABILITY_INSURANCE', retailer.verificationStatus === 'EXPIRED' ? -7 : 365, retailer.verificationStatus === 'VERIFIED');
      if (retailer.verificationStatus === 'VERIFIED') {
        await prisma.retailerProfile.update({ where: { id: profile.id }, data: { verificationStatus: 'VERIFIED', verificationNote: 'Automated assessment accepted for demo scenario.' } });
      }
      if (retailer.verificationStatus === 'PENDING') {
        await prisma.retailerProfile.update({ where: { id: profile.id }, data: { verificationStatus: 'PENDING', verificationRequestedAt: new Date() } });
      }
      if (retailer.verificationStatus === 'REJECTED') {
        await prisma.retailerProfile.update({ where: { id: profile.id }, data: { verificationStatus: 'REJECTED', verificationNote: 'Document quality failed the demo review.' } });
      }
      if (retailer.verificationStatus === 'EXPIRED') {
        await prisma.retailerProfile.update({ where: { id: profile.id }, data: { verificationStatus: 'EXPIRED', verificationNote: 'Insurance expired for demo scenario.' } });
      }
    }

    if (retailer.independentReviewStatus === 'APPROVED') {
      await prisma.retailerProfile.update({ where: { id: profile.id }, data: { independentReviewStatus: 'APPROVED', independentReviewTier: 'GOLD', independentReviewPurchasedAt: new Date(), independentReviewDecidedAt: new Date() } });
    }
  }

  const materialTender = await createTender(client.id, {
    projectName: 'Birmingham facing brick package',
    category: 'Materials',
    subcategory: 'Bricks',
    item: 'Facing bricks',
    location: 'Birmingham B1 1AA',
    quantity: '120 pallets',
    urgency: 'urgent',
    closingDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
    requirements: ['Delivery to site required', 'Offloading required'],
    description: 'Need facing bricks for a city-centre residential façade build. We need a fast response and confirmation of lead times.',
  });

  const wasteTender = await createTender(client.id, {
    projectName: 'Cardiff waste skip exchange',
    category: 'Waste',
    subcategory: 'Mixed construction and demolition waste',
    item: 'Non-hazardous mixed skips from general site clearance',
    location: 'Cardiff CF10 1EP',
    quantity: '4 skips',
    urgency: 'standard',
    closingDate: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000),
    requirements: ['Collection or uplift required', 'Waste transfer note required'],
    description: 'We require mixed demolition material removed and disposed of in line with the site waste policy. Recycling and segregation should be described in the quote.',
  });

  const unmatchedTender = await createTender(client.id, {
    projectName: 'Liverpool plant package',
    category: 'Plant Hire',
    subcategory: 'Excavators',
    item: 'Mini excavators approx. 1.5-3 tonnes',
    location: 'Liverpool L1 8JQ',
    quantity: '2 machines',
    urgency: 'flexible',
    closingDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
    requirements: ['Driver or operator required', 'Site induction required'],
    description: 'We need a compact excavation package for a confined city site.',
  });

  const materialTenderMatchIds = await prisma.tenderMatch.findMany({ where: { tenderId: materialTender.id }, select: { retailerId: true } });
  const wasteTenderMatchIds = await prisma.tenderMatch.findMany({ where: { tenderId: wasteTender.id }, select: { retailerId: true } });

  const verifiedUser = await prisma.user.findUnique({ where: { email: 'demo-verified-ai@example.test' } });
  const unverifiedUser = await prisma.user.findUnique({ where: { email: 'demo-unverified@example.test' } });
  const pendingUser = await prisma.user.findUnique({ where: { email: 'demo-pending@example.test' } });
  const independentUser = await prisma.user.findUnique({ where: { email: 'demo-independent@example.test' } });
  const rejectedUser = await prisma.user.findUnique({ where: { email: 'demo-rejected@example.test' } });

  const matchedQuoteTargets = [
    { tenderId: materialTender.id, retailerId: verifiedUser!.id, priceGbp: 1925, status: 'ACCEPTED' as const, declarationAccepted: true },
    { tenderId: materialTender.id, retailerId: unverifiedUser!.id, priceGbp: 2050, status: 'SUBMITTED' as const },
    { tenderId: materialTender.id, retailerId: pendingUser!.id, priceGbp: 2140, status: 'SUBMITTED' as const },
    { tenderId: wasteTender.id, retailerId: independentUser!.id, priceGbp: 3650, status: 'ACCEPTED' as const, declarationAccepted: true },
    { tenderId: wasteTender.id, retailerId: rejectedUser!.id, priceGbp: 3920, status: 'REJECTED' as const },
  ];

  for (const target of matchedQuoteTargets) {
    await createQuoteRecord(target);
  }

  const matchLog = [
    `Materials tender ${materialTender.reference}: ${materialTenderMatchIds.length} matches (${materialTenderMatchIds.map((m) => m.retailerId).join(', ') || 'none'})`,
    `Waste tender ${wasteTender.reference}: ${wasteTenderMatchIds.length} matches (${wasteTenderMatchIds.map((m) => m.retailerId).join(', ') || 'none'})`,
    `Unmatched plant tender ${unmatchedTender.reference}: ${await prisma.tenderMatch.count({ where: { tenderId: unmatchedTender.id } })} matches`,
  ];

  console.log('Demo scenario seed created successfully.');
  console.log('Example accounts use SANDBOX_USER_PASSWORD (or the local seed default).');
  console.log('- client@example.test');
  console.log('- demo-verified-ai@example.test');
  console.log('- demo-unverified@example.test');
  console.log('- demo-pending@example.test');
  console.log('- demo-independent@example.test');
  console.log('- demo-rejected@example.test');
  console.log('');
  for (const line of matchLog) console.log(line);
  console.log('');
  console.log('Scenarios covered: verified provider, automated verification with declaration, pending review, expired verification, independent review badge, rejected quote, and unmatched tender.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
