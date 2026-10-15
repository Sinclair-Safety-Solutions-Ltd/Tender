import { NextResponse } from 'next/server';
import { prisma } from '@/server/data/prisma';
import { requireFullSuperUser } from '@/server/auth/session';
import { rejectCrossOrigin } from '@/server/http/origin';
import { isManagedAccountRole } from '@/lib/admin-permissions';
import { recordAuditEvent } from '@/server/audit/auditLog';
import { hashPassword } from '@/server/auth/password';
import { generateTemporaryPassword } from '@/server/auth/temporaryPassword';
import { createPasswordResetToken, PASSWORD_RESET_EXPIRY_LABEL } from '@/server/auth/passwordReset';
import { appUrl, passwordResetTemplate } from '@/server/notifications/emailTemplates';
import { sendTransactionalEmail } from '@/server/notifications/resend';
import { markUploadedDocumentsVerified } from '@/server/domain/verificationDocumentService';
import { notifyIndependentReviewDecision } from '@/server/domain/independentReviewService';
import { independentReviewTierRank } from '@/lib/independentReviewTiers';
import { defaultLaunchCreditExpiry } from '@/lib/launch-credits';

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  // Accountant sub-accounts are Super Users but must never reach account management.
  const admin = await requireFullSuperUser().catch(() => null);
  if (!admin) {
    return NextResponse.json({ error: 'Super User access required' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const action = typeof body?.action === 'string' ? body.action : null;
  if (!action) {
    return NextResponse.json({ error: 'Action is required' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: params.id } });
  if (!user) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  if (user.role === 'SUPER_USER') {
    return NextResponse.json({ error: 'Super User accounts cannot be modified through this endpoint' }, { status: 400 });
  }

  if (!isManagedAccountRole(user.role)) {
    return NextResponse.json({ error: 'This endpoint only manages Client and Retailer accounts' }, { status: 400 });
  }

  if (action === 'suspend') {
    if (!admin.isOwner) {
      return NextResponse.json({ error: 'Owner access is required to suspend an account' }, { status: 403 });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { suspended: true },
    });
    await recordAuditEvent({
      actorId: admin.id,
      action: 'USER_SUSPENDED',
      targetType: 'User',
      targetId: user.id,
      metadata: { email: user.email },
    });
    return NextResponse.json({ status: 'suspended' });
  }

  if (action === 'activate') {
    if (!admin.isOwner) {
      return NextResponse.json({ error: 'Owner access is required to reactivate an account' }, { status: 403 });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { suspended: false },
    });
    await recordAuditEvent({
      actorId: admin.id,
      action: 'USER_ACTIVATED',
      targetType: 'User',
      targetId: user.id,
      metadata: { email: user.email },
    });
    return NextResponse.json({ status: 'activated' });
  }

  if (action === 'mark-active') {
    if (user.emailVerifiedAt) {
      return NextResponse.json({ error: 'This account is already active.' }, { status: 409 });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });
    await recordAuditEvent({
      actorId: admin.id,
      action: 'USER_MARKED_ACTIVE',
      targetType: 'User',
      targetId: user.id,
      metadata: { email: user.email },
    });
    return NextResponse.json({ status: 'marked-active', emailVerifiedAt: new Date().toISOString() });
  }

  if (action === 'set-temporary-password') {
    const temporaryPassword = generateTemporaryPassword();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        sessionVersion: { increment: 1 },
      },
    });
    await recordAuditEvent({
      actorId: admin.id,
      action: 'USER_TEMPORARY_PASSWORD_SET',
      targetType: 'User',
      targetId: user.id,
      metadata: { email: user.email },
    });
    return NextResponse.json({ status: 'temporary-password-set', temporaryPassword, mustChangePassword: true });
  }

  if (action === 'reset-password') {
    const token = await createPasswordResetToken(user.id);
    const result = await sendTransactionalEmail(
      user.email,
      passwordResetTemplate({
        resetLink: appUrl(`/reset-password?token=${encodeURIComponent(token)}`),
        expiresIn: PASSWORD_RESET_EXPIRY_LABEL,
      })
    ).catch((error: unknown) => ({ sent: false as const, reason: error instanceof Error ? error.message : 'Email delivery failed' }));
    await recordAuditEvent({
      actorId: admin.id,
      action: result.sent ? 'USER_PASSWORD_RESET_LINK_SENT' : 'USER_PASSWORD_RESET_LINK_DELIVERY_FAILED',
      targetType: 'User',
      targetId: user.id,
      metadata: { email: user.email, ...(result.sent ? {} : { reason: result.reason }) },
    });
    if (!result.sent) {
      return NextResponse.json({ error: `Password reset link could not be delivered: ${result.reason}` }, { status: 502 });
    }
    return NextResponse.json({ status: 'password-reset-link-sent' });
  }

  if (action === 'set-release-credits') {
    if (user.role !== 'USER') {
      return NextResponse.json({ error: 'Release credits only apply to Client accounts' }, { status: 400 });
    }
    const releaseCreditsLeft = Number(body?.releaseCreditsLeft);
    if (!Number.isInteger(releaseCreditsLeft) || releaseCreditsLeft < 0) {
      return NextResponse.json({ error: 'releaseCreditsLeft must be a non-negative integer' }, { status: 400 });
    }

    const membership = await prisma.clientCompanyMember.findUnique({
      where: { userId: user.id },
      include: { company: { select: { id: true, releaseCreditsLeft: true } } },
    });
    if (!membership) {
      return NextResponse.json({ error: 'Client company record not found' }, { status: 404 });
    }

    await prisma.clientCompany.update({
      where: { id: membership.company.id },
      data: { releaseCreditsLeft },
    });
    await recordAuditEvent({
      actorId: admin.id,
      action: 'CLIENT_RELEASE_CREDITS_UPDATED',
      targetType: 'ClientCompany',
      targetId: membership.company.id,
      metadata: { email: user.email, previous: membership.company.releaseCreditsLeft, next: releaseCreditsLeft },
    });
    return NextResponse.json({ status: 'release-credits-updated', releaseCreditsLeft });
  }

  if (action === 'set-launch-credits') {
    if (!admin.isOwner) {
      return NextResponse.json({ error: 'Owner access is required to attest launch credits' }, { status: 403 });
    }
    if (user.role !== 'USER') {
      return NextResponse.json({ error: 'Launch credits only apply to Retailer accounts' }, { status: 400 });
    }
    const launchCreditsLeft = Number(body?.launchCreditsLeft);
    if (!Number.isInteger(launchCreditsLeft) || launchCreditsLeft < 0) {
      return NextResponse.json({ error: 'launchCreditsLeft must be a non-negative integer' }, { status: 400 });
    }
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 8) {
      return NextResponse.json({ error: 'A reason of at least 8 characters is required to attest launch credits' }, { status: 400 });
    }
    const expiresAtRaw = typeof body?.expiresAt === 'string' ? body.expiresAt : '';
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : defaultLaunchCreditExpiry();
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Launch credits need a future expiry date' }, { status: 400 });
    }
    const maxExpiry = defaultLaunchCreditExpiry();
    maxExpiry.setUTCDate(maxExpiry.getUTCDate() + 275);
    if (expiresAt.getTime() > maxExpiry.getTime()) {
      return NextResponse.json({ error: 'Launch credit expiry cannot exceed one year' }, { status: 400 });
    }

    const profile = await prisma.retailerProfile.findUnique({ where: { userId: user.id }, select: { launchCreditsLeft: true } });
    if (!profile) {
      return NextResponse.json({ error: 'Retailer profile not found' }, { status: 404 });
    }

    await prisma.retailerProfile.update({
      where: { userId: user.id },
      data: { launchCreditsLeft, launchCreditsExpireAt: expiresAt, launchCreditsReason: reason.slice(0, 240) },
    });
    await recordAuditEvent({
      actorId: admin.id,
      action: 'RETAILER_LAUNCH_CREDITS_UPDATED',
      targetType: 'User',
      targetId: user.id,
      metadata: { email: user.email, previous: profile.launchCreditsLeft, next: launchCreditsLeft, reason, expiresAt: expiresAt.toISOString() },
    });
    return NextResponse.json({ status: 'launch-credits-updated', launchCreditsLeft, launchCreditsExpireAt: expiresAt, launchCreditsReason: reason });
  }

  if (action === 'approve-verification' || action === 'reject-verification') {
    if (user.role !== 'USER') {
      return NextResponse.json({ error: 'Verification only applies to Provider accounts' }, { status: 400 });
    }
    const profile = await prisma.retailerProfile.findUnique({ where: { userId: user.id }, select: { id: true, categories: true, verificationStatus: true, isSoleTrader: true } });
    if (!profile) {
      return NextResponse.json({ error: 'Retailer profile not found' }, { status: 404 });
    }
    if (profile.verificationStatus !== 'PENDING') {
      return NextResponse.json({ error: 'Only a pending verification request can be decided' }, { status: 409 });
    }
    const nextStatus = action === 'approve-verification' ? 'VERIFIED' : 'REJECTED';
    const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : null;
    await prisma.retailerProfile.update({
      where: { userId: user.id },
      data: { verificationStatus: nextStatus, verificationDecidedAt: new Date(), verificationNote: note },
    });
    await markUploadedDocumentsVerified(profile.id, profile.categories, action === 'approve-verification', profile.isSoleTrader);
    await recordAuditEvent({
      actorId: admin.id,
      action: action === 'approve-verification' ? 'PROVIDER_VERIFICATION_APPROVED' : 'PROVIDER_VERIFICATION_REJECTED',
      targetType: 'User',
      targetId: user.id,
      metadata: { email: user.email, note: note ?? undefined },
    });
    return NextResponse.json({ status: 'verification-decided', verificationStatus: nextStatus });
  }

  if (action === 'approve-independent-review' || action === 'decline-independent-review') {
    if (user.role !== 'USER') {
      return NextResponse.json({ error: 'Independent review only applies to Provider accounts' }, { status: 400 });
    }
    const profile = await prisma.retailerProfile.findUnique({ where: { userId: user.id }, select: { id: true, independentReviewStatus: true, independentReviewPurchasedTier: true, independentReviewPurchasedPaymentId: true } });
    if (!profile) {
      return NextResponse.json({ error: 'Retailer profile not found' }, { status: 404 });
    }
    if (profile.independentReviewStatus !== 'PURCHASED') {
      return NextResponse.json({ error: 'Only a purchased independent review can be decided' }, { status: 409 });
    }
    const nextStatus = action === 'approve-independent-review' ? 'APPROVED' : 'DECLINED';
    const tier = body?.tier === 'BRONZE' || body?.tier === 'SILVER' || body?.tier === 'GOLD' ? body.tier : null;
    if (action === 'approve-independent-review' && !tier) return NextResponse.json({ error: 'A Bronze, Silver, or Gold tier is required when approving an independent review' }, { status: 400 });
    const purchasedTier = profile.independentReviewPurchasedTier;
    if (action === 'approve-independent-review' && !purchasedTier) {
      return NextResponse.json({ error: 'Purchased verification tier is missing for this account' }, { status: 400 });
    }
    if (action === 'approve-independent-review' && purchasedTier && independentReviewTierRank(tier) > independentReviewTierRank(purchasedTier)) {
      return NextResponse.json({ error: 'Awarded tier cannot exceed the purchased verification product' }, { status: 400 });
    }
    const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : null;
    await prisma.retailerProfile.update({
      where: { userId: user.id },
      data: { independentReviewStatus: nextStatus, independentReviewTier: nextStatus === 'APPROVED' ? tier : null, independentReviewDecidedAt: new Date(), independentReviewNote: note },
    });
    await recordAuditEvent({
      actorId: admin.id,
      action: action === 'approve-independent-review' ? 'INDEPENDENT_REVIEW_APPROVED' : 'INDEPENDENT_REVIEW_DECLINED',
      targetType: 'User',
      targetId: user.id,
      metadata: { email: user.email, note: note ?? undefined, source: 'SUPER_USER' },
    });
    await notifyIndependentReviewDecision(user.email, { approved: nextStatus === 'APPROVED', tier });
    return NextResponse.json({ status: 'independent-review-decided', independentReviewStatus: nextStatus, independentReviewTier: tier });
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const admin = await requireFullSuperUser().catch(() => null);
  if (!admin) {
    return NextResponse.json({ error: 'Super User access required' }, { status: 403 });
  }

  const user = await prisma.user.findUnique({
    where: { id: params.id },
    include: {
      primaryClientCompany: { select: { id: true, _count: { select: { members: true } } } },
      _count: {
        select: {
          tenders: true,
          quotes: true,
          unlocks: true,
          payments: true,
          itemMatches: true,
          sentTenderMessages: true,
          retailerMessages: true,
          clientMessages: true,
          moderationEvents: true,
          reviewedModerationEvents: true,
        },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }
  if (!isManagedAccountRole(user.role)) {
    return NextResponse.json({ error: 'Only Client and Retailer accounts can be deleted through this endpoint' }, { status: 400 });
  }

  const hasRetainedActivity = Object.values(user._count).some((count) => count > 0);
  if (hasRetainedActivity || (user.primaryClientCompany?._count.members ?? 0) > 1) {
    return NextResponse.json({
      error: 'This account has retained tender, quote, payment, communication, moderation, or shared company records and cannot be deleted.',
    }, { status: 409 });
  }

  const storedFiles = await prisma.verificationDocument.findMany({
    where: { retailerProfile: { userId: user.id } },
    select: { objectKey: true, locationId: true, storedObjectId: true },
  });

  await prisma.$transaction(async (transaction) => {
    if (user.primaryClientCompany) {
      await transaction.clientCompany.delete({ where: { id: user.primaryClientCompany.id } });
    } else {
      await transaction.clientCompanyMember.deleteMany({ where: { userId: user.id } });
    }
    await transaction.retailerTeamMember.deleteMany({ where: { userId: user.id } });
    await transaction.retailerProfile.deleteMany({ where: { userId: user.id } });
    await transaction.user.delete({ where: { id: user.id } });
    await transaction.auditLog.create({
      data: {
        actorId: admin.id,
        action: 'USER_DELETED',
        targetType: 'User',
        targetId: user.id,
        metadata: JSON.stringify({ email: user.email, role: user.role }),
      },
    });
  });

  const { deleteStoredObjectRefs } = await import('@/server/storage/objectLifecycle');
  await deleteStoredObjectRefs(storedFiles);

  return NextResponse.json({ status: 'deleted' });
}
