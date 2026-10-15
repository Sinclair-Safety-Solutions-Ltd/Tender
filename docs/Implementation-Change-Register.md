### 2026-10-02 - Close required biometric opt-out and store-skill defects

- Changed: eligible devices cannot skip enrolment or turn biometric login off while `MOBILE_BIOMETRIC_LOGIN_POLICY` is `required`; the disable API now fail-closes instead of clearing the vault after a 403. Sign-out still revokes the device. App icons no longer include a grey preview frame. EAS store-skill examples pass `build_id` and put `metadataPath` on the iOS submit profile.
- Affects: `src/server/auth/mobileDevice.ts`, `mobile/src/api/auth.ts`, `mobile/src/api/client.ts`, `mobile/src/screens/BiometricEnrolment.tsx`, `mobile/src/screens/BiometricSettings.tsx`, `mobile/App.tsx`, `mobile/assets/icon.png`, `.agents/skills/eas-app-stores/references/workflows.md`.
- Environment: no schema or secret change. Default policy stays `optional`.
- Validation: `npx tsx --test tests/lib/mobile-biometric-auth.test.ts` and `npm test` in `mobile/`.

### 2026-10-01 - Unblock registration when verification email cannot send

- Changed: registration records why verification email failed, uses the request host for the verify link, and in local development marks the account verified when Resend is not configured so sign-in can continue. Production still fail-closes until `RESEND_API_KEY` and a verified `EMAIL_FROM` are set.
- Affects: `src/app/api/auth/register/route.ts`, `src/server/notifications/resend.ts`, `src/server/config/appUrl.ts`, `src/app/register/RegisterForm.tsx`, `mobile/src/screens/AuthFlow.tsx`.
- Environment: production/staging still need a verified Resend domain. Local `.env` currently has no usable Resend key.
- Validation: `npx tsx --test tests/lib/emailService.test.ts tests/lib/registration-service-provisions.test.ts tests/lib/appUrl.test.ts`.

### 2026-10-01 - Patch Next.js RCE and high-severity npm audit findings

- Changed: upgraded Next.js and `eslint-config-next` to 16.3.8 (fixes critical `next/og` ImageResponse RCE). Overrode `brace-expansion` 1.x/5.x and `fast-uri` 3.x so the remaining high-severity transitive DoS and URI-injection advisories are patched without a Prisma major bump.
- Affects: `package.json`, `package-lock.json`.
- Environment: no secret or schema change. Redeploy so production runs 16.3.8.
- Validation: `npm audit --audit-level=high` reports 0 vulnerabilities.

### 2026-10-01 - Keep Owner redirects on the current public host

- Changed: Owner console, login workspace routing, and other in-app auth redirects now use a root-relative Location instead of `NEXTAUTH_URL`. Changing the Render URL or adding a custom domain no longer bounces the Owner page to the previous hostname. Marketing CTA defaults follow the request host when that origin is allowed.
- Affects: `src/server/http/inAppRedirect.ts`, `src/proxy.ts`, `src/app/api/auth/workspace/route.ts`, `src/app/api/auth/verify-email/route.ts`, `src/app/super-user/owner/page.tsx`, `src/server/config/appUrl.ts`.
- Environment: set production `NEXTAUTH_URL` to the live public origin. If the onrender host and a custom domain both serve the app, list the extra origin in `ADDITIONAL_ALLOWED_ORIGINS`. Email and Stripe links still use `NEXTAUTH_URL`.
- Validation: `npx tsx --test tests/lib/appUrl.test.ts tests/lib/privileged-mfa.test.ts tests/lib/origin.test.ts`.

### 2026-09-30 - Close biometric session-boundary gaps

- Changed: mobile step-up is cleared on password sign-in, sign-out, biometric lock/unlock, and inactivity re-lock. Refresh writes the rotated token to the biometric vault before saving the access session and revokes the new token if that write fails. Refresh and device listing now enforce `MOBILE_DEVICE_MAX_AGE_DAYS` from registration time so sliding `expiresAt` cannot keep a device alive past the cap.
- Affects: `src/server/auth/mobileDevice.ts`, `mobile/src/auth/stepUp.ts`, `mobile/src/api/sessionRefresh.ts`, `mobile/src/api/auth.ts`, `mobile/src/api/client.ts`, `mobile/App.tsx`, `docs/Mobile-Biometric-Authentication.md`.
- Environment: no schema or secret change.
- Validation: `npx tsx --test tests/lib/mobile-biometric-auth.test.ts` and `npm test` in `mobile/`.

### 2026-09-30 - Optional device biometric login for the native app

- Changed: Buyer/Supplier mobile login can optionally use Face ID, Touch ID, fingerprint, or the device passcode on that device only. The OS verifies presence; a hashed, rotated refresh token is stored in Keychain/Keystore behind biometric access. The server still issues the existing access JWT and still decides whether the account, role, and session are valid. Password login, USER-only mobile access, payment, unlock, and contact-release controls are unchanged. Sign-out revokes that device.
- Affects: `prisma/schema.prisma`, `prisma/migrations/20260930070000_add_mobile_devices/migration.sql`, `src/server/auth/mobileDevice.ts`, `src/server/auth/mobileAuthPolicy.ts`, `src/app/api/mobile/auth/*`, `mobile/src/auth/*`, `mobile/src/screens/Biometric*.tsx`, `mobile/app.json`, `docs/Mobile-Biometric-Authentication.md`.
- Environment: additive `MobileDevice` table. No new app secrets. Rebuild the native binary so Face ID usage strings are included.
- Validation: `npx tsx --test tests/lib/mobile-biometric-auth.test.ts tests/lib/mobile-token.test.ts` and `npm test` in `mobile/`. Physical-device biometric checks remain before store submit.

### 2026-09-27 - Year 1 store fees stay on Stripe Checkout

- Changed: recorded the founder decision that tender unlock and contact-release fees stay on Stripe Checkout for the native app. Year 1 will not add App Store or Google Play Billing in-app products for those fees. Server-side payment, audit, and contact-release controls are unchanged. Listing and review copy now state that these are fixed platform fees for real-world UK construction marketplace services, not store IAP. App Review and Play review can still reject this; that residual risk is not a Year 1 reopen.
- Affects: `docs/Action-Tracker.md`, `docs/Native-Mobile-Delivery-Plan.md`, `mobile/store.config.json`, `mobile/store/play-en-GB.json`, `mobile/tests/mobile-config.test.ts`.
- Environment: no schema or migration change. Do not put Stripe secrets in the mobile binary.
- Validation: `npx tsx --test tests/mobile-config.test.ts` from `mobile/`.

### 2026-09-22 - Payment ledger, privileged MFA, trusted IP, and governing-document canon

- Changed: Stripe webhooks now persist an append-only `StripeEvent` ledger, reject charged-total/currency mismatches, and apply monotonic payment transitions. Super User/Owner administrative APIs and `/super-user` require enrolled TOTP MFA (login and MFA enrollment remain available). Production rate limiting keys only from `TRUSTED_CLIENT_IP_HEADER` (`x-real-ip` on Render) and ignores spoofed `X-Forwarded-For`. A User cannot unlock or quote their own tender. Field placeholders and focus rings meet AA contrast. Architecture, product, and security documents now record unified `USER`, Owner-set £10-default fees, and Neon Lakebase Postgres.
- Affects: `prisma/schema.prisma`, `prisma/migrations/20260922000000_add_stripe_event_ledger/migration.sql`, `src/server/payments/stripeEventLedger.ts`, `src/app/api/webhooks/stripe/route.ts`, `src/server/auth/session.ts`, `src/server/auth/auth.ts`, `src/proxy.ts`, `src/server/http/rateLimit.ts`, `src/server/domain/tenderService.ts`, `src/components/ui/Field.tsx`, `render.yaml`, `docs/Architecture.md`, `docs/Product-Requirements.md`, `docs/Security-Requirements.md`, `docs/Action-Tracker.md`, `docs/PRODUCTION-RELEASE-ACTION-LIST.md`.
- Environment: additive `StripeEvent` table; set `TRUSTED_CLIENT_IP_HEADER=x-real-ip` on Render (also in `render.yaml`). No destructive schema change.
- Validation: focused ledger, IDOR, trusted-IP, privileged-MFA, contrast, and source-a11y tests; `npx prisma generate` and `npx prisma migrate deploy`.

### 2026-09-18 - Deployment verification fails closed

- Changed: unauthenticated probes with unexpected HTTP status fail; Resend, audit, Sentry, retention, reversal, and contact-release checks PASS only with the exact staging or production attestation; production workflow requires `PRODUCTION PROVIDER CONTROLS VERIFIED` and rollback redeploys the previous SHA through Render then re-verifies.
- Affects: `scripts/health-check/verify-deployment.mjs`, `scripts/health-check/verify-deployment-approval.mjs`, `.github/workflows/deploy-production.yml`, `scripts/health-check/validate-workflows.mjs`, `tests/lib/deployment-high-risk-attestation.test.ts`, `docs/PRODUCTION-RELEASE-ACTION-LIST.md`, `docs/health-check/README.md`.
- Environment: no schema or migration change.
- Validation: `tests/lib/deployment-high-risk-attestation.test.ts` and `npm run health:validate-workflows`.

### 2026-09-18 - Source accessibility polish for filters, sort, loading, and narrow screens

- Changed: opportunity search/filters now have associated labels and a filter fieldset; quote comparison announces the active sort; Client and Provider tender detail pages use a branded loading and retry shell; footer policy links meet a 44px hit target; landing partner tiles no longer use a fixed minimum width that overflowed narrow screens.
- Affects: `src/components/retailer/OpportunitiesExplorer.tsx`, `src/components/quotes/QuoteComparison.tsx`, `src/components/ui/PageLoadState.tsx`, `src/app/client/tenders/[id]/page.tsx`, `src/app/retailer/tenders/[id]/page.tsx`, `src/components/layout/LandingPartners.tsx`, `src/components/layout/SiteFooter.tsx`, `tests/lib/quote-comparison-advertising.test.ts`.
- Environment: no schema or migration change.
- Validation: `tests/lib/quote-comparison-advertising.test.ts` and type-check.

### 2026-09-18 - Pre-release rendered HTML and operational-log privacy coverage

- Changed: added quote-comparison HTML assertions that Provider contact details are absent until an authorised release payload is supplied, and a sweep that server/API audit metadata and console output do not persist or print email or phone.
- Affects: `tests/lib/pre-release-rendered-privacy.test.ts`, `tests/lib/pre-release-operational-log-privacy.test.ts`, `docs/Action-Tracker.md`.
- Environment: no schema or migration change.
- Validation: both new tests pass.

### 2026-09-18 - Misuse and fraud monitoring flags

- Changed: Super User tender monitoring now flags repeated Client/Provider pairings, unusual failed or reversed payments, repeated tender closures and quote rejections, and excessive sign-in failures, in addition to near-duplicate tenders, confidentiality blocks, and unlock-without-quote harvesting.
- Affects: `src/server/domain/complianceMonitoringService.ts`, `src/components/admin/ComplianceMonitoringPanel.tsx`, `tests/lib/compliance-monitoring.test.ts`, `docs/Action-Tracker.md`.
- Environment: no schema or migration change.
- Validation: `tests/lib/compliance-monitoring.test.ts`.

### 2026-09-18 - Paid Professional Services interest registration

- Changed: Professional Services Providers must pay the Owner-set Professional Services tender release fee before interest is registered. Client contact details after the deadline are released only when that payment is confirmed. Refunds remove the interest row.
- Affects: Prisma `PaymentType.PROFESSIONAL_INTEREST`, `ProfessionalInterest.paymentId`, `src/server/domain/professionalInterestService.ts`, Stripe webhook and dev confirmation, Provider tender UI, `tests/lib/professional-interest.integration.test.ts`.
- Environment: additive enum value and optional `paymentId` on `ProfessionalInterest`; no destructive change.
- Validation: focused professional-interest integration test and type-check.

### 2026-09-18 - Unlocked Provider tender attachment access

- Changed: a Provider with a persisted tender unlock can list attachment metadata on the unlocked tender view and download the files through `/api/tenders/[id]/attachments/[attachmentId]`. Matched Providers without an unlock remain denied. Owning Client company members keep download access. File bytes are not included in the unlocked tender JSON payload.
- Affects: `src/server/domain/tenderAttachmentService.ts`, `src/server/domain/unlockService.ts`, `tests/lib/tender-attachment-access.integration.test.ts`, `docs/Action-Tracker.md`, `docs/PRODUCTION-RELEASE-ACTION-LIST.md`.
- Environment: no schema or migration change.
- Validation: focused attachment access test and type-check.

### 2026-09-13 - Environmental Secret Resolution For Third-Party Verification URL & Signing Secrets

- Changed: third-party partner portal URLs and verification secrets for Enhanced Verification are now resolved exclusively from environment variables (`VERIFICATION_REGISTRATION_TOKEN_SECRET`, `VERIFICATION_INTEGRATION_SECRET_TRADE_TENDER_VERIFICATION`, `VERIFICATION_OUTBOUND_SECRET_TRADE_TENDER_VERIFICATION`, `VERIFICATION_OUTBOUND_URL_TRADE_TENDER_VERIFICATION`, `ENHANCED_VERIFICATION_PARTNER_URL`, `ENHANCED_VERIFICATION_SHARED_SECRET`), removing third-party secret and URL inputs from the Owner space UI (`SuperUserSettingsPanel.tsx`) and database platform settings.
- Affects: `src/server/domain/platformSettings.ts`, `src/app/api/super-user/settings/route.ts`, `src/components/admin/SuperUserSettingsPanel.tsx`, `src/server/domain/enhancedVerificationInvitationService.ts`, and `tests/lib/enhanced-verification-status-callback.test.ts`.
- Environment: configure `VERIFICATION_REGISTRATION_TOKEN_SECRET` / `VERIFICATION_OUTBOUND_SECRET_TRADE_TENDER_VERIFICATION` and `VERIFICATION_OUTBOUND_URL_TRADE_TENDER_VERIFICATION` (or `ENHANCED_VERIFICATION_PARTNER_URL` / `ENHANCED_VERIFICATION_SHARED_SECRET`) in environment secrets.
- Validation: `npm run type-check` and full `npm test` pass.

### 2026-09-13 - Verification Option Selection (AI Verification vs. Enhanced Verification)

- Changed: updated the Provider "Become Verified" screen (`/retailer/verification`) to present a prominent choice card allowing users to select between AI Verification (included automated document evidence check) and Enhanced Verification (paid professional H&S review awarding Bronze, Silver, or Gold safety competency tiers).
- Changed: selecting AI Verification displays the automated document checklist and upload tools below; selecting Enhanced Verification presents the H&S review summary, safety competency tiers guide, and pricing options with a direct action button proceeding to `/retailer/independent-review`. Supports pre-selection via `?option=enhanced` query parameter.
- Affects: `src/app/retailer/verification/page.tsx` and `src/app/retailer/profile/page.tsx`.
- Environment: no schema or migration change.
- Validation: `npm run type-check` and full `npm test` pass.

### 2026-09-13 - Shared Secret Management & Inbound Enhanced Verification Status Callback API

- Changed: added Owner-managed platform setting `INDEPENDENT_REVIEW_SHARED_SECRET` in `platformSettings.ts`, `/api/super-user/settings`, and `SuperUserSettingsPanel.tsx` (falling back to environment variables `VERIFICATION_REGISTRATION_TOKEN_SECRET`, `VERIFICATION_INTEGRATION_SECRET_TRADE_TENDER_VERIFICATION`, `VERIFICATION_OUTBOUND_SECRET_TRADE_TENDER_VERIFICATION`, `ENHANCED_VERIFICATION_SHARED_SECRET`, `INDEPENDENT_REVIEW_SHARED_SECRET`, and `NEXTAUTH_SECRET`).
- Changed: token signing and verification in `enhancedVerificationInvitationService.ts` now uses the configured shared secret.
- Changed: created inbound partner status callback API endpoints `/api/partner/enhanced-verification/status` and `/api/webhooks/enhanced-verification`. Authenticates inbound requests from third-party verification providers using header shared secret (`X-Shared-Secret`, `Authorization: Bearer <secret>`) or HMAC-SHA256 signature (`X-Signature`, `X-Hub-Signature-256`). On callback, updates `RetailerProfile.independentReviewStatus` (`APPROVED`/`DECLINED`), assigns tier (`BRONZE`/`SILVER`/`GOLD`), updates notes, marks invitation status as `USED`, and records audit events.
- Affects: `src/server/domain/platformSettings.ts`, `src/app/api/super-user/settings/route.ts`, `src/components/admin/SuperUserSettingsPanel.tsx`, `src/server/domain/enhancedVerificationInvitationService.ts`, `src/app/api/partner/enhanced-verification/status/route.ts`, `src/app/api/webhooks/enhanced-verification/route.ts`, and `tests/lib/enhanced-verification-status-callback.test.ts`.
- Environment: no schema or migration change.
- Validation: `npm run type-check` and full `npm test` pass.

### 2026-09-13 - Direct Registration Link & Secret Token Integration For Third-Party Applications

- Changed: enhanced `createEnhancedVerificationInvitation` so invitation emails automatically send nominated users directly to a defined registration URL (`INDEPENDENT_REVIEW_PARTNER_URL` platform setting, `ENHANCED_VERIFICATION_PARTNER_URL` environment variable, or optional custom `registrationUrl` request parameter), with the signed secret token incorporated in query parameters (`?token={SignedInvitationToken}&verificationToken={SignedInvitationToken}`). If no third-party URL is configured, it falls back to the platform's standard registration route.
- Changed: added `INDEPENDENT_REVIEW_PARTNER_URL` configuration to Owner platform settings (`src/server/domain/platformSettings.ts`), Super User settings API (`/api/super-user/settings`), and the Super User settings panel (`SuperUserSettingsPanel.tsx`).
- Affects: `src/server/domain/enhancedVerificationInvitationService.ts`, `src/app/api/retailer/independent-review/invite/route.ts`, `src/server/domain/platformSettings.ts`, `src/app/api/super-user/settings/route.ts`, `src/components/admin/SuperUserSettingsPanel.tsx`, and `tests/lib/enhanced-verification-invitation.test.ts`.
- Environment: no schema or migration change.
- Validation: `npm run type-check` and full `npm test` pass.

### 2026-09-13 - Enhanced Verification Invitation Agent & Secure Link Dispatch

- Changed: added an Enhanced Verification invitation workflow (`src/server/domain/enhancedVerificationInvitationService.ts`) enforcing business rules that require a verified, non-refunded, non-disputed `INDEPENDENT_REVIEW` purchase (`CONFIRMED` status) and active user account.
- Changed: generates cryptographically signed invitation tokens (HMAC-SHA256) containing structured payloads (`InvitationId`, `TenantId`, `Email`, `Module`, `Product`, `IssuedAt`, `ExpiresAt`, `Nonce`, `Version`), stores token hashes in `EnhancedVerificationInvitation` table (migration `20260913030000_add_enhanced_verification_invitation`), dispatches branded invitation emails (`Enhanced Verification Registration Invitation`), and logs immutable audit events.
- Changed: added invitation endpoint `/api/retailer/independent-review/invite` and verification/consumption endpoint `/api/auth/verify-invitation`. Integrated token purging into retention service.
- Affects: `prisma/schema.prisma`, migration `20260913030000_add_enhanced_verification_invitation`, `src/server/domain/enhancedVerificationInvitationService.ts`, `src/server/notifications/emailTemplates.ts`, `src/app/api/retailer/independent-review/invite/route.ts`, `src/app/api/auth/verify-invitation/route.ts`, `src/server/domain/retentionService.ts`, and `tests/lib/enhanced-verification-invitation.test.ts`.
- Environment: additive database migration (`EnhancedVerificationInvitation` table and `EnhancedVerificationInvitationStatus` enum); no destructive change.
- Validation: `npx prisma generate`, `npx prisma migrate deploy`, `npm run type-check`, and full `npm test` pass.

### 2026-09-13 - Verification Reset On Service Scope Change & Enhanced Review Updated Assessment Fee

- Changed: modifying a company profile's services/categories or company type now automatically resets both AI verification (`verificationStatus` -> `UNVERIFIED`) and Enhanced Verification (`independentReviewStatus` -> `NOT_PURCHASED`), with clear notes explaining that changing the service scope introduces new legal and compliance requirements.
- Changed: added Owner-controlled platform settings for `INDEPENDENT_REVIEW_REASSESSMENT_ACTIVE` and `INDEPENDENT_REVIEW_REASSESSMENT_FEE_GBP` (default £50 excl. VAT) in the Super User settings panel alongside other purchase options.
- Changed: when a Provider's Enhanced Verification is reset due to a service scope change, the Provider profile and Enhanced H&S review pages display a clear message explaining the reset and offering a minor re-verification via an "updated assessment" purchase option at the Owner-configured fee.
- Affects: `src/server/domain/platformSettings.ts`, `src/app/api/super-user/settings/route.ts`, `src/components/admin/SuperUserSettingsPanel.tsx`, `src/server/domain/independentReviewService.ts`, `src/app/api/retailer/independent-review/route.ts`, `src/app/api/retailer/profile/route.ts`, `src/app/api/client/profile/route.ts`, `src/app/retailer/profile/page.tsx`, `src/app/retailer/independent-review/page.tsx`, `src/app/client/profile/page.tsx`, and `tests/lib/independent-review-renewal.test.ts`.
- Environment: no schema, migration, or environment resource change.
- Validation: `npm run type-check` and full `npm test` pass.

### 2026-09-13 - Universal Company Type Field Across Contractor Profiles & Registration

- Changed: added `companyType` to `ClientCompany` model and migration `20260913020000_add_client_company_type`. Contractor company profile (`/client/profile`), Provider company profile (`/retailer/profile`), and account registration (`/register`) now all present a mandatory Company Type dropdown (`Sole trader`, `Limited company`, `Partnership`, `LLP`, `PLC`, `Other`).
- Changed: ensured Provider profile fallback formatting for `companyType` so `COMPANY_TYPE_LABELS[companyType]` safely defaults to `Limited company` if unset, preventing blank values.
- Affects: `prisma/schema.prisma`, migration `20260913020000_add_client_company_type`, `src/lib/schemas/register.ts`, `src/app/api/auth/register/route.ts`, `src/app/register/page.tsx`, `src/app/api/client/profile/route.ts`, `src/app/client/profile/page.tsx`, `src/app/retailer/profile/page.tsx`, and `tests/lib/client-company.test.ts`.
- Environment: additive database migration (`companyType` column on `ClientCompany` with default `LIMITED_COMPANY`); no breaking or destructive change.
- Validation: `npx prisma generate`, `npx prisma migrate deploy`, `npm run type-check`, and `npm test` pass.

### 2026-09-13 - Mandatory Certificate Of Incorporation For Incorporated Companies & Verification Levels

- Changed: Certificate of Incorporation is now a mandatory document during verification whenever a Provider's company type requires incorporation (Limited Company, LLP, PLC). For unincorporated company types (Sole Trader, Partnership, Other), Certificate of Incorporation remains optional.
- Changed: standardized the six verification levels for documentation/explanatory purposes (`Unverified`, `Sole trader AI Verified`, `Incorporated AI Verified`, `Enhanced Bronze Verification`, `Enhanced Silver Verification`, `Enhanced Gold Verification`) and aligned banner/badge UI labels to use `Unverified`, `Sole Trader`, `Verified`, `Bronze`, `Silver`, and `Gold`.
- Affects: `src/lib/companyTypes.ts`, `src/lib/verification-documents.ts`, `src/server/domain/verificationDocumentService.ts`, `src/app/api/retailer/verification/route.ts`, `src/app/api/retailer/verification/documents/route.ts`, `src/app/retailer/verification/page.tsx`, `src/app/retailer/profile/page.tsx`, `src/components/quotes/QuoteComparison.tsx`, `src/app/policies/[slug]/page.tsx`, `tests/lib/verification-documents.test.ts`, and `tests/lib/sole-trader-verification.test.ts`.
- Environment: no schema or environment resource change.
- Validation: `npm run type-check` and full `npm test` pass.

### 2026-09-13 - Mandatory Company Type And Sole Trader AI Verification By Self-Employment Evidence

- Changed: added a mandatory `companyType` dropdown (Sole Trader, Limited Company, Partnership, LLP, PLC, Other) to the Provider profile, alongside the already-mandatory company name. Changing company type resets verification status because the applicable evidence differs by type.
- Changed: sole trader Providers can now become Trade Tender AI verified using self-employment evidence instead of being blocked outright. The rule is any one strong evidence document (HMRC UTR confirmation, SA302 tax calculation, VAT registration certificate, CIS registration proof, or public liability/professional indemnity insurance in the trading name), or at least two distinct moderate evidence documents (business bank statement, customer invoices, customer quotations or contracts, trade body membership, or trading activity evidence). All sole trader evidence types always require human review, consistent with the existing insurance/waste-licence policy.
- Changed: added 9 new `ProviderVerificationDocumentType` values and a `CompanyType` enum/column via new migrations. New sole-trader-exclusive document types are excluded from the existing category-based document checklist so non-sole-trader Providers are unaffected.
- Changed: Contractor quote badges, the Provider profile/verification pages, and the public verification policy now reflect that sole traders can be AI verified; a sole trader Provider that is not yet verified still shows the existing Sole Trader flag.
- Affects: `prisma/schema.prisma`, migrations `20260913000000_add_company_type` and `20260913010000_add_sole_trader_verification_document_types`, `src/lib/verification-documents.ts`, `src/lib/companyTypes.ts`, `src/server/domain/verificationDocumentService.ts`, `src/server/domain/verificationAiAssessment.ts`, `src/app/api/retailer/profile/route.ts`, `src/app/api/retailer/verification/route.ts`, `src/app/api/retailer/verification/documents/route.ts`, `src/app/retailer/profile/page.tsx`, `src/app/retailer/verification/page.tsx`, `src/components/quotes/QuoteComparison.tsx`, `src/app/policies/[slug]/page.tsx`, and `tests/lib/sole-trader-verification.test.ts`/`tests/lib/quote-comparison-advertising.test.ts`.
- Environment: two additive migrations (new enum values and a new enum/column with a safe default and backfill from `isSoleTrader`); no destructive change. Apply only through the approved staging release process with rollback and validation evidence.
- Validation: `npx prisma generate`, `npm run type-check`, and the full `npm test` suite pass after applying the migrations locally with `npx prisma migrate deploy`.

### 2026-09-13 - Enhanced Verification Wording Replaces Independent Verification

- Changed: user-facing copy across the Provider review page, Provider profile, Contractor quote badges/tooltips, Super User settings and analytics views, the public verification policy, and renewal/purchase email templates now says "enhanced verification"/"enhanced review" instead of "independent verification"/"independent review", because the reviewing company (Sinclair Safety Solutions Ltd) partly owns Trade Tender and "independent" is not an accurate claim of impartiality.
- Changed: this is a display-copy change only. Internal identifiers were intentionally left unchanged, including the `IndependentReviewStatus`/`IndependentReviewTier` Prisma enums and `RetailerProfile` columns, the `independentReviewService`/`independentReviewTiers` module and function names, the `/api/retailer/independent-review` route, and the `INDEPENDENT_REVIEW_*` platform-setting keys, to avoid an unnecessary schema migration.
- Affects: `src/app/retailer/independent-review/page.tsx`, `src/app/retailer/profile/page.tsx`, `src/components/quotes/QuoteComparison.tsx`, `src/components/admin/SuperUserSettingsPanel.tsx`, `src/components/admin/UserAnalyticsProfileView.tsx`, `src/server/domain/analyticsService.ts`, `src/lib/independentReviewTiers.ts`, `src/server/notifications/emailTemplates.ts`, `src/app/api/retailer/independent-review/route.ts`, `src/app/policies/[slug]/page.tsx`, and `tests/lib/independent-review-renewal.test.ts`.
- Environment: no schema, payment, or environment resource change.
- Validation: `npm run type-check` and the focused independent-review/quote-comparison test files pass with the updated copy assertions.

### 2026-09-11 - Fail-Closed Deployment Gate For Required Staging Evidence

- Changed: hardened the staged deployment gate so the repository verification fails closed when required evidence is missing or remains `UNVERIFIED`, rather than recording a success and continuing. The staging approval script now requires the exact `HIGH RISK STAGING CONTROLS VERIFIED` attestation, and the post-deploy verification script exits non-zero whenever any check is `FAIL` or `UNVERIFIED`, preventing a release from being treated as healthy without explicit evidence.
- Changed: `deploy-staging.yml` passes the `high_risk_attestation` workflow input into `verify-deployment-approval.mjs` before any deployment step runs, ensuring the high-risk evidence is checked before the staging job proceeds.
- Affects: `.github/workflows/deploy-staging.yml`, `scripts/health-check/verify-deployment-approval.mjs`, `scripts/health-check/verify-deployment.mjs`, and the focused regression test `tests/lib/deployment-high-risk-attestation.test.ts`.
- Environment: no production or staging environment resource change; this is a repository gate fix only. Production deployment still requires the protected Render environment and approved deployment evidence from the external hosting setup.
- Validation: `npm test -- --test-name-pattern "deployment-high-risk-attestation|deployment|verify-deployment"` passes with the fail-closed gate regression covered.

### 2026-09-06 - GDPR Privacy-By-Design Hardening

- Changed: registration now requires and records versioned Terms of Use and Privacy Policy acknowledgement, with a timestamp and append-only `LEGAL_DOCUMENTS_ACCEPTED` audit event. The authenticated support workflow now captures a structured data-subject right (access/export, rectification, erasure, restriction, or objection), assigns a 30-day due date, limits final resolution to the Owner with recorded resolution evidence, and audits lifecycle actions. The server rejects support submissions containing obvious passwords, payment-card numbers, email addresses, or UK phone numbers without persisting the content. The authorised retention job removes expired email-verification/password-reset tokens after 30 days and page-view telemetry after 90 days; legal holds remain applicable to their existing Tender, Quote, and TenderAttachment scope only. Public policy copy now accurately states the essential-only cookie position and that optional trackers and consent controls are not live.
- Affects: [prisma/schema.prisma](../prisma/schema.prisma), migration `20260906020000_add_privacy_acceptance_and_data_subject_requests`, registration, support-request, retention, policy, and audit workflows.
- Environment: no migration has been deployed and no staging/production resource, credential, integration, permission, or configuration was changed. Apply the migration only through the approved staging release process with rollback and validation evidence.
- Validation: `npx prisma validate` and `npm run type-check` pass. Focused support-request tests pass. Prisma client engine regeneration is blocked locally by a locked `query_engine-windows.dll.node`; the generated TypeScript client remains sufficient for the successful type check. Full test and production build remain to be run after the focused changes.

# Implementation Change Register

This is the operational source of truth for adapting repository changes to the deployed app environments.
Update it in the same change set as every applicable implementation. Do not record secrets.

## Update Format

- Date and commit or pending change reference
- What changed and why
- Affected app, database, configuration, workflow, and user-facing surfaces
- Required environment adaptation or operator action
- Validation completed and validation still outstanding

## Current Changes

### 2026-09-11 - Full-Quote Contact Release Fee Basis

- Changed: accepted quote release pricing is explicitly based on the full submitted quote value for the Provider quote being accepted. Contractors cannot select only part of a quote to reduce the release fee.
- Changed: narrowed payment fee overrides so they apply only to independent-review payments, preventing any future accidental override of `CLIENT_RELEASE` fees away from the full quote value.
- Changed: quote comparison and Contractor tender copy now state `Accept full quote` and `Full submitted quote value`, and clarify that the release fee is not based on selected quote lines.
- Affects: contact-release/payment pricing guard, Contractor quote comparison copy, and focused full-quote release tests. No schema, migration, or external service change.
- Environment: no operator action required.
- Validation: focused full-quote release tests and `npm run type-check -- --pretty false` pass locally.

### 2026-09-11 - MFA Activation Repair

- Changed: starting MFA enrollment no longer increments `sessionVersion`, so the current authenticated session remains valid long enough for the Super User to enter the authenticator code and complete activation. Session invalidation still occurs when MFA is successfully enabled or disabled.
- Changed: the Security page MFA settings now load the current MFA enabled state from `/api/auth/mfa` before presenting setup/disable controls, so an already enabled account is not shown the setup flow again.
- Affects: MFA API route, MFA settings UI, and focused MFA tests.
- Environment: no migration, secret, or external service change. `NEXTAUTH_SECRET` must remain configured because it encrypts MFA secrets.
- Validation: focused MFA tests and `npm run type-check -- --pretty false` pass locally.

### 2026-09-11 - Independent Verification Renewal Reminder Emails

- Changed: added an automatic renewal reminder workflow for independent verification. When the Owner renewal model is active, approved Providers are scanned once they reach the 11-month renewal window, which is one month before the 12-month expiry.
- Changed: reminders are sent to the primary contact for the operating company where available, falling back to the Provider account email if no operating-company primary contact is found. The email includes the expiry date, renewal fee, and a `Renew now` link to `/retailer/independent-review?renewal=1`.
- Changed: reminder sends and failures are recorded in audit logs, and successful sends are deduplicated by profile and expiry date so the company is not repeatedly emailed for the same renewal window.
- Changed: added `npm run independent-review:renewal-reminders` and the scheduled production workflow `independent-review-renewal-reminders.yml`, which fails closed unless `DATABASE_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, and `NEXTAUTH_URL` are configured in the production GitHub Actions environment.
- Affects: independent review service, email templates, reminder script, GitHub workflow validation, package scripts, operational docs, and focused renewal reminder tests.
- Environment: configure the production GitHub Actions environment secrets named above before relying on the scheduled workflow. No new database migration is required.
- Validation: focused renewal reminder tests, `npm run type-check -- --pretty false`, and `npm run health:validate-workflows` pass locally.

### 2026-09-11 - Independent Verification Tier Guide

- Changed: added a shared Bronze/Silver/Gold independent verification tier guide. Bronze represents reviewed evidence of legal requirements such as permits, insurances, and competent advice. Silver includes Bronze plus sufficient evidence of industry-specific employee and managerial training. Gold includes Bronze and Silver plus either a comprehensive management system or validated SSIP membership.
- Changed: surfaced the tier guide in the Provider independent review page, Provider profile independent-review messaging, Contractor quote badge hover text, the quote comparison verification key, and the public verification policy.
- Affects: independent verification copy, quote comparison badge descriptions, public verification policy, and focused quote/policy tests. No schema, payment, or environment change.
- Environment: no operator action required.
- Validation: focused quote/policy tests and `npm run type-check -- --pretty false` pass locally.

### 2026-09-11 - Independent Review Renewal Workflow

- Changed: independent verification now has a 12-month validity model with renewal opening 11 months after approval. The Provider renewal option appears before expiry when the Owner has activated renewals.
- Changed: added Owner-controlled settings for `INDEPENDENT_REVIEW_RENEWAL_ACTIVE` and `INDEPENDENT_REVIEW_RENEWAL_FEE_GBP`, allowing the renewal price to be lower than the standard independent review purchase price.
- Changed: renewal purchases use the lower configured renewal fee when requested during the renewal window. Confirmed renewal payments move the profile back to purchased/awaiting review so the Super User can approve or decline the renewed review through the existing decision workflow.
- Changed: expired independent reviews no longer show as independently verified in Contractor quote comparison badges.
- Affects: independent review API/UI, independent review service, payment creation fee override support, Owner settings UI/API, quote badge eligibility, and focused renewal/quote tests.
- Environment: no migration, secret, or external service change. Production Stripe webhook validation should include an independent-review renewal purchase once the model is activated.
- Validation: focused renewal/quote tests and `npm run type-check -- --pretty false` pass locally. Full suite/build validation remains required before release.

### 2026-09-11 - Fixed Contractor And Professional Service Release Fees

- Changed: Contractor Services and Professional Services tender releases now use independent fixed Owner-controlled fees rather than the internal estimate/dynamic staged pricing path.
- Changed: added separate Owner settings for `CONTRACTOR_SERVICE_UNLOCK_FEE_GBP` and `PROFESSIONAL_SERVICE_UNLOCK_FEE_GBP`. These fees apply whenever a tender contains the relevant service category, regardless of estimated tender value, item-level pricing intelligence, or master estimate reduction.
- Changed: dynamic estimate-based tender release pricing remains available for other service categories, with the global zero-cost Provider unlock fee still acting as a hard payment waiver.
- Affects: platform fee settings, Owner settings UI/API, Provider tender unlock fee calculation, and focused pricing tests.
- Environment: no migration, secret, or external service change.
- Validation: focused pricing tests and `npm run type-check -- --pretty false` pass locally.

### 2026-09-11 - Initial Category Pricing Estimates

- Changed: added an explicit initial unit-price estimate table for every service/category type in the platform catalogue. These internal starting estimates are based on publicly available UK construction-market pricing patterns and provide a cautious first baseline until Trade Tender has enough live quotation history for each category.
- Changed: pricing intelligence now uses the explicit category estimate first, then applies item-level adjustments for clearly higher-risk or lower-cost variants such as reclaimed/special items, hazardous/asbestos work, operator/contract-lift/temporary-works requirements, or simpler low-risk items.
- Affects: quote-estimate service, Pricing Intelligence catalogue rows, dynamic tender unlock estimates, and focused pricing tests. No customer-facing estimate disclosure was added.
- Environment: no migration, secret, or external service change.
- Validation: focused pricing intelligence tests and `npm run type-check -- --pretty false` pass locally.

### 2026-09-11 - Sole Trader Verification Status

- Changed: Provider profiles now include an `isSoleTrader` declaration. When enabled, the profile is not eligible for AI verification and any existing AI verification status is reset to unverified with an explanatory note.
- Changed: sole trader profiles are blocked server-side from submitting AI verification requests, and the Become Verified page explains why AI verification is unavailable.
- Changed: Contractor quote comparison now shows a `Sole Trader` status flag with hover text explaining that the Provider declared sole-trader status and that Contractors should complete their own identity, insurance, competence, and commercial checks.
- Changed: public verification policy text now documents sole trader status and the due-diligence implications.
- Affects: `RetailerProfile` schema/migration `20260911170000_add_sole_trader_profile_flag`, Provider profile API/UI, Provider verification API/UI, Client quote comparison, quote service data selection, verification policy, and focused verification/quote tests.
- Environment: apply migration `20260911170000_add_sole_trader_profile_flag` through the approved staging and production release process. No secrets or external integrations changed.
- Validation: focused verification/quote tests and `npm run type-check -- --pretty false` pass locally. Full suite/build validation remains required before release.

### 2026-09-11 - Professional Services Tender Form Refinement

- Changed: expanded the Professional Services catalogue into stronger consultant/service provisions covering Health, Safety & CDM Consultancy, Fire Safety Consultancy, Surveying & Building Consultancy, Design & Engineering Consultancy, Quantity Surveying & Cost Consultancy, Project Management & Programme Support, and Environmental & Specialist Consultancy.
- Changed: removed the duplicate Professional Services prompt in the tender package form. The user now selects the professional discipline and the specific service needed from the catalogue; only selecting `Other` opens a mandatory further-details field.
- Changed: fixed the Professional Services validation path so it validates the visible service-period controls instead of hidden quantity/unit fields, preventing the form from getting stuck.
- Changed: strengthened Contractor Services, Professional Services, and Plant Hire packages with quote-critical fields for size/scope/output quantity, permitted working hours, access restrictions, site constraints, works/outputs/deliverables, minimum requirements, and expanded plant hire support options including fuel, delivery/collection, lifting accessories, operator competence, certificates, out-of-hours delivery, permits, traffic management, and insurance evidence.
- Changed: when Continue is blocked, the tender builder now sets an explicit page-level error telling the user to fix the highlighted package details, while each missing service field shows its own specific error message.
- Affects: service catalogue, tender builder UI/validation, pricing catalogue keys derived from service provisions, and focused tender/pricing tests.
- Environment: no migration or external configuration change.
- Validation: focused tender builder, tender schema, pricing catalogue tests, and `npm run type-check -- --pretty false` pass locally.

### 2026-09-11 - Product-Category Pricing Intelligence And Master Fee Reduction

- Changed: moved detailed pricing intelligence out of the main Super User dashboard and into a dedicated `/super-user/pricing-intelligence` page. The dashboard now shows only an overall accuracy summary chart and a link to the detailed page.
- Changed: pricing intelligence is now linked to product/service categories and items, not individual tenders. Baseline rows use service/category/item keys such as `Materials > Bricks > Facing bricks` and show live sample counts, baseline value, automatic offset, manual override, effective estimate, and variance.
- Changed: pricing intelligence is now catalogue-first: every potential purchase from the platform service catalogue is listed with a standard estimate unit and estimated unit price, even before live quote history exists for that item.
- Changed: weekly live-data refresh now recalculates automatic item offsets from all available quote-line history, not only accepted quotes. It identifies the material/service from the tender item, converts the quoted quantity into the catalogue standard unit, calculates the live unit price, compares it with the estimate, and reports whether the real-world price is materially higher or lower.
- Changed: Owner manual overrides remain available for erroneous or unusual results and can be returned to automatic mode. If a manual override is saved before live data has created a row, the catalogue row is persisted on demand.
- Changed: added an Owner-controlled master estimate reduction percentage. This reduction applies after item-level offsets and only to the dynamic tender release fee basis; for example, a 5% master reduction means a £100,000 estimate is charged as a £95,000 fee basis.
- Affects: `QuoteEstimateBaseline` schema/migrations `20260911150000_item_pricing_offsets` and `20260911160000_pricing_standard_units`, quote-estimate service, dynamic tender unlock fee calculation, Super User dashboard, new Pricing Intelligence page/API, Owner settings, navigation, pricing refresh script behavior, and focused pricing tests.
- Environment: apply migrations `20260911150000_item_pricing_offsets` and `20260911160000_pricing_standard_units` through the approved staging and production release process before running the weekly pricing refresh in deployed environments. No secrets or external integrations changed.
- Validation: focused pricing intelligence tests, `npx prisma generate`, and `npm run type-check -- --pretty false` pass locally. Full suite/build validation remains required before release.

### 2026-09-11 - Refined Service Tender Forms And Paid Direct Contact Requests

- Changed: tender creation now requires detailed project/package specifications and supports more purpose-specific package capture, including not-applicable units, service provision duration, Contractor Services minimum requirements such as CSCS/SSIP/RAMS/insurance, Professional Services service types with mandatory details when "Other" is selected, and Plant Hire driver/operator and lift-plan requirements.
- Changed: added owner-controlled direct contact requests for Contractor Services and Professional Services tenders. When active, a Provider can pay the configured direct-contact fee to share their own contact details with the purchasing Client before the standard quote route; the Client's contact details remain protected unless released by another approved workflow.
- Changed: added `DIRECT_CONTACT` payments, `DirectContactRequest` records, payment webhook/dev finalisation, Provider request UI, Client released-contact UI, and the Owner settings toggle/fee.
- Affects: tender schema and builder UI, service requirement catalogue, Prisma schema/migration `20260911140000_add_direct_contact_requests`, direct-contact API/domain service, payment service/webhook/dev confirmation, Owner settings, Client tender detail, Provider tender detail, and contact-release policy text.
- Environment: apply the migration through the approved staging and production release process. No secrets or external integrations changed, but production Stripe webhook validation must include the new `DIRECT_CONTACT` payment finaliser after deployment.
- Validation: focused tender builder/schema and direct-contact tests plus `npm run type-check -- --pretty false` pass locally. Full suite and production build remain to be rerun before release.

### 2026-09-11 - Affiliated Partner Terminology

- Changed: replaced current user-facing "partner advertising" wording with "affiliated partners" / "affiliated partner information" across the footer, public partner policy, Owner settings copy, active product requirements, and brand rules.
- Changed: retained internal `ADSPACE_ACTIVE` setting names and historical change-register entries because they are implementation history or compatibility identifiers, not current public wording.
- Affects: public footer, policy index/detail text, Owner settings labels, footer partner terminology test, action tracker wording, product requirements, and brand rules.
- Environment: no migration, secret, production resource, cookie, tracking, tender matching, quote ranking, supplier-selection, payment, or partner-record change.
- Validation: focused footer/policy tests and `npm run type-check -- --pretty false` pass locally.

### 2026-09-11 - Provider Standard Quote Validity And Expired Quote Masking

- Changed: Provider profiles now store `standardQuoteValidityDays` with a default of 30 days. The Provider profile screen lets the User set the standard validity period, and quote submission applies the stored profile value server-side instead of relying on a per-quote form value.
- Changed: purchasing Clients can no longer access commercial details for unaccepted quotes after the Provider validity period expires. The quote comparison view and quote-comparison PDF show the message "This quote has exceeded the Provider's validity period and is no longer valid." instead of quote price, line, charge, delivery, or acceptance controls.
- Changed: server-side quote acceptance rejects expired unaccepted quotes, preserving the payment/contact-release controls even if a stale UI tries to accept one.
- Affects: `RetailerProfile` schema/migration `20260911130000_add_standard_quote_validity`, Provider profile API/UI, Provider quote submission UI, quote submission service, Client quote comparison, quote PDF export, and contact-release quote acceptance.
- Environment: apply the migration through the approved staging and production release process before enabling this behavior in deployed environments. No secrets or external integrations changed.
- Validation: `npx prisma generate`, focused quote-schema and quote-validity tests, and `npm run type-check -- --pretty false` pass locally.

### 2026-09-11 - Conservative Weekly Quote Estimate Baselines

- Changed: internal quote-estimate pricing now uses a bottom-third pricing scale when observed quote or quote-line prices from live quotation data already available in the Trade Tender platform conflict, rather than a straight average. This deliberately keeps estimates conservative before the Owner's offset is applied.
- Changed: added `QuoteEstimateBaseline` and migration `20260911120000_add_quote_estimate_baselines` so reviewed category baselines can be stored and reused by dynamic tender-unlock pricing and Super User pricing intelligence.
- Changed: added `npm run pricing:refresh-estimates` and the weekly `pricing-estimate-refresh.yml` workflow. The workflow runs Mondays at 03:11 UTC and updates the baseline table from live platform quotation data, using the production GitHub Actions `DATABASE_URL` secret to read current quote and quote-line records.
- Changed: updated the workflow validator to recognise `pricing-estimate-refresh.yml` as an explicitly allowed operational schedule, matching the existing retention-job exception while preserving the single authoritative repository audit schedule rule.
- Affects: quote-estimate service, dynamic Provider tender-unlock pricing, Super User analytics estimate values, Prisma schema/migration, package scripts, workflow validation, and the new weekly workflow.
- Environment: apply the migration through the approved staging/production release process before enabling the weekly workflow. Configure only the production GitHub Actions environment secret name `DATABASE_URL`; do not commit secret values.
- Validation: `npx prisma generate`, focused quote-estimate tests, and `npm run type-check -- --pretty false` pass locally. Production workflow execution remains outstanding until environment secrets and migration deployment are approved.

### 2026-09-11 - WCAG Status Badge Accessibility Fix

- Changed: darkened the platform status-symbol colours used by the status badge component so the Pending, Approved, and Neutral variants meet AA normal-text contrast against their light tinted backgrounds without changing the broader brand palette or the red attention treatment. The adjusted values are Pending `#8A4B00`, Approved `#1F5F2A`, and Neutral `#4B5563`.
- Changed: kept the fix isolated to the status token values used by `StatusBadge` in `src/components/ui/StatusBadge.tsx`, while leaving the rest of the brand palette and the attention badge untouched.
- Affects: `tailwind.config.ts`, `src/components/ui/StatusBadge.tsx`, and `tests/lib/wcag-contrast.test.ts`.
- Environment: no operator action required; this is a UI token change only.
- Validation: `npx tsx --test tests/lib/wcag-contrast.test.ts` passes with the updated AA contrast assertions.

### 2026-09-10 - Pre-Release Email Template Privacy Coverage

- Added: `tests/lib/pre-release-email-template-privacy.test.ts`, a static regression test asserting that every pre-release notification email template (`tenderOpportunityTemplate`, `tenderUpdatedTemplate`, `quoteReceivedTemplate`, `quoteReminderTemplate`, `quoteAcceptedTemplate`) has no `email` or phone-number parameter in its input type, so the counterparty's contact details cannot be passed into a pre-release email even by future mistake.
- Changed: confirmed and documented in `docs/Action-Tracker.md` that attachment access privacy is already covered (`tests/lib/tender-attachment-access.integration.test.ts`: only the owning Contractor may download; a matched, unlocked Provider is denied) and that data-subject access/export requests are an intentionally manual Owner-reviewed process with required resolution evidence, not an automated export feature. Narrowed the remaining open scope of the "pre-payment privacy invariants" tracker item to rendered-output/browser assertions and a broader operational-log sweep.
- Affects: the new test file and `docs/Action-Tracker.md` only. No application behavior change.
- Environment: no operator action required.
- Validation: `npm run type-check`, `npm test` (230 tests, confirmed stable across two consecutive runs), `npm run lint`, and `npm run build` pass.

### 2026-09-10 - Policy Review: Version Transparency, Domain Fix, And SEC-105 Test Coverage

- Changed: the public `/policies` page now displays the tracked `CURRENT_TERMS_VERSION`/`CURRENT_PRIVACY_VERSION` date under the Platform Terms and Privacy Policy sections, so users can see when those documents last changed (previously tracked only in the database and never shown to users).
- Changed: fixed an inconsistent contact domain in `docs/adspace/ADVERTISING_TERMS.md` (`trade-tender.co.uk` / `trade-tender@support.email`) to match the canonical `tradetender.co.uk` domain already used elsewhere in the codebase (`docs/adspace/ADVERTISING_GUIDELINES.md`, `scripts/stress-test/run.mjs`). No functional or legal-content change beyond the domain correction.
- Added: `tests/lib/policies-page-required-sections.test.ts` asserting every SEC-105-required policy section remains present on the live page and that the Terms/Privacy version display is not silently removed.
- Affects: `src/app/policies/page.tsx`, `docs/adspace/ADVERTISING_TERMS.md`, and the new test file only. No schema, API, or pricing change.
- Environment: no operator action required.
- Validation: `npm run type-check`, `npm test` (229 tests), and `npm run build` pass.
- Founder/legal decisions still required (not implemented — see conversation summary): registered legal entity name/company number/registered address for the Terms of Use; third-party sub-processor disclosure (Stripe, Resend, Sentry, database host) in the Privacy Policy; a re-acceptance flow for existing users when `CURRENT_TERMS_VERSION`/`CURRENT_PRIVACY_VERSION` changes (currently recorded only at registration); and confirmation that the dormant `ADSPACE_ACTIVE` toggle has no actual ad-serving/consent UI yet, so the detailed adspace governance documents describe a feature not yet built.

### 2026-09-10 - Pre-Release Privacy Invariant Tests And WCAG Contrast Audit Tooling

- Added: `tests/lib/pre-release-privacy-invariants.integration.test.ts`, a PostgreSQL-backed regression test proving `getUnlockedTenderForRetailer` never exposes the Contractor's `clientId`, email, phone, or contact name, and `listQuotesForClientTender` never exposes the Provider's `retailerId`, email, phone, or contact name before the paid contact-release step.
- Added: `tests/lib/wcag-contrast.test.ts`, a WCAG 2.1 contrast-ratio calculator applied to the approved brand tokens for the button variants, the focus-visible ring, and the status-badge tint backgrounds. It confirms AA compliance for the button and focus-ring combinations and for the attention badge, and it documents a confirmed AA gap for the Pending (~2.97:1), Approved (~4.49:1), and Neutral (~4.27:1) status badge text colours, which fall below the 4.5:1 normal-text threshold at any tint strength because the underlying token is too light against white.
- Changed: `docs/Action-Tracker.md` records the privacy-test progress and splits the WCAG item into completed automated token coverage plus a new, specific finding requiring Brand Owner sign-off before any status-colour is darkened (no colour was changed in this commit; changing an approved functional/status colour is a brand-governed decision, not an agent decision).
- Affects: the two new test files and `docs/Action-Tracker.md` only. No application, schema, or colour-token change.
- Environment: no operator action required.
- Validation: `npm run type-check`, `npm test` (227 tests), `npm run lint`, and `npm run build` pass.

### 2026-09-10 - Stripe Webhook Partial-Failure Recovery And Remaining Regression Gaps Closed

- Changed: fixed a genuine gap in `src/app/api/webhooks/stripe/route.ts` found while writing its regression test: if entitlement finalisation (e.g. `finalizeUnlockWithPayment`) threw after the payment row was already updated to `CONFIRMED` but before its `PAYMENT_CONFIRMED` audit event was recorded, a Stripe retry of the same event previously did nothing (the retry's `updateMany` no longer matched `PENDING`/`FAILED` status, so it returned early without re-running finalisation). The route now checks whether this exact event was already fully processed (via the existing per-event audit-log dedup lookup) rather than relying solely on the row-count of the status transition, so a retry after a partial failure resumes the idempotent finalisers, audit, and email instead of stopping silently. Out-of-order protection (a payment already reversed) and ordinary duplicate-delivery skipping are unchanged.
- Added: `tests/lib/content-moderation-obfuscation.test.ts` (obfuscated email/phone detection in `moderateContent`), `tests/lib/audit-log-immutability.integration.test.ts` (direct proof that `AuditLog` update/delete are rejected by the `audit_log_immutable` trigger, and that the actor-deletion `SET NULL` path is still permitted), and `tests/lib/payment-reversal-dispute-and-ordering.integration.test.ts` (a `DISPUTE`-type/chargeback reversal test, an out-of-order reversal-before-completion test, and the partial-failure resume test that exercises the route fix above).
- Changed: removed four `docs/Action-Tracker.md` items now fully proven complete (Stripe webhook finalisation retry/partial-failure recovery, Stripe refund/dispute chargeback and out-of-order coverage, pre-release messaging obfuscated-contact detection, and audit-log tamper-resistance direct test coverage), and trimmed related wording elsewhere to match.
- Affects: `src/app/api/webhooks/stripe/route.ts`, the four new test files, and `docs/Action-Tracker.md`. No schema, API contract, or payment/security behavior change for callers — the fix only makes an already-idempotent finalisation path resumable on retry.
- Environment: no operator action required.
- Validation: `npm run type-check`, `npm test` (217 tests), and `npm run build` pass.

### 2026-09-10 - Action Tracker Reconciliation: Fully Completed Items Removed

- Changed: reviewed every remaining `docs/Action-Tracker.md` item against the actual codebase and removed two entries proven fully complete by existing evidence: "Prevent expired or closed tender activity" (covered end-to-end by `tests/lib/tender-activity.integration.test.ts`, which rejects new activity on both expired and closed tenders) and "Make high-risk staging verification mandatory" (the `deploy-staging.yml` workflow already requires an exact `high_risk_attestation` input and `verify-deployment.mjs` fails the check when it is missing or wrong) and "Plan a tested Next.js 16 upgrade" (`package.json` already pins `next` to `^16.3.4`; local `type-check` and `build` pass), folding its remaining staging-verification need into the existing "Re-run release validation against the deployed staging SHA" item.
- Changed: refined the wording of four partially-complete items to name the specific regression coverage that now exists versus what is still missing: Stripe webhook finalisation retry/replay (covered; partial-failure recovery still missing), Stripe refund/dispute handling (contact-release reversal now covered; chargeback/`DISPUTE`-type and out-of-order delivery coverage still missing), pre-release messaging (release-state transition now covered; obfuscated-contact-detail detection test still missing), and audit-log tamper resistance (the `AuditLog` append-only trigger already exists via migration `20260902150000_prevent_audit_log_mutation`; a direct integration test against the `AuditLog` table itself is still missing).
- Affects: `docs/Action-Tracker.md` only. No code, schema, or production behavior change.
- Environment: no operator action required.
- Validation: reviewed against `tests/lib/tender-activity.integration.test.ts`, `tests/lib/payment-reversal.integration.test.ts`, `tests/lib/message-contact-release.integration.test.ts`, `.github/workflows/deploy-staging.yml`, `scripts/health-check/verify-deployment.mjs`, and `package.json`.

### 2026-09-10 - Action Tracker Reconciliation And Session-Revocation Regression Coverage

- Changed: added focused regression tests for the session-revocation and multi-role behavior in `resolveCurrentUser` (suspension, null session, and role-membership matching) and a PostgreSQL integration test proving that completing a password reset increments `sessionVersion` so a JWT issued before the reset no longer matches the account. Fixed a flaky package-ordering assertion in `tests/lib/tender-package-model.test.ts` that sorted by `createdAt` on rows inserted in the same batch (identical timestamps); it now sorts by the unique sequential `reference` field.
- Changed: confirmed and removed four stale `docs/Action-Tracker.md` entries that were already implemented and covered by existing passing tests: shared-storage rate limiting with per-account lockout (`src/server/http/rateLimit.ts`, `User.failedLoginAttempts`/`loginLockedUntil`), Provider coverage keyboard accessibility (`MultiSelectDropdown.tsx`, proven by `tests/lib/multi-select-accessibility.test.ts`), and sponsored-content separation from the Contractor decision surface (`QuoteComparison.tsx`, proven by `tests/lib/quote-comparison-advertising.test.ts`). No behavior changed for these four items.
- Affects: `tests/lib/session-role-resolution.test.ts` (new), `tests/lib/session-version-invalidation.integration.test.ts` (new), `tests/lib/tender-package-model.test.ts`, and `docs/Action-Tracker.md`. No schema, API, or production behavior change.
- Environment: no operator action required.
- Validation: `npm run type-check` and `npm test` (208 tests) pass.

### 2026-09-10 - Certificate Of Incorporation Expiry Made Optional

- Changed: Certificate of Incorporation uploads no longer require an expiry date, because the document does not expire. Every other verification document type (Public Liability Insurance, Employers Liability Insurance, Waste Carriers Licence, evidence of qualifications, Professional Indemnity Insurance, SSIP accreditation) still requires a future expiry date on upload. The Provider verification screen hides the expiry-date field for Certificate of Incorporation, and the Super User account review screen shows "Does not expire" for it instead of an expiry date.
- Affects: `VerificationDocument.expiryDate` schema/migration `20260910080000_make_verification_document_expiry_optional`, `src/lib/verification-documents.ts`, `src/lib/schemas/verificationDocument.ts`, `src/server/domain/verificationAiAssessment.ts`, `src/server/domain/verificationDocumentService.ts`, the Provider verification screen, and the Super User account review screen. Certificate of Incorporation remains optional evidence and is never part of the required-document expiry check, so verified-status expiry synchronization is unaffected.
- Environment: apply migration `20260910080000_make_verification_document_expiry_optional` through the approved staging and production migration process; it has been applied only to the configured development database.
- Validation: `npx prisma generate`, `npm run type-check`, `npm test` (203 tests), and `npm run build` pass.

### 2026-09-10 - Independent Verification Safety Competency Tiers

- Changed: independent H&S reviews now award a required Bronze, Silver, or Gold safety-competency tier when a Super User approves the review.
- Changed: the tier is persisted, shown to the User and Super User, and displayed on Contractor quote badges/tooltips as `Independently Verified · Bronze`, `Silver`, or `Gold`. The tooltip explains that the H&S professional reviewed legal-compliance evidence and safety competency, while due diligence remains the client's responsibility.
- Affects: `RetailerProfile` schema/migration `20260910070000_add_independent_review_tier`, independent review APIs/screens, Super User review controls, quote data and badges. No payment or contact-release rules changed.
- Environment: apply migration `20260910070000_add_independent_review_tier` through the approved deployment process; it has been applied only to the configured development database.
- Validation: type-check, focused policy tests, full tests (200), build, and diff validation pass.

### 2026-09-10 - Editable Super User Verification Requirement Matrix

- Changed: added an editable Verification Document Requirements matrix to Super User Settings. Super Users can activate or deactivate the mandatory requirement for each applicable document/service combination.
- Changed: the effective matrix is used server-side by verification submission, compliance-score evaluation, and expiry synchronization. Mandatory documents remain the 90% gate; applicable optional documents are reviewed only when voluntarily uploaded.
- Affects: `PlatformSetting` requirement storage, Super User settings UI/API, verification document API response, verification evaluation, expiry synchronization, and the verification policy tests. No database migration required.
- Environment: no operator action required; the default matrix preserves the current service-mapped requirements until changed by a Super User.
- Validation: type-check, lint (0 errors, 2 existing warnings), full tests (200 passing after a transient first-run failure), build, and diff validation pass.

### 2026-09-10 - Service-Mapped Verification Documents And Review Scope

- Changed: verification documents are now mapped to the services a User provides. Public Liability Insurance is mandatory for Materials, Waste, Plant Hire, Contractor Services, and Professional Services; Waste Carriers Licence is mandatory only for Waste; Professional Qualifications and Professional Indemnity Insurance are mandatory only for Professional Services. Certificate of Incorporation and Employers Liability Insurance are applicable but optional because they depend on legal-entity and employment circumstances. SSIP remains optional across services.
- Changed: verification evaluation uses mandatory documents as the 90% compliance gate and includes only applicable documents that were actually uploaded in the AI/human review report. Non-applicable and unuploaded document slots are not reviewed.
- Added: focused tests cover service mapping, legal/employment-dependent optional documents, and unrelated service exclusions.
- Affects: `src/lib/verification-documents.ts`, verification evaluation, and focused verification policy tests. No database migration required.
- Environment: no operator action required.
- Validation: type-check, lint (0 errors, 2 existing warnings), focused policy tests (3), full tests (200), build, and diff validation pass.

### 2026-09-10 - PDF Verification Upload False-Positive Repair

- Changed: narrowed active-PDF detection to complete PDF name tokens instead of arbitrary byte substrings. Legitimate certificates containing ordinary text such as `JS` or `AA` are now accepted, while actual `/OpenAction`, `/JavaScript`, `/JS`, `/AA`, embedded-file, launch, RichMedia, and XFA tokens remain blocked.
- Affects: shared attachment validation used by tender and verification-document uploads, plus focused attachment regression coverage. No security control was removed; this reduces false positives while preserving active-content rejection.
- Environment: no operator action required.
- Validation: focused attachment tests pass (4 tests), full tests pass (197 tests), type-check passes, build passes, and `git diff --check` passes.

### 2026-09-10 - Service Provision Serialization Repair

- Changed: fixed profile saves failing with `Select valid provisions for the services offered by your company` when a provision name contained commas, such as `Carpentry, Joinery & Fit-Out`. Existing comma-delimited records are reconstructed from the selected service catalogue; new profile saves and registrations store provisions as JSON arrays.
- Affects: unified client profile API and registration provisioning only. Validation rules remain unchanged; blank unchecked boxes were not the cause.
- Environment: no migration required. Existing affected records are normalized when their profile is next saved.
- Validation: the reported account's legacy provision string reconstructs to 15 valid entries; `npm run type-check`, `npm run lint` (0 errors, 2 warnings), `npm test` (196 tests), `npm run build`, and `git diff --check` pass.

### 2026-09-10 - Unified User Identity And Capability Standardization

- Changed: all non-Super User accounts are consistently treated as `USER`; Contractor and Provider now remain workflow capabilities backed by `ClientCompany`/`ClientCompanyMember` and `RetailerProfile`, not competing account roles. Seed accounts and Super User-created Users now provision both capability records, and seed membership/privilege normalization removes stale non-selected memberships and User owner/accountant flags.
- Changed: Super User account management presents one unified User population with combined tender, unlock, quote, and opportunity activity. User-facing legacy Retailer wording was replaced with Provider wording in current Contractor/User surfaces, while old route and database identifiers remain compatibility boundaries.
- Changed: Super User conversion of an existing `SUPER_USER` account into a managed User account is rejected; NextAuth role declarations and session casts now use only `SUPER_USER | USER`. Contact-release emails derive Contractor/Provider recipient wording from the party identity rather than duplicate USER role literals.
- Changed: fixed the CI Prisma-client generation order, client profile validation feedback, and the audited payment/declaration/activity tracking repairs already present in this worktree.
- Affects: unified User capability provisioning, seed data, authorization/session typing, User management UI, invitation/notification wording, CI workflow, client profile validation, payment declaration persistence, and Owner activity tracking. No existing compatibility URLs or capability database tables were destructively removed.
- Environment: migration `20260910060000_persist_verification_declaration` remains required through the approved deployment process; no new migration was required for the identity/capability standardization.
- Validation: final AI architecture/security/QA review completed; `npm run type-check`, `npm run lint` (0 errors, 2 existing warnings), `npm test` (196 tests), and `npm run build` pass.

### 2026-09-10 - Client Profile Validation Feedback

- Changed: client profile save validation now returns structured Zod field errors instead of discarding them behind the generic `Invalid profile details` response. The profile form displays validation messages beside the affected company, branch, services, service provisions, and operating-location controls.
- Affects: `/api/client/profile` validation response and the Client Profile form only. No profile validation rules were relaxed and no database or environment changes were made.
- Environment: no operator action required.
- Validation: `npm run type-check`, `npm run lint` (0 errors, 2 existing warnings), `npm test` (196 tests), and `npm run build` pass.

### 2026-09-10 - CI Prisma Client Generation Order

- Changed: the CI validation job now runs `npx prisma generate` immediately after `npm ci` and before migrations, lint, type-check, tests, and build. This fixes the CI failure where TypeScript could not resolve Prisma generated types and tests reported that the Prisma client had not initialized.
- Affects: `.github/workflows/ci.yml` validation job only. No application behavior, schema, migration, or environment resource changed.
- Environment: no operator action required.
- Validation: corrected order passes `npx prisma generate`, `npm run type-check`, and `npm test` (196 tests); `npm run lint` reports 0 errors and 2 existing warnings; `git diff --check` passes.

### 2026-09-10 - Owner Super User Online-Time And Activity Summary

- Changed: Owners now see a per-Super-User summary at the top of the Activity Log showing sessions started, completed sessions, time online, and completed platform activity for each Super User.
- Changed: the summary uses the same Activity Log filters (search, action, target type, actor role, from, and to) and the existing append-only audit records. Time online is calculated from `USER_LOGOUT` audit metadata containing `sessionSeconds`; sessions without a recorded logout remain visible as started but are not counted as completed time.
- Affects: `activityLogService.ts`, the Owner-visible Activity Log page, and new `SuperUserActivitySummary` UI. No schema migration or new tracking storage was required.
- Environment: no operator action required.
- Validation: `npm run type-check`, `npm run lint` (0 errors, 2 existing warnings), `npm test` (196 tests), and `npm run build` pass.

### 2026-09-10 - Platform Audit Repairs: Payment Idempotency, Declaration Persistence, And Lint Gate

- Changed: Stripe `payment_intent.payment_failed` events are now handled as PaymentIntent payloads and resolve the payment by its Stripe PaymentIntent ID instead of being cast as Checkout Sessions. Checkout success/failure transitions are idempotent, allow a failed payment to recover to confirmed success, and only run entitlement/audit/email side effects when the payment state actually changes.
- Changed: quote acceptance now persists `verificationDeclarationAcceptedAt`, and contact release rechecks the current Provider verification state against that persisted declaration. A Provider becoming verified after quote acceptance can no longer release contacts without the required declaration.
- Changed: repaired the lint gate by moving render-time clock reads into effects and replacing internal analytics anchors with Next.js `Link` components. Lint now reports no errors; two existing image optimization/accessibility warnings remain.
- Affects: Stripe webhook payment reconciliation, quote/contact-release workflow, Quote schema and migration `20260910060000_persist_verification_declaration`, and affected UI lint surfaces. No production resources were changed.
- Environment: apply migration `20260910060000_persist_verification_declaration` through the approved staging and production migration process. It has been applied only to the configured development database.
- Validation: `npx prisma generate`, `npx prisma migrate deploy`, `npm run type-check`, `npm run lint` (0 errors, 2 existing warnings), `npm test` (196 tests), and `npm run build` pass.

### 2026-09-10 - Materials Suppliers Added To Become Verified Eligibility

- Changed: Materials suppliers are now eligible for the "Become Verified" AI document verification and the Independent H&S Review purchase option, alongside the existing Waste, Plant Hire, Contractor Services, and Professional Services providers. Materials suppliers only need the baseline documents (Certificate of Incorporation, Public Liability Insurance, Employers Liability Insurance, and optional SSIP accreditation) — the Waste Carriers Licence and Professional Services documents remain restricted to their respective services.
- Affects: `VERIFICATION_ELIGIBLE_SERVICES` in `src/lib/categories.ts` and the eligibility-message copy on the Provider profile, verification submit route, and Independent H&S Review route/screen. No schema or migration change required.
- Environment: no operator action required.
- Validation: `npm run type-check`, `npm test` (196 tests), and `npm run build` pass.

### 2026-09-10 - Human Review Toggle, Compliance-Score Disclaimer, And Verification Analytics

- Changed: added an Owner-only `HUMAN_REVIEW_ACTIVE` toggle to Site Settings. When active (default), an AI verification request that cannot be auto-approved still queues as `PENDING` for Super User review as before. When deactivated, that same request is automatically declined instead of queuing, since no reviewer is available to decide it.
- Changed: the Provider verification screen now shows a compliance-score disclaimer explaining that uploaded documents are scored 0-100% and that a verified status requires at least a 90% compliance score, with wording that reflects whether human review is currently active.
- Changed: Super User Analytics now includes a "Quote acceptance by Provider verification status" breakdown showing quotes submitted, quotes accepted, and the acceptance ratio for Independently Verified, Verified by Ai, and Unverified Providers (a read-time grouping by the submitting Provider's current status), also included in the CSV export.
- Affects: `platformSettings.ts`, the Super User settings API/panel, the verification submission route, the Provider verification screen, `analyticsService.ts`, the Executive Dashboard, and the analytics CSV export. No schema migration required — this uses the existing `PlatformSetting` key/value store. No tender matching, payment, or contact-release behavior changed.
- Environment: no migration required; the new setting defaults to active so existing behavior is unchanged until an Owner deactivates it.
- Validation: `npx prisma generate`, `npm run type-check`, `npm test` (196 tests), and `npm run build` pass.

### 2026-09-10 - Independent H&S Review Purchase And Verified-Status Wording

- Changed: renamed the display wording of the existing document-based verification outcome from "Verified" to "Verified by Ai" on the Provider profile, verification screen, Super User account review, and Contractor quote comparison. No stored `VERIFIED` enum value changed — this is a display-only wording change.
- Changed: added a new Owner-controlled, editable-price "Independent H&S Review" purchase option. An Owner activates/deactivates the option and sets its price from Site Settings; when active and the Provider offers Waste, Plant Hire, Contractor Services, or Professional Services, a purchase banner and button appear on the Provider profile, leading to a dedicated `/retailer/independent-review` payment screen.
- Changed: on purchase confirmation the Provider receives an email confirming the purchase and that a Health & Safety professional will contact them about next steps; the account enters an `independentReviewStatus` of `PURCHASED` pending a Super User (H&S professional) approve/decline decision with optional comments.
- Changed: once approved, the Provider's quotes render with a green-tinted background for the Contractor, the badge reads "Independently Verified", and hovering it explains the company underwent an independent Health & Safety review and was deemed to meet the requirements. Accepting a quote from an independently verified (or AI-verified) Provider still requires the existing liability declaration, enforced both client- and server-side.
- Affects: new `INDEPENDENT_REVIEW` payment type and `IndependentReviewStatus` schema/migrations, `platformSettings.ts`, `paymentService.ts`, the new `independentReviewService.ts`, the Stripe webhook and dev-payment-confirmation finalizers, the Super User settings panel and account review screen, the new Provider purchase screen, and the Contractor quote-comparison view. No tender matching, unlock, or contact-release behavior changed.
- Environment: the migrations were applied only to the local development database. Staging and production require the documented environment-specific approval, backup/rollback evidence, named release owner, and post-deployment validation before migration deployment.
- Validation: `npx prisma generate`, `npm run type-check`, `npm test` (196 tests), and `npm run build` pass.

### 2026-09-10 - Document Expiry, AI Assessment, Human Review, And Quote Declaration

- Changed: every verification document upload now requires a future expiry date. A scheduled/on-read check downgrades a `VERIFIED` Provider to a new `EXPIRED` status the moment a required document's expiry date passes, removing their verified status until the document is renewed and successfully re-reviewed.
- Changed: each uploaded document is automatically assessed by a rule-based document-assessment service (no external AI/OCR provider is configured in this environment; it checks the registered company name/address against extractable document text and the expiry date, and is deliberately conservative — anything it cannot check confidently lowers the score or forces human review rather than passing automatically). Insurance certificates and the Waste Carriers Licence always require human review regardless of score. Submitting for review runs an aggregate assessment across the required documents (weakest-link confidence score); a Provider is verified automatically only when every required document is present, unexpired, and confidence is 90% or higher with no forced-review document — otherwise the request is queued as `PENDING` and every full Super User is emailed a direct link to the account review screen.
- Changed: the Super User account review screen now shows the aggregate AI confidence score and report, each document's individual AI summary/confidence/expiry, and a comments field recorded with the approve/reject decision. The AI report and per-document summaries are never returned to the Provider.
- Changed: a Contractor hovering over a "Verified Provider" badge now sees which documents were verified. Accepting a quote from a currently verified Provider requires the Contractor to check a declaration ("Trade Tender has completed reasonable measures to verify this Provider; the Contractor retains full responsibility for their own due diligence and Trade Tender accepts no liability") before the accept request is allowed to proceed; the server independently rejects acceptance of a verified Provider's quote without that declaration flag.
- Affects: `VerificationDocument`/`RetailerProfile` schema and migrations `20260910020000_add_expired_verification_status` and `20260910030000_add_document_expiry_and_ai_assessment`, the new `src/server/domain/verificationAiAssessment.ts` heuristic service, `verificationDocumentService.ts` (expiry sync, aggregate evaluation, document-verified marking), the verification submit/upload routes, the Super User account review screen, the Contractor quote-comparison view, and the quote-accept route/service. No tender matching, payment, or contact-release behavior changed.
- Environment: the migrations were applied only to the local development database. Staging and production require the documented environment-specific approval, backup/rollback evidence, named release owner, and post-deployment validation before migration deployment.
- Validation: `npx prisma generate`, `npm run type-check`, `npm test` (196 tests), and `npm run build` pass.

### 2026-09-10 - Provider Verification Document Upload Screen

- Changed: the "Become Verified" button on the Provider profile now opens a dedicated `/retailer/verification` screen listing every evidence document applicable to that Provider's services: Certificate of Incorporation, Public Liability Insurance, and Employers Liability Insurance for every eligible Provider; Waste Carriers Licence for Waste Providers; evidence of qualifications and Professional Indemnity Insurance for Professional Services Providers; and optional SSIP accreditation evidence for all. Each document is uploaded and replaced through its own independent request, so a Provider can complete the checklist one item at a time, and the screen marks which documents are required, optional, and already uploaded before allowing the existing verification request to be submitted.
- Changed: a Super User reviewing a pending verification request can now see and download the uploaded evidence files from the existing account review screen before approving or rejecting.
- Affects: new `VerificationDocument` model and migration `20260910010000_add_provider_verification_documents`, new `POST`/`GET` `/api/retailer/verification/documents` and `GET`/`DELETE` `/api/retailer/verification/documents/[documentType]` routes, new `GET` `/api/super-user/retailers/[id]/verification-documents(/[documentType])` routes, the new Provider verification screen, and the Super User account review screen. Uploaded files reuse the existing tender-attachment file-signature and size validation (PDF/JPEG/PNG, 10 MiB). No tender matching, payment, unlock, or contact-release behavior changed.
- Environment: the migration was applied only to the local development database. Staging and production require the documented environment-specific approval, backup/rollback evidence, named release owner, and post-deployment validation before migration deployment.
- Validation: `npx prisma generate`, `npm run type-check`, `npm test` (196 tests), and `npm run build` pass.

### 2026-09-10 - Provider Verification Status On Profile And Quotes

- Changed: Providers offering Waste, Plant Hire, Contractor Services, or Professional Services can request account verification from a banner at the top of the Provider profile ("Become Verified"). The banner shows Unverified, Pending review, Verified, or Not approved status. A Super User approves or rejects a pending request from the existing account review screen.
- Changed: every quote a Contractor sees on the tender quote-comparison banner now shows the submitting Provider's verification status (Verified Provider, Verification pending, or Unverified Provider), sourced from the Provider's own profile record at read time.
- Affects: `RetailerProfile` schema (`verificationStatus`, `verificationRequestedAt`, `verificationDecidedAt`, `verificationNote`) and migration `20260910000000_add_provider_verification_status`, new `POST /api/retailer/verification` request route, Super User approve/reject actions on `PATCH /api/super-user/users/[id]`, the Provider profile page, the Super User account review screen, and the Contractor quote-comparison view. No tender matching, payment, unlock, or contact-release behavior changed.
- Environment: the migration was applied only to the local development database. Staging and production require the documented environment-specific approval, backup/rollback evidence, named release owner, and post-deployment validation before migration deployment.
- Validation: `npx prisma generate`, `npm run type-check`, `npm test` (196 tests), and `npm run build` pass.

### 2026-09-08 - Structured Support Triage And Information Requests

- Changed: Super Users can select a triage category and escalation level for each support request, record a structured triage note, and request additional information from the requester.
- Changed: information requests move to `INFORMATION_REQUESTED`, are audit logged, and send the requester an email explaining the question with a link back to Support requests. Existing Owner-only privacy resolution and change approval rules remain enforced.
- Affects: SupportRequest schema and migration, Super User triage API/UI, requester notifications, and audit records only. Payment, contact release, authentication, and environment configuration remain unchanged.
- Environment: apply migration `20260908120000_add_support_triage_fields` through the approved staging and production migration process before enabling structured triage outside local development.
- Validation: `npx prisma validate`, engine-less Prisma type generation, `npm run type-check`, and `git diff --check` pass.

### 2026-09-06 - Privileged TOTP MFA Workflow

- Changed: active NextAuth login now supports TOTP MFA for Super User accounts, with QR enrollment, encrypted secret storage, one-time recovery codes, login challenge verification, disable flow, audit events, and session invalidation when MFA settings change.
- Changed: the protected Security page is available from the authenticated navigation. MFA is implemented against the current NextAuth authority; the staged Clerk setup remains a future authentication migration boundary.
- Affects: User MFA schema and migration, active credentials login, protected MFA API/UI, navigation, session invalidation, and authentication audit records only. Business workflows, payment controls, and production environment configuration remain unchanged.
- Environment: apply migration `20260906110000_add_mfa` through the approved staging and production migration process. `NEXTAUTH_SECRET` must be configured and protected because it derives the MFA encryption key.
- Validation: `npx prisma validate`, engine-less Prisma type generation, `npm run type-check`, `npm audit --audit-level=high`, MFA helper tests, and `git diff --check` pass.

### 2026-09-06 - Cyber Essentials Readiness Evidence

- Changed: CI now runs a dedicated high-severity dependency audit using `npm audit --audit-level=high`.
- Changed: added `docs/Cyber-Essentials-Readiness.md` to distinguish implemented application controls from the hosting, endpoint, account, firewall, patching, backup, and assessment evidence still required. The repository makes no Cyber Essentials certification claim.
- Affects: CI security validation and readiness documentation only. No production resource, provider setting, credential, or environment configuration was changed.
- Validation: local `npm audit --audit-level=high` reports zero vulnerabilities.

### 2026-09-06 - Centralised Launch Defaults And Profile Credit Allocation

- Changed: inline launch-credit and release-credit editors have been removed from account list rows. Owners define the default launch-credit balance for newly created Provider profiles in Super User Settings.
- Changed: Super Users assign an individual account's tender-release credits or quote-acceptance release credits from the protected User profile. Existing balances are preserved when the default changes.
- Affects: platform settings, new Provider profile creation, protected User profile credit controls, account management list UI, and existing credit audit routes only. Credit consumption and payment rules remain unchanged.
- Environment: no migration or environment configuration change is required.
- Validation: `npm run type-check`, `npx tsx --test tests/lib/user-profile-provider-options.test.ts`, and `git diff --check` pass.

### 2026-09-06 - Safe-Release Compensation For Held Content

- Changed: Super Users must choose either `Confirm hold` or `Release as safe` when recording a moderation outcome. A safe release awards five existing usable credits to the submitting account: Provider profiles receive tender-unlock credits and Contractor profiles receive accepted-quote release credits.
- Changed: compensation is awarded transactionally, recorded on the moderation event, and cannot be awarded twice for the same review. The submitting user receives an outcome email with the review note and compensation result; the configured support address remains the Reply-To destination.
- Affects: ModerationEvent schema and migration, Super User moderation review API/UI, existing Provider/Contractor credit balances, and outcome notifications only. Held content remains subject to the recorded moderation decision and no automatic account action is taken.
- Environment: apply migration `20260906100000_add_moderation_review_compensation` through the approved staging and production migration process before using safe-release compensation outside local development.
- Validation: `npx prisma validate`, engine-less Prisma type generation, `npm run type-check`, existing content-moderation tests, and `git diff --check` pass.

### 2026-09-06 - Retain Held Tender Drafts For Super User Review

- Changed: blocked or held tender submissions, quote submissions, and tender comments now retain a complete review snapshot on the moderation event before the content is rejected, including the submitted content, associated tender fields, item/package data, and attachment content. Allowed submissions continue to retain only moderation event metadata.
- Changed: the submitting user receives an operational email explaining that the content was held and listing the detected reason(s). Email delivery is best-effort and cannot allow held content through or alter the moderation decision.
- Changed: held-content emails use the Owner-configured support recipient as the Reply-To address and invite the user to reply if they believe the hold was a mistake. If no recipient is configured, the email remains best-effort without a Reply-To override.
- Changed: the protected Super User moderation panel can expand the retained tender, quote/comment, and attachment data when recording the review. Held content is not exposed to Contractors, Providers, or public routes.
- Affects: ModerationEvent schema and migration, tender/message/quote moderation, and Super User compliance review UI only. Tender matching, ordinary tender persistence, payment, and environment configuration remain unchanged.
- Environment: apply migration `20260906090000_retain_held_content_snapshot` through the approved staging and production migration process before relying on held-content review outside local development.
- Validation: `npx prisma validate`, engine-less Prisma type generation, `npm run type-check`, existing content-moderation tests, and `git diff --check` pass.

### 2026-09-06 - One-Day Default User Activity View

- Changed: Super User account profiles now show only the previous 24 hours of page visits and audit actions by default. A protected profile filter can search the previous 7, 30, or 90 days, or all retained activity.
- Changed: activity filtering is applied server-side before records are returned; existing authorization, retention, and record limits remain in force.
- Affects: Super User account profile activity queries and UI only. User activity capture, retention policy, payment, tender, and environment configuration remain unchanged.
- Environment: no migration or environment configuration change is required.
- Validation: `npm run type-check`, `git diff --check`, and `npx tsx --test tests/lib/user-activity-period.test.ts` pass.

### 2026-09-06 - Membership Purchase Contract Terms

- Changed: Provider membership purchases require a 6- or 12-month non-refundable contract selection before checkout. The selected term is persisted with the pending payment, so the Stripe confirmation path cannot lose the contract choice.
- Changed: membership start date is the confirmed payment time and expiry is automatically calculated from the selected calendar term. The resulting assignment dates are available in the protected Super User profile view.
- Affects: membership purchase UI/API, Payment and RetailerMembership schema and migrations, payment confirmation, and membership audit metadata only. Membership pricing, additional-credit discounts, and environment configuration remain unchanged.
- Environment: apply migrations `20260906070000_add_membership_assignment_expiry` and `20260906080000_add_membership_contract_term` through the approved staging and production migration process before enabling this workflow outside local development.
- Validation: `npx prisma validate`, engine-less Prisma type generation, `npm run type-check`, `npx tsx --test tests/lib/membership-contract-term.test.ts tests/lib/membership-additional-credit-discount.test.ts`, and `git diff --check` pass.

### 2026-09-06 - Membership Assignment Start And Expiry Dates

- Changed: Super Users assigning a membership tier from a Provider account profile must choose a start date and a default expiry term of 6 or 12 months. The server calculates and stores the calendar expiry date.
- Changed: active membership profiles display their start and expiry dates to authorised Super Users, and expired assignments no longer grant membership credits or benefits.
- Affects: RetailerMembership schema and migration, protected Provider profile entitlement API/UI, membership availability, and unlock-credit eligibility only. Subscription assignments, payments, tender matching, and environment configuration remain unchanged.
- Environment: apply migration `20260906070000_add_membership_assignment_expiry` through the approved staging and production migration process before using assignment expiry outside local development.
- Validation: `npx prisma validate`, engine-less Prisma type generation, `npm run type-check`, and `git diff --check` pass.

### 2026-09-06 - Membership Discounts On Additional Provider Unlocks

- Changed: after an active membership's inclusive monthly credits are exhausted, every subsequent Provider tender unlock uses that tier's configured additional-credit discount percentage. The discount is calculated server-side when the pending payment is created and therefore applies to the stored amount, VAT calculation, and Stripe checkout amount.
- Changed: users without an active membership, or before their inclusive credits are exhausted, continue through the existing standard unlock-credit or standard-fee path. Client input cannot choose or override the discount.
- Affects: Provider unlock payment creation and membership allowance handling only. Membership purchases, contact release, tender matching, and environment configuration remain unchanged.
- Environment: no additional migration or environment configuration is required beyond `20260906060000_add_membership_credit_discount`.
- Validation: `npm run type-check` and `npx tsx --test tests/lib/membership-additional-credit-discount.test.ts` pass. Database-backed membership integration tests are blocked locally by Prisma engine/database configuration drift.

### 2026-09-06 - Editable Membership Tier Credit Terms

- Changed: Owners can edit each membership tier's monthly price, inclusive monthly credits, and discount percentage for additional credits from Super User Settings. New membership tiers require all three commercial values.
- Changed: existing membership-tier values are no longer reset by default-tier bootstrap when settings are loaded. Additional-credit discount is stored for the tier and exposed to the protected Owner management surface.
- Affects: MembershipTier schema and migration, membership default initialisation, Owner settings API/UI, and membership tier administration only. Payment, tender matching, unlock eligibility, and environment configuration remain unchanged.
- Environment: apply migration `20260906060000_add_membership_credit_discount` through the approved staging and production migration process before using the new field outside local development.
- Validation: `npx prisma validate` and `npm run type-check` pass. Membership integration tests remain blocked locally because the database does not contain the previously required `User.termsVersion` column. Standard Prisma engine generation remains blocked by a Windows file lock; engine-less Prisma type generation succeeded.

### 2026-09-06 - Provider Options In Super User Account Profiles

- Changed: membership and subscription options for Providers are now assigned from the protected Super User account-profile view for the individual User, rather than from the general Site Settings page.
- Changed: Site Settings no longer loads Provider account or entitlement data. Provider users cannot view or manage these assignments; the existing full Super User authorization, origin validation, and audit events remain enforced by the entitlement API.
- Affects: Super User account profile data/view, Site Settings data loading, and membership or subscription entitlement assignment only. Payment, quote ranking, tender matching, contact release, and environment configuration remain unchanged.
- Environment: no migration or environment configuration change is required.
- Validation: `npx tsx --test tests/lib/user-profile-provider-options.test.ts` and `npm run type-check` pass.

### 2026-09-06 - Sponsored Placement One-Month Term

- Changed: a confirmed sponsored-placement purchase now receives a server-calculated expiry one calendar month after the purchase date. The calculation preserves the purchase time and safely clamps month-end dates.
- Changed: expired sponsored placements no longer appear as active in Provider status or quote-page sponsored display. Existing historic placements without an expiry remain unchanged.
- Affects: Retailer Sponsored Placement schema and migration, confirmed payment entitlement finalisation, Provider sponsored-placement status, and quote display only. Quote ranking, tender matching, payment amount, contact release, and environment configuration remain unchanged.
- Environment: apply migration `20260906050000_add_sponsored_placement_expiry` through the approved staging and production migration process before enabling expiry enforcement outside local development.
- Validation: `npx prisma validate`, `npx tsx --test tests/lib/sponsored-placement-expiry.test.ts`, and `npm run type-check` pass. Local Prisma Client regeneration is blocked by a Windows query-engine file lock.

### 2026-09-06 - Partner Campaign Expiry

- Changed: Partner Management now accepts an optional campaign expiry date when a Super User creates or edits a partner record. A blank date keeps the partner active until manually changed or deactivated.
- Changed: public footer partner display excludes active partners whose expiry date has passed; expired records remain available to authorised Super Users for campaign history and audit review.
- Affects: Partner schema and migration, Super User partner management, and public footer partner display only. Tender matching, quote comparison, payment, contact release, and environment configuration remain unchanged.
- Environment: apply migration `20260906040000_add_partner_expiry` through the approved staging and production migration process before enabling expiry enforcement outside local development.
- Validation: `npx prisma validate`, `npx tsx --test tests/lib/partner-schema.test.ts tests/lib/site-footer-partners.test.ts` (5 tests), and `npm run type-check` pass. Local Prisma Client generation is blocked by a Windows query-engine file lock.

### 2026-09-06 - High-Risk Tender Review And Warning Workflow

- Changed: full Super Users can open Tender Management review pages only for tenders that still meet the existing high-severity tender-compliance criteria. Review pages exclude attachments, messages, payments, and contact-release data.
- Changed: a full Super User may issue an append-only warning only after the server rechecks the tender's high-risk status. The recipient is derived from the tender owner; a required reason and review note are validated server-side. The warned user sees active warnings only in their own authenticated profile; authorized Super Users can see warning history in the protected account profile.
- Changed: when a user reaches exactly three active warnings, every active Owner receives a minimal notification with an authenticated link to the warned account. The Owner-configured support recipient also receives one only when it is not already an active Owner address. No suspension is automatic; only an Owner can suspend or reactivate a User through the account-status decision path.
- Affects: Tender Warning schema and migration, protected Super User tender review/warning APIs, user and Super User profile views, email notifications, and audit records. Tender matching, risk thresholds, payments, contact release, and environment configuration remain unchanged.
- Environment: apply migration `20260906030000_add_tender_warnings` through the approved staging and production migration process before enabling this workflow outside local development. Resend `RESEND_API_KEY` and `EMAIL_FROM` must be configured for notification delivery. No configuration values were changed.
- Validation: `npx prisma validate`, `npx tsx --test tests/lib/tender-warning-workflow.test.ts`, and `npm run type-check` pass. `npx prisma generate` is blocked locally by an `EPERM` lock on the Prisma Windows query-engine binary.

### 2026-09-06 - High-Risk Tender Owner Notification

- Changed: a tender owner receives a non-sensitive email when their tender reaches the existing high-risk near-duplicate threshold. The notification directs the owner to the authenticated workspace without exposing compliance detection details.
- Changed: successful and failed notification attempts are audit logged and successful notifications are idempotent per tender.
- Affects: tender creation/update notifications and audit records only. Compliance thresholds, tender visibility, payment, contact release, database schema, and environment configuration remain unchanged.
- Environment: Resend `RESEND_API_KEY` and `EMAIL_FROM` must be configured in the applicable environment for delivery. No configuration values were changed.
- Validation: `npx tsx --test tests/lib/tender-high-risk-notification.test.ts tests/lib/compliance-monitoring.test.ts` passes (9 tests); `npm run type-check` passes.

### 2026-09-06 - High-Risk Tender Management Filter

- Changed: Super User Tender Management now lists only tenders with a high-severity, tender-targeted flag from the existing 30-day compliance monitoring workflow.
- Affects: Super User Tender Management presentation only. Tender data, compliance detection thresholds, payments, contact release, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/tender-management-risk-filter.test.ts` and `npm run type-check` pass.

### 2026-09-06 - Registration Service Provision Selection

- Changed: registration now supports optional second-tier service provision selection for every selected service and validates each provision against the selected service catalogue. Deselecting a service clears its dependent provision selections.
- Changed: removed Coverage towns from public and Super User account-creation inputs. Legacy `coverageAreas` storage remains blank for compatibility and no longer receives new registration data.
- Affects: registration validation, initial company profile provisions, and account-creation inputs only. Existing profiles, tender matching, payments, contact release, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npm run type-check` and `npx tsx --test tests/lib/registration-service-provisions.test.ts` pass (3 tests).

### 2026-09-06 - Owner-Scoped Payment Waivers

- Changed: added Owner-only, per-user payment waivers for `RETAILER_UNLOCK` and `CLIENT_RELEASE`, with a required grant reason, optional expiry, revocation reason, and use history. Each use creates a confirmed zero-value payment linked to the waiver before granting the existing unlock or contact-release entitlement; grants, revocations, and uses are audit logged.
- Affects: Payment Waiver schema and migration, payment entitlement services, Owner Console, and Owner-only management APIs. Waivers do not weaken authentication, eligibility, tender ownership, quote ownership, or contact-release authorization checks.
- Environment: apply migration `20260906010000_add_payment_waivers` through the approved staging and production migration process before enabling this workflow outside local development.
- Validation: `npx prisma validate`, `npx tsx --test tests/lib/payment-waiver.test.ts`, `npm run type-check`, and `npm run build` pass. `npm test` has 172 passing and 7 failing tests: six payment-related integration tests require the pending migrations in the test database, while one membership-pricing test fails because membership tiers are disabled.

### 2026-09-06 - Support And Change Request Workflow

- Changed: added authenticated User support, change, payment, and data/privacy requests; Super Users can triage and resolve requests, while only Owners can approve or reject change requests. Submission and review decisions are audit logged.
- Affects: Support Request schema and migration, User and Super User portal navigation/screens, authenticated request APIs, and audit records. No tender, payment, contact-release, or environment resource is changed.
- Environment: apply migration `20260906000000_add_support_requests` through the approved staging and production migration process before enabling the workflow outside local development.
- Validation: `npx prisma validate`, `npm run type-check`, and `npx tsx --test tests/lib/support-request.test.ts` pass.

### 2026-09-06 - Owner-Configured Support Request Notifications

- Changed: Owners can configure or clear one server-validated support recipient email through Site Settings. The configured address is returned only to Owners; normal Users and non-Owner Super Users cannot read it.
- Changed: each submitted support request attempts a Resend notification containing only request type, submission time, and an authenticated review link. Requester identity, request content, tender, contact, payment, and secret data remain excluded. Delivery is recorded as sent, failed, or skipped without storing the recipient address or provider failure detail in audit metadata.
- Affects: Owner-only platform settings, support request notification delivery, and append-only audit records. No tender, payment, contact-release, or environment resource is changed.
- Environment: configure the support recipient through the Owner Site Settings UI after Resend `RESEND_API_KEY` and `EMAIL_FROM` are available for the applicable environment. No secret or recipient value is committed.
- Validation: `npx tsx --test tests/lib/support-request.test.ts`, `npm run type-check`, and `npm run build` pass.

### 2026-09-06 - Tender Confidentiality And Release-Reversal Hardening

- Changed: removed the persistent Contractor Trade Tender ID from pre-unlock Provider API responses, opportunity summaries, Provider tender views, and notification emails. Tender references remain the only pre-unlock identifier.
- Changed: contact release creation now checks the authorising payment inside a serializable transaction, and contact retrieval requires the authorising payment to remain confirmed. A refund or dispute therefore prevents both new and existing contact access.
- Affects: staged tender anonymity and payment-authorised contact release only. Tender matching, pricing, quote acceptance, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/tender-opportunity-privacy.test.ts` passes (2 tests); `npx tsx --test tests/lib/payment-reversal.integration.test.ts` passes (4 tests).

### 2026-09-06 - Candidate Construction Brand Promotion

- Changed: promoted the Founder-approved candidate horizontal lockup to the active serving asset and applied it to application logo surfaces. Navy footer placement now provides the required light logo panel because the approved candidate pack has no dark-background lockup.
- Changed: updated the active Steel Blue token to `#2F5D7C` and revised the machine-readable brand authority and source-asset record to the new Construction Edition Brand Guide.
- Affects: application logo presentation, shared visual tokens, and brand documentation only. Authentication, authorization, tender matching, payments, contact release, database schema, and environment configuration remain unchanged.
- Environment: no operator action required. The previous logo assets remain in the repository as non-active source material.
- Validation: `npm run type-check` and `npx next build` pass. Browser verification confirms the candidate lockup renders in the public header and the Navy footer uses its required light panel. The standard `npm run build` could not rerun because a local development server holds the Prisma engine lock.

### 2026-09-06 - Staging Integration Test Repairs

- Changed: restored the approved `sky-blue` Tailwind token while preserving the existing `hi-viz-tint` compatibility alias, and completed MultiSelectDropdown combobox keyboard semantics by closing the list on Escape.
- Changed: restored fail-closed null and suspension handling in the merged browser/mobile session resolver before checking session version or role memberships.
- Affects: shared visual token naming, multi-select accessibility, and server-side session authorization only. Tender matching, payments, contact release, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npm test` passes with 171 tests; `npm run type-check` passes; focused brand-token, multi-select, mobile-token, and session-revalidation tests pass (9 tests).

### 2026-09-06 - Clerk Development Application Linkage

- Changed: installed the Clerk CLI, authenticated the local operator, linked this repository to the designated Clerk application, and pulled the development-only Clerk environment configuration. `@clerk/nextjs` and the root `ClerkProvider` were already present.
- Changed: extended the application Content Security Policy to allow Clerk-hosted account scripts, session connections, frames, and the same-origin blob worker required by the hosted sign-in interface. The CSP adds `unsafe-eval` only during local `next dev` execution because React development diagnostics require it; production remains strict. Clerk telemetry remains blocked by the existing minimised `connect-src` policy.
- Affects: local development authentication configuration only. Existing NextAuth database-backed sessions, User role memberships, suspension checks, password-reset flow, route proxy, payment/contact-release authorization, and audit logging remain the authoritative application controls.
- Environment: Clerk development instance `ins_3IxnnKC85ooanB8HxbLvAa5G4sJ` is linked locally. No staging or production/main resource, secret, permission, user record, authentication policy, or deployment configuration was changed. A Clerk production instance must be explicitly provisioned and approved before deployment.
- Validation: `clerk doctor --json`, `npm run type-check`, and `npm run build` pass. The local production server renders the Clerk sign-in control and sign-up link without Clerk CSP errors. Webpack development mode serves the React development CSP exception correctly; Turbopack currently crashes internally while compiling the Clerk sign-in route. The only advisory is that no production Clerk instance is configured. Full application migration remains outstanding because replacing NextAuth requires an approved user-identity and role-data migration plan.

### 2026-09-05 - Mobile Stress-Test Release Gate

- Changed: added `npm run mobile-stress-test`, which assesses Android and iOS staging origins, validates the mobile security contract, consumes protected real-device evidence, and produces crash, performance, battery, security, network-resilience, recommendations, and launch-readiness reports. Production deployment now depends on this fail-closed gate and uploads its reports.
- Affects: mobile release assessment and production deployment gating only. Application business logic, database data, payment provider configuration, and external environment resources remain unchanged.
- Environment: configure protected staging URLs and `MOBILE_STRESS_DEVICE_EVIDENCE` only after real Android/iOS testing. Evidence must not claim results not measured on real devices or a managed device farm.
- Validation: `npx tsx --test tests/lib/mobile-stress-test.test.ts` passes; `npm run health:validate-workflows` validates 9 workflows. An unconfigured local run generates reports and correctly exits `FAIL`.

### 2026-09-05 - Native Mobile Security And Workflow Completion

- Changed: added versioned mobile bearer tokens revoked on password changes, bearer-only mobile logout, interactive Provider opportunity access, fixed-scheme validated payment return handling, explicit mobile registration consent, and mobile CI type/configuration checks.
- Affects: native authentication, authorization, tender opportunities, unlock/payment return, registration consent, and CI only. Payment confirmation and contact release remain server-authoritative; no database credential, payment secret, or external environment resource was changed.
- Environment: apply migration `20260905050000_add_mobile_auth_version` through the approved environment process. The working-name deep-link scheme is for internal testing only and must be reviewed with final mobile identity before release.
- Validation: mobile type check and package tests pass; Expo Doctor reports 21/21 checks; `npm run health:validate-workflows` passes; focused mobile token/session tests pass.

### 2026-09-05 - Session Claim Revalidation Coverage

- Changed: extracted the current-account authorization decision into a focused resolver while retaining database reload for browser and mobile sessions.
- Affects: server-side session authorization only. Account roles, payment controls, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/session-revalidation.test.ts` passes (3 tests), covering suspended accounts, removed roles, and refreshed claims.

### 2026-09-05 - Mandatory High-Risk Staging Attestation

- Changed: staging deployment verification now fails unless the protected workflow supplies the exact high-risk-controls attestation. A successful staging record therefore includes explicit evidence for payment/webhook reconciliation, audit logging, email delivery, and monitoring checks that cannot be proven by an unauthenticated probe.
- Affects: staging deployment workflow and release evidence only. Application behavior, database schema, payments, and user data remain unchanged.
- Environment: staging approvers must verify the required provider-side evidence and enter the documented attestation before a successful staging record can be created.
- Validation: `npx tsx --test tests/lib/deployment-high-risk-attestation.test.ts` passes; `npm run health:validate-workflows` validates 9 workflow files.

### 2026-09-05 - Quote Comparison Advertising Separation

- Changed: removed sponsored quote placement from the quote comparison decision surface. Partner advertising remains available only through existing, clearly labelled partner-information surfaces outside ranking and supplier selection.
- Affects: Contractor quote comparison presentation and advertising separation only. Quote sorting, acceptance, payment, contact release, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/quote-comparison-advertising.test.ts tests/lib/site-footer-partners.test.ts` passes (3 tests).

### 2026-09-05 - Native Mobile Client Foundation

- Changed: replaced the uncommitted PWA direction with a standalone Expo/React Native TypeScript package in `mobile/`, configured for Android and iOS package builds with the approved working name and EAS build profiles. React Native with Expo is now the mandatory method for all mobile-client work; Flutter, PWA, Capacitor, browser wrappers, and WebViews are excluded unless explicitly approved by the user.
- Affects: native mobile packaging, account setup, sign-in, secure session storage, profile read/update, tender creation and summary/detail, pre-unlock opportunity, unlock, quote entry/submission, quote acceptance, server-issued payment handoff, and server-confirmed contact display. The server now issues and validates a short-lived mobile bearer token while reloading current authorization state. Database schema, payment logic, and contact-release controls remain unchanged.
- Environment: use Node 22.13 or later in `mobile/`; do not externally register the working-name Android or iOS package identifiers, configure release signing, or publish a store listing before final product-identity approval. Configure only the public HTTPS mobile API origin in `EXPO_PUBLIC_API_URL`.
- Validation: `npx tsc --noEmit` and `npx expo-doctor` pass in `mobile/` (21/21 checks); `npx tsx --test tests/lib/mobile-token.test.ts` passes (4 tests). Device builds, full workflow parity, and external release configuration remain pending.

### 2026-09-05 - Source Staging Synchronization Policy

- Changed: defined the source synchronization workflow so an explicit request to track or synchronize the source repository fetches, reviews, and transposes applicable differences from `origin/staging` into local `staging`. Local `main` may then be promoted only from local `staging` through the protected pull-request and release workflow.
- Affects: repository governance, Git branch synchronization, and release workflow only. Application behavior, database schema, payments, contact-release controls, and environment configuration remain unchanged.
- Environment: local `staging` tracks `origin/staging`. No deployment, production resource, or secret change is required.
- Validation: instruction changes pass `git diff --check`; the `staging` branch continues to track `origin/staging`.

### 2026-09-05 - Test Database Role Realignment

- Changed: added migration `20260905040000_realign_test_roles_with_user_platform` to return the configured test database from the temporary Contractor/Provider recovery state to the current staging User role model. It preserves Super Users and normalizes all other role values to User.
- Affects: configured test database role enum and UserRole memberships only. Tender, company, profile, quote, payment, contact-release, audit, and role-recovery backup records remain unchanged.
- Environment: applies only to the configured test database. No production/main resource or secret is changed.
- Validation: local `npx prisma migrate deploy` applied the migration; the test database now has 10 Users and 2 Super Users. `npx prisma validate`, `npm run type-check`, and `npm run build` pass. Deploy staging after committing this migration, then verify login on the staging service.

### 2026-09-05 - Professional Services Interest Workflow

- Changed: Professional Services tender opportunities now use a Register interest action instead of a paid unlock and formal quote. The server accepts interest only for a matching company with Professional Services active and while the tender remains open.
- Changed: the professional interest record is unique per User and tender, creates no payment, and permits contact access only after the tender deadline. The release is audit logged. Material, waste, plant, contractor-service, and other tender packages retain their existing unlock and quote controls.
- Affects: Prisma `ProfessionalInterest` schema and migration `20260905020000_add_professional_interests`, Professional Services tender detail UI, server authorization, and interest-release audit trail. No existing quote, payment, or contact-release record is changed.
- Environment: migration was applied only to the local development database. Staging and production migration deployment requires the documented environment approval, backup/rollback evidence, named release owner, and post-deployment validation.
- Validation: local `npx prisma migrate deploy` applied the migration; `npx tsx --test tests/lib/professional-interest.integration.test.ts` passes (1 test); `npm run type-check` and `npm run build` pass.

### 2026-09-05 - Category-Scoped Tender Opportunity Access

- Changed: User opportunity summaries, pre-unlock details, unlocked tender packages, and quote lines are now limited to the active service categories in the User's company profile. For example, a Materials Supplier sees only Materials packages from a mixed tender.
- Changed: tender-wide attachments are withheld from opportunity recipients because they cannot safely be assigned to a specific service category. Tender owners retain authorized attachment downloads.
- Affects: tender opportunity visibility, unlocked detail, quote validation, and attachment authorization. Existing tender records, references, payment records, contact-release controls, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/tender-package-model.test.ts tests/lib/tender-attachment-access.integration.test.ts` passes (5 tests); `npm run type-check` passes.

### 2026-09-05 - Company Coverage Controls Opportunity Matching

- Changed: corrected tender opportunity matching to use the company profile's operating locations as the authoritative coverage source, instead of stale legacy per-user county/region settings. Company services and company locations now jointly control creation, visibility, and unlock eligibility for opportunities.
- Affects: tender matching, opportunity visibility, and unlock eligibility only. Tender records, payment amounts, contact release, database schema, and environment configuration remain unchanged.
- Environment: refreshed the affected local Sinclair Safety Solutions account against active tenders. No staging or production resources were changed.
- Validation: `npx tsx --test tests/lib/tender-schema.test.ts tests/lib/client-company.test.ts` passes (34 tests); `npm run type-check` passes. Local verification confirms 5 visible eligible opportunities for the affected account.

### 2026-09-05 - Automatic Opportunity Refresh After Profile Updates

- Changed: saving a primary company profile now synchronizes selected services and operating locations to the matching eligibility record, then immediately evaluates active tenders for newly eligible opportunities. United Kingdom selection correctly maps to UK-wide matching coverage.
- Affects: company profile save and active tender matching only. Existing matches, tender identifiers, payments, contact release, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/client-company.test.ts` passes (6 tests); `npm run type-check` passes.

### 2026-09-05 - Select All Company Service Provisions

- Changed: each company service-provision group now provides a Select all action, which changes to Clear all when every provision in that service group is selected. The action affects only its own service group.
- Affects: primary company profile selection user interface only. Stored profile values, tender matching, payments, contact release, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/client-company.test.ts` passes (5 tests); `npm run type-check` passes.

### 2026-09-05 - United Kingdom Company Operating Location

- Changed: added United Kingdom as a selectable operating location in the primary company User profile, alongside individual regions and counties. The profile API validates and stores this selection.
- Affects: company profile operating-location options only. Tender matching, payments, contact release, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/client-company.test.ts` passes (4 tests); `npm run type-check` passes.

### 2026-09-05 - Spaced Phone Number Moderation Hardening

- Changed: strengthened client-side warnings and mandatory server-side content moderation to detect UK phone numbers written with separators or spaces between individual digits. Such contact information now blocks tender submission rather than relying on an AI assessment.
- Affects: tender and message content moderation only. No database schema, payment, matching, contact-release, or environment configuration change is required.
- Environment: no operator action required. An optional AI classifier may later add a non-authoritative review signal, but deterministic server moderation remains the required block control.
- Validation: `npx tsx --test tests/lib/content-moderation.test.ts` passes (8 tests); `npm run type-check` passes.

### 2026-09-05 - Tender Workflow Fast Travel

- Changed: completed tender-builder workflow steps are now clickable in the desktop progress header. Users can jump back to any previously visited section without losing entered data; future uncompleted steps remain unavailable.
- Affects: tender-builder progress navigation and in-memory wizard state only. Tender submission payloads, server validation, matching, payments, contact release, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/client-tender-builder.test.ts tests/lib/stepper-fast-travel.test.ts` passes (2 tests); `npm run type-check` passes.

### 2026-09-05 - Separate Project And Primary Item Specifications

- Changed: separated project-wide Additional information from the primary tender item's Item specification. Project information remains attached to the parent tender; the primary item specification is now stored only on its tender item and package, matching added items.
- Affects: tender-builder form state, create-tender input validation, moderation input, primary tender-item/package persistence, review display, re-tender prefill, and related integration fixtures. No database schema migration, matching, payment, contact-release, or environment configuration change is required.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/client-tender-builder.test.ts tests/lib/tender-schema.test.ts` passes (29 tests); `npx tsx --test tests/lib/tender-package-model.test.ts` passes (4 tests); `npm run type-check` passes.

### 2026-09-05 - Primary Tender Item Specification Field

- Changed: added the optional Item specification field to the primary tender package, matching the comments/specification input available for every added package.
- Affects: tender-builder primary package interface only. The field uses the existing primary tender description payload and server validation; matching, payments, contact release, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/client-tender-builder.test.ts` passes (1 test); `npm run type-check` passes.

### 2026-09-05 - Grouped Tender Review Sections

- Changed: organized Review and Submit into separated Project Details, Tender Packages, Additional Requirements, and Attachments sections. Each section has one Edit action that returns the User to the associated builder step.
- Affects: tender-builder review interface and in-memory wizard navigation only. Tender submission payloads, server validation, matching, payments, contact release, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/client-tender-builder.test.ts` passes (1 test); `npm run type-check` passes.

### 2026-09-05 - Preserve Tender Data After Review Edits

- Changed: returning from Review and Submit to Project Details no longer reinitializes later tender package inputs. Existing package, requirement, upload, and review data remains intact unless the User changes the selected service groups, which intentionally rebuilds the package list.
- Affects: tender-builder in-memory wizard state only. Tender submission payloads, server validation, matching, payments, contact release, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/client-tender-builder.test.ts` passes (1 test); `npm run type-check` passes.

### 2026-09-05 - Tender Review Edit Actions

- Changed: added Edit actions to every tender review item. Project inputs return to Project Details, package inputs reopen the correct package screen, requirements return to Additional Requirements, and attachments return to Upload Files.
- Affects: tender-builder review interface and in-memory wizard navigation only. Tender submission payloads, server validation, matching, payments, contact release, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/client-tender-builder.test.ts` passes (1 test); `npm run type-check` passes.

### 2026-09-05 - Compact Additional Requirements Layout

- Changed: displayed the tender Additional Requirements options in a responsive two-column grid on small and larger screens, while retaining a single column on narrow mobile screens.
- Affects: tender-builder layout only. Tender fields, validation, matching, payments, contact release, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/client-tender-builder.test.ts` passes (1 test); `npm run type-check` passes.

### 2026-09-05 - Supply-Type-Specific Tender Labels

- Changed: tender package fields now use the selected supply type in their labels. Materials uses Material category and Material detail; Waste uses Waste type and Waste detail; Plant Hire uses Plant category and Plant detail. Service-based packages retain Service provision wording.
- Affects: tender-builder labels only. Stored tender data, validation rules, matching, payments, contact release, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/client-tender-builder.test.ts` passes (1 test); `npm run type-check` passes.

### 2026-09-05 - Separate Supply-Type Tender Screens

- Changed: tender packages for different supply types remain on separate sequential requirement screens. Collapsed editable summaries are shown only for repeated items in the currently active supply type; other supply types are reached through Back and Continue. Add another item now creates an item for the active supply type.
- Affects: tender-builder user interface and in-memory form sequencing only. Tender submission payloads, server validation, matching, payments, contact release, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/client-tender-builder.test.ts` passes (1 test); `npm run type-check` passes.

### 2026-09-05 - Collapsible Tender Package Editing

- Changed: when a User adds another tender package, previously completed packages remain visible as compact headline summaries. Selecting a summary restores its editable provision, quantity, and specification fields. The Add another item action now appears below the package list and opens the newly added package.
- Affects: tender-builder user interface only. Tender submission payloads, server validation, matching, payments, contact release, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/client-tender-builder.test.ts` passes (1 test); `npm run type-check` passes.

### 2026-09-05 - Historical Tender Re-Tender Workflow

- Changed: historical or closed tender details now provide a Re-tender action. It opens the tender builder with the original tender's service packages, requirements, location, supply date, descriptions, and authorized attachment files copied into an editable form. The User must set a new quote deadline before submitting.
- Affects: historical tender detail and tender creation workflow only. Re-tendering submits through the existing create-tender path, which assigns a new tender ID and reference, rematches eligible Users, and preserves the historical tender and its payment, quote, contact-release, and audit records unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/client-tender-builder.test.ts tests/lib/retender-flow.test.ts` passes (2 tests); `npm run type-check` and `npm run build` pass.

### 2026-09-05 - Company Services Govern Tender Opportunities

- Changed: tender opportunity visibility, unread opportunity counts, and unlock eligibility now use the company profile's active service selections as the authoritative matching categories. A company with no active services cannot receive, view, count, or unlock a tender opportunity.
- Changed: new registrations store their selected company services in both the company profile and matching profile. Primary company profile edits keep the matching profile synchronised. Migration `20260905010000_backfill_company_services_from_primary_profile` aligns existing primary-user matching settings with the unified company profile.
- Affects: company service profile, tender matching, opportunity listings, unread count, and unlock eligibility. No tender reference, payment amount, contact-release, database schema, or external environment configuration changed.
- Environment: the data-only migration was applied only to the local development database. Staging and production require the documented environment-specific approval, backup/rollback evidence, named release owner, and post-deployment validation before migration deployment.
- Validation: `npx tsx --test tests/lib/tender-schema.test.ts tests/lib/opportunity-unread-badge.test.ts` passes (29 tests); `npm run type-check` passes; local `npx prisma migrate deploy` applied the backfill migration.

### 2026-09-05 - Candidate Brand Visualisation Preview

- Changed: applied the uploaded candidate colour palette to the shared Tailwind tokens for local visualisation: Navy, Steel Blue, Trade Blue, Concrete Grey, Light Grey, White, and Safety Orange. The shared light-surface logo now uses the uploaded candidate horizontal lockup; the existing approved dark-background lockup remains in use on Navy surfaces.
- Affects: visual presentation only. The approved production brand assets remain preserved in `public/images/brand/`; no user workflow, database, payment, authorization, tender matching, or environment configuration changed.
- Environment: this is a candidate visualisation only. Do not deploy it to staging or production until the Founder approves the candidate board and logo pack as the active Brand Authority.
- Validation: `npm run type-check` and `npm run build` pass.

### 2026-09-05 - User Activity History Analytics

- Changed: replaced the User-facing Billing label and commercial page with Activity History. Users can filter the period to the last 7, 30, or 90 days, or all time, and view counts for tenders unlocked, quotes provided, and quotes accepted.
- Affects: User workspace navigation and read-only activity analytics only. Payment records, fee calculation, tender matching, unlock entitlement, contact release, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/user-activity-history.test.ts` passes (1 test); `npm run type-check` passes.

### 2026-09-05 - Profile Service Label Refinement

- Changed: renamed the top-level profile display labels from `Materials` to `Materials Supplier` and from `Waste` to `Waste Disposal`.
- Affects: company profile display labels only. Stored service values, tender creation options, tender categories, matching, payment, authorization, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npm run type-check` passes.

### 2026-09-05 - Candidate Brand Asset Upload Area

- Changed: added `public/images/brand/candidate/` with separate `logos/` and `palette/` folders for proposed brand assets. Candidate files are deliberately isolated from the approved serving logo directory and are not referenced by the application.
- Affects: local source-asset organisation only. No active logo, palette, user interface, database, payment, authorization, or environment configuration changed.
- Environment: upload trial logo exports and palette reference files only to the candidate folders. Promote an asset to the approved brand directory only after brand approval and an explicit implementation change.
- Validation: pending workspace formatting check.

### 2026-09-05 - Company Service Provision Profiles

- Changed: primary Users can now select second-stage provisions for each service their company offers. For example, Materials can include Cement, Concrete and Mortar or Aggregates, Sand and Stone; Contractor Services can include Groundworks and Civil Engineering.
- Affects: the company profile, `ClientCompany.serviceProvisions`, and migration `20260905000000_add_company_service_provisions`. The server validates every saved provision belongs to a selected company service. No tender matching, payment, unlock, contact-release, or environment configuration behavior changed.
- Environment: migration was applied only to the local development database. Staging and production migration deployment requires the documented environment approval, backup/rollback evidence, named release owner, and post-deployment validation.
- Validation: local `npx prisma migrate deploy` applied the migration; `npx tsx --test tests/lib/client-company.test.ts` passes (3 tests); `npm run type-check` passes.

### 2026-09-05 - Unread Tender Opportunities Navigation Badge

- Changed: added a compact unread-count badge beside Tender Opportunities in the User left navigation and mobile navigation drawer. It counts only open tender matches the User has not yet opened, using the existing `TenderMatch.viewedAt` state.
- Affects: authenticated User navigation and a new read-only opportunity-count endpoint. No tender data, matching decision, payment, unlock, contact-release, database schema, or environment configuration changed.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/opportunity-unread-badge.test.ts` passes (1 test); `npm run type-check` passes.

### 2026-09-04 - Company-Based User Accounts And Branch Identity

- Changed: made the company the operating identity for User accounts. The primary User can add additional authenticated Users under the same company, and members can view, open, edit, and receive quotes for tenders raised by any authorised colleague in that company.
- Changed: added a required company branch/location identifier with a unique company-name-and-branch constraint. This permits legitimately duplicated business names only when the branch or location differentiates them. New company registration and primary-profile editing capture this identifier.
- Changed: additional Users inherit the company's tender-opportunity profile when created and receive matching opportunities as a company representative. Protected attachment access now recognises company tender ownership as well as a User's personal unlock entitlement.
- Affects: `ClientCompany` schema and migration `20260904010000_add_company_branch_identifier`, User registration/profile setup, company membership, tender and quote access, attachment access, and company regression coverage. No payment amounts, contact-release conditions, tender references, or external environment configuration changed.
- Environment: the migration was applied and validated only against the local development database. Staging and production require the documented environment-specific approval, backup/rollback evidence, named release owner, and post-deployment validation before migration deployment.
- Validation: local `npx prisma migrate deploy` applied the migration after a corrected legacy branch backfill; `npx tsx --test tests/lib/client-company.test.ts` passes (2 tests); `npm run type-check`, `npm test` (142 tests), and `npm run build` pass.

### 2026-09-04 - Approved Two-Level User Platform

- Changed: merged the operating account model into one `User` role alongside `Super User`. A User has both a tender-owning business record and a tender-opportunity profile, allowing them to create tenders, use My Tenders, maintain categories and coverage, and view Tender Opportunities matched to that profile.
- Changed: authorization now determines access from tender ownership, matching, and stored unlock records rather than the former role split. Tender creators are excluded from their own opportunity matching; existing paid/credited unlock records remain authoritative.
- Affects: role database enum and migration, registration, protected-route navigation, tender/attachment/message authorization, User workspace routes, profile setup, notifications, and role-related regression coverage. Existing tender, quote, payment, contact-release, and audit data is preserved.
- Environment: apply migration `20260904000000_merge_contractor_and_provider_roles` through the approved deployment process. This run applies it only to the local development database. Staging and production require the documented environment-specific approval, backup/rollback evidence, named release owner, and post-deployment validation before application.
- Validation: local `npx prisma migrate deploy` applied `20260904000000_merge_contractor_and_provider_roles`; `npm run type-check`, `npm test` (141 tests), and `npm run build` pass.

### 2026-09-04 - Two-Level Contractor Service Provisions

- Changed: tender packages now require only the selected service group and its service provision. For example, a Contractor can submit `Contractor Services` with `Groundworks & Civil Engineering` without selecting the optional third-level detailed provision.
- Affects: Contractor tender-builder labels and client-side validation plus existing tender-schema regression coverage. Server-side catalogue relationship validation, Provider matching, tender identifiers, payments, contact-release controls, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/tender-schema.test.ts tests/lib/client-tender-builder.test.ts` passes (29 tests); `npm run type-check` passes.

### 2026-09-04 - Contractor Tender Detail And Edit Workflow

- Changed: Contractors can now open the full tender they own, including its requirements, package specifications, and their attachments, then edit its mutable timing, location, requirements, overall information, and existing package quantities/specifications. The tender ID, tender reference, package identities, matches, quote records, and Provider unlock records remain unchanged.
- Changed: every successful tender edit is server-authorized, server-validated, content-moderated, atomically audited, and sends every currently matched Provider a non-sensitive tender-update email. A Provider who previously unlocked the tender retains that access and is not charged again.
- Affects: Contractor tender detail and edit workflow, matched Provider notifications, and tender audit history. No database migration, payment calculation, contact-release behavior, tender identifier, or environment configuration changed.
- Environment: no operator action required. Update emails use the existing configured Resend sender where present; otherwise the attempted notification is recorded as skipped without exposing tender details.
- Validation: `npx tsx --test tests/lib/tender-package-model.test.ts` passes (4 tests); `npm run type-check` passes.

### 2026-09-04 - Contractor Tender Deadline Screen Removal

- Changed: moved the required quote-deadline input and its preset controls into the initial Contractor project-details screen, then removed the separate duplicate deadline step. The tender builder now proceeds from additional requirements to uploads, then review and submission.
- Affects: Contractor tender-creation workflow and its focused regression coverage only. Server-side tender deadline validation, Provider visibility, matching, payments, contact release, database schema, and environment configuration remain unchanged.
- Environment: no operator action required.
- Validation: `npx tsx --test tests/lib/client-tender-builder.test.ts` passes (1 test); `npm run type-check` passes.

### 2026-09-04 - Test Fixture Isolation For Tender Workflow Release

- Changed: updated the tender-builder expectation for the guided per-service package screens and made membership billing coverage explicitly set and restore its VAT fixture. The test suite no longer depends on the active staging database's mutable VAT setting.
- Affects: automated test coverage only. No production application behavior, pricing setting, database schema, migration, payment, contact-release, or environment configuration changed.
- Environment: no operator action required; the membership test restores the prior VAT setting after execution.
- Validation: focused affected tests pass (3 tests); `npm test` passes (137 tests).

### 2026-09-04 - Full-Tender Provider Unlock Rule

- Changed: confirmed and documented the Provider unlock rule: a Provider receives only its relevant pre-unlock opportunity summary, but one confirmed tender unlock releases the full tender job and every package. The Provider can price each tender item or mark it unavailable. No additional fee applies to other packages in that tender.
- Affects: Provider visibility and quote workflow requirements plus package-unlock regression coverage. Existing server behavior already implements one payment/unlock per tender and returns every package only after that unlock; no schema, payment calculation, or environment configuration change is required.
- Environment: no operator action required.
- Validation: focused `npx tsx --test tests/lib/tender-package-model.test.ts` passes (3 tests); `npm run type-check` passes.

### 2026-09-04 - Restore Approved Partner Records

- Changed: added a narrow idempotent restoration utility for the three approved partners: Sinclair Safety Solutions Ltd, Smart Works Civils Ltd, and HSQE Consult Hub. It creates or updates only those records as active `FOOTER` partners in the approved display order, without running the broader demo-account seed.
- Affects: configured database `Partner` records and public partner-information/footer display. No user accounts, tender matching, quote ranking, payments, contact release, or environment configuration changed.
- Environment: executed against the configured staging test database at the Super User's request. The partner records remain editable through Super User partner management after restoration.
- Validation: `npm run db:restore-initial-partners` restored 3 records. Database verification confirms all 3 are active `FOOTER` partners in the order Sinclair Safety Solutions Ltd, Smart Works Civils Ltd, then HSQE Consult Hub. `npm run type-check` passes.

### 2026-09-04 - Landing Page Partner Information

- Changed: added a restrained landing-page partner-information band after the role workspaces. It renders only active database-managed partner records through the existing minimal public display endpoint, labels the content clearly, and states that it is separate from tender matching, quote ranking, supplier selection, and Contractor decisions.
- Affects: public landing page and active partner display only. No partner records, matching, quote comparison, payment, contact-release, analytics, or environment configuration changed.
- Environment: no operator action required. Super Users continue to manage active partner records and their footer display order through the existing partner administration screen.
- Validation: focused `npx tsx --test tests/lib/site-footer-partners.test.ts` passes (2 tests); `npm run type-check` passes.

### 2026-09-04 - Contractor Job-First Tender Creation

- Changed: reorganized the Contractor tender form around the job before its packages. The first step now captures project name, optional additional information, jobsite/delivery postcode, and all required service groups. Each selected service initializes a package on the next step, ensuring package details drive the existing category/location Provider matching and opportunity notification process.
- Changed: added project urgency and an optional planned works start date to the same first step, before package completion and Provider notification. The stored `urgency` and `supplyDate` fields remain server-validated; the later step now collects only the quote deadline.
- Changed: selected services now advance through one requirements screen per package, such as Materials Requirements followed by Waste Requirements, instead of presenting all selected packages on one screen.
- Affects: Contractor tender form and product requirements only. Existing server-side tender/package validation, Provider matching, staged visibility, payments, and notification boundaries remain unchanged.
- Environment: no operator action, migration, or configuration change required.
- Validation: focused `npx tsx --test tests/lib/tender-schema.test.ts` passes (28 tests); `npm run type-check` passes.

### 2026-09-04 - Staging Deployment Branch Alignment

- Changed: aligned the approved staging deployment gate with the direct-to-`staging` workflow. It now requires the approved SHA to be the exact current `origin/staging` head rather than the `main` head, while retaining the protected staging environment, exact approval statement, clean PostgreSQL migration replay, production build, Render deploy hook, and post-deployment verification requirements.
- Affects: staging deployment authorization workflow only. No Render service, staging environment variable, deploy hook, database, credential, or application runtime configuration was changed.
- Environment: an authorized Render operator must add the missing `RENDER_STAGING_DEPLOY_HOOK` secret to the GitHub `staging` environment before deployment. The hook value is not recorded in this repository. Run the approved staging workflow only with the current staging SHA and its required approval statement.
- Validation: `npm run health:validate-workflows` and focused deployment-authorization tests pass.

### 2026-09-04 - Owner Password Verification Utility

- Changed: added `npm run db:verify-owner-password`, which prompts for an owner password without echoing it and compares it against the configured `PLATFORM_OWNER_EMAIL` account's existing hash. It reports only match or mismatch and never changes the user row, session state, or audit log.
- Affects: local development diagnostic workflow only. No account password, staging or production environment resource, integration setting, credential, or deployment configuration is changed.
- Environment: run the command in a terminal connected to the intended database. It is a non-destructive diagnostic and does not reset credentials.
- Validation: `npm run type-check` passes. The utility prompts without echoing the supplied password and reports only whether it matches; no account state is modified.

### 2026-09-04 - Preserve Existing Owner Passwords During Seeding

- Changed: stopped `prisma/seed.ts` from rewriting an existing `PLATFORM_OWNER_EMAIL` account's password hash. The seed retains role and account-status normalization, but only uses `PLATFORM_OWNER_PASSWORD` when creating a missing owner account. This prevents a routine seed against an existing development database from silently replacing an operator's known password.
- Affects: local development seed behavior and future owner password preservation only. No account password, database schema, migration, staging or production environment resource, integration setting, or deployment configuration was changed.
- Environment: existing owner passwords are intentionally preserved. Create a new local database or use the normal authenticated reset flow to establish a different password; do not use routine seeding as a password-reset mechanism.
- Validation: focused `npx tsx --test tests/lib/seed-owner-password.test.ts` and `npm run type-check` pass.

### 2026-09-03 - High-Severity Dependency Remediation

- Changed: upgraded Next.js and its matching ESLint/React toolchain from the vulnerable Next 14 release line to Next 16.3.4, React 19.2.8, ESLint 9, and the corresponding React type packages. Replaced the removed `next lint` command and legacy ESLint configuration with the supported flat configuration. Added a root dependency override for Prisma 6's vulnerable `deepmerge-ts` 7.1.5 transitive dependency, resolving it to 8.0.0 without downgrading the final Prisma 6 release.
- Changed: completed the required Next 16 compatibility migration. Dynamic API and Super User routes now await promise-based `params`. The login page is again a Server Component and delegates its interactive form to a dedicated Client Component, preventing the database-backed async footer from being bundled into the browser and restoring the sign-in page.
- Changed: made the shared footer client-safe for all interactive pages. It now obtains a minimal list of active footer partners from a public display-only endpoint rather than importing Prisma. This prevents Prisma from being bundled into the browser on registration, password-reset, and authenticated portal pages while retaining database-managed partner placement.
- Affects: application build/lint toolchain and dependency lockfile only. No application workflow, database schema, migration, payment, contact-release, or staging/production environment resource changes.
- Environment: Render already uses Node 20, which satisfies the Next 16 and Prisma runtime requirements. Local validation must use Node 20, 22, or 24; the current local Node 24 is supported by Prisma but not the repository's declared Node 20 release policy.
- Validation: `npm audit --audit-level=high` reports zero vulnerabilities. `npm run lint` passes with two pre-existing non-blocking warnings; `npm run type-check`, `npm test` (134 passing), and `npm run build` pass. Browser checks confirm login, registration, and password-reset pages render without async Client Component errors. The configured owner credentials complete the local NextAuth callback and redirect to `/super-user`. The build reports the existing `middleware`-to-`proxy` deprecation, which requires separate route-boundary regression testing before migration.

### 2026-09-03 - Staging Deployment Verification URL Repair

- Changed: corrected the staging deployment workflow so its verification job reads `STAGING_BASE_URL` directly within the protected staging environment. GitHub masks that environment value and omits it when it is exposed as a cross-job output, which previously passed an empty base URL to the non-destructive verifier after Render accepted the deployment hook.
- Affects: `.github/workflows/deploy-staging.yml` release verification only. No Render service, staging environment variable, credential, deploy hook, database, or application runtime configuration was changed.
- Environment: no operator action or environment-resource change is required. The next approved staging deployment continues to require its existing protected-environment approval and will use the already configured `STAGING_BASE_URL` value.
- Validation: `npm run health:validate-workflows` passes. The repair is based on failed approved staging deployment run `33648207019`, whose verifier exited before issuing any live probe because `--base-url` was empty.

### 2026-09-03 - Contractor Services And Operating Locations

- Changed: added company-level Contractor services and operating locations. The Contractor profile now lets the primary company user select approved tender catalogue service groups and UK counties or regions. The API validates every value server-side before storing the company-level lists; additional company users can view, but cannot change, shared company details.
- Affects: Prisma `ClientCompany`, migration `20260903040000_add_client_company_services_and_operating_locations`, Contractor profile API and UI. No matching eligibility, tender visibility, payment, contact-release, or external environment configuration changes.
- Environment: apply the new migration only through `prisma migrate deploy` after the required environment approval, backup/rollback evidence, and change-register release record. Existing Contractor companies receive empty lists.
- Validation: `npx prisma validate`, `npm run db:generate`, `npm run type-check`, and local `npm run db:deploy` pass.

### 2026-09-03 - Contractor And Professional Service Catalogue

- Changed: added the supplied initial construction service provisions to the tender catalogue. `Contractor Services` contains fourteen selectable categories covering civil engineering through workforce supply; `Professional Services` contains surveying/design/engineering and safety/compliance/consultancy. Each category starts with its supplied provision description and can be edited or deactivated through the existing Super User category editor, with active database overrides included in Contractor tender creation and server validation.
- Affects: Contractor tender and package selection, Provider capability matching categories, Super User category administration, and tender input validation. No schema migration, pricing, payment, contact-release, or environment configuration changes.
- Environment: no operator action required. Super Users may refine initial provisions through the existing categories administration surface.
- Validation: focused `npx tsx --test tests/lib/tender-schema.test.ts` passes (28 tests); `npm run type-check` passes.

### 2026-09-03 - Progressive Contractor Release-Fee Third Band

- Changed: extended the inactive percentage-based Contractor accepted-quote release fee with a third progressive band. The server now calculates 1% for the first £10,000, 0.5% for the next £90,000, and 0.25% for any remaining quote value, rounding the aggregate fee to whole pence. The Owner settings panel separately configures each rate. Fixed £10 release-fee mode remains the default approved active revenue model.
- Affects: platform fee settings, Owner configuration UI, release-payment fee calculation, and focused calculation coverage. No schema migration, payment integration, payment state, contact-release entitlement, or external environment configuration changes.
- Environment: no operator action is required while fixed fee mode remains active. An Owner must explicitly select percentage mode before new release payments use the progressive rates.
- Validation: focused `npx tsx --test tests/lib/tender-schema.test.ts` passes (27 tests); `npm run type-check` passes.

### 2026-09-03 - Phase 3 Job / Tender-Package Schema Foundation And Creation Flow

- Changed: introduced the initial `TenderPackage` data model as the schema foundation for the job/tender-package rework. Each package belongs to a parent `Tender` job, has its own package reference and package-scoped fields, and is stored with the same status and lifecycle semantics as the current tender record. Existing single-package tenders remain valid; migration backfill creates one package per existing tender so no historical data is lost. The contractor tender creation path now stores a package row for the primary tender item and one row per additional package item, ensuring the job record and package rows are created together instead of leaving the schema foundation unused.
- Affects: Prisma schema, generated client, migration `20260903030000_add_tender_packages`, `createTender` job creation, and package-first regression coverage. Matching engine, Provider unlock flow, quote flow, analytics filters, and production configuration remain pending Phase 3 work.
- Environment: migration applies only through Prisma migration deployment. Existing tender records are preserved and backfilled into package rows in the same deploy.
- Validation: `npx prisma validate`, `npx prisma generate`, the focused package-model regression test, `npm run type-check`, and `git diff --check` pass.

### 2026-09-03 - Phase 3 Package-Aware Matching And Provider Visibility

- Changed: completed the package-aware lifecycle update beyond the schema foundation. Matching eligibility now combines the parent job's package categories with line-item categories so a Provider is evaluated against the actual package mix rather than a single tender-level category bucket. The Provider opportunity summaries include package metadata (`packageCount`, `packageCategories`) so multi-package jobs are visible and ranked correctly. Unlocked tender detail and metadata now return package rows so a Provider sees the package makeup in the unlocked view instead of a legacy single-item tender description. The contractor creation flow already writes package rows for the main and additional line items during a single job submission, and the provider-side summaries now also reflect the package mix.
- Affects: `tenderService`, `listMatchedSummariesForRetailer`, job/tender detail API responses, retailer opportunity/detail UI, and tender creation package rows. Phase 3 is treated as complete for the implemented package-model lifecycle and matching visibility work; further package-level quote and analytics refinement remains a future enhancement if the product scope expands beyond the current branch.
- Environment: no new migration or external config changes required; this is application-layer rework only.
- Validation: `npm run type-check` and the focused package regression test pass. The last verification run reported `3` passing tests and `0` failures.

### 2026-09-03 - Phase 4 Subscription Tier Pricing Alignment

- Changed: finalised the inactive default membership tier catalog so the feature is ready for later activation without changing the live revenue model. The default list now includes `Free`, `Starter`, `Growth`, `Pro`, and `Enterprise` with the approved pricing structure (`£0`, `£29`, `£49`, `£99`, and `£199` for the enterprise default). The catalog is seeded in both the runtime app and the local Prisma seed, and any missing tier row is corrected back to the approved inactive state so the feature remains off until the Super User toggles it on.
- Affects: membership tier defaults, local seed data, and admin settings reads. No activation flag or revenue behavior is changed; `MEMBERSHIP_TIERS_ACTIVE` stays off unless explicitly toggled by the Owner.
- Environment: no production or staging config change required. Local seed and runtime seeding remain development-only defaults, with activation still controlled by the Owner platform setting.
- Validation: the focused membership pricing regression and the existing membership purchase gate test pass under the project test runner.

### 2026-09-03 - Phase 2 Initial Partner Records

- Changed: moved the approved HSQE Consult Hub logo into `public/images/HSQE_ConsultHub_Stacked_Light.png`, added migration `20260903020000_allow_partners_without_destination_url`, and seeded the three approved active footer partners idempotently: Sinclair Safety Solutions Ltd, Smart Works Civils Ltd, and HSQE Consult Hub. HSQE has no destination URL and is rendered as a non-clickable logo until one is approved; supplied partner links remain HTTPS-only.
- Affects: local Partner schema, approved public asset, local seed data, Partner administration validation, and footer rendering. No advertising cookies, payments, tracking, tender matching, quote ranking, or supplier-selection behavior changed.
- Environment: the nullable-destination migration and partner seed ran only against the configured local development database. Apply to staging or production only with the required approval, backup/rollback evidence, and recorded release validation.
- Validation: `npx prisma validate`, `npm run db:generate`, `npm run db:deploy`, and `npm run db:seed` pass. Local database verification confirms all three active `FOOTER` records in sort order, with `null` only for HSQE's destination URL. Focused Partner/footer tests, `npm run type-check`, `npm run lint`, editor diagnostics, and `git diff --check` pass.

### 2026-09-03 - Phase 2 Server-Rendered Footer Partners

- Changed: replaced the hardcoded footer partner links with a server-rendered query of active `Partner` records scoped to the `FOOTER` display location and ordered by configured sort order then name. The footer displays the section only when active partners exist, labels it "Partner advertising", and keeps the required statement that advertising is separate from tender matching, quote ranking, supplier selection, and Contractor decisions.
- Affects: public footer rendering and Partner database reads only. No partner records were created, no advertising settings/cookies/payments were activated, and no tender matching, quote ranking, or supplier-selection behavior changed.
- Environment: no operator action.
- Validation: `npm run type-check`, focused `npx tsx --test tests/lib/site-footer-partners.test.ts`, `npm run lint`, editor diagnostics, and `git diff --check` pass. `npm run build` remains blocked by the previously recorded unrelated missing `pdf-lib` files in `node_modules`.

### 2026-09-03 - Phase 2 Partner Administration

- Changed: added full Super User-only partner management at `/super-user/partners` and `/api/super-user/partners`. The server validates each strict create, update, activation, and reorder request, rejects cross-origin mutations, validates a complete current location ordering before changing it, and writes transaction-backed minimal audit events for every change.
- Affects: Partner administration UI and API plus `AuditLog` records. No partner rendering, advertising placement or activation, cookies, tender matching, quote ranking, supplier selection, payments, database migration, seed data, or environment configuration changed.
- Environment: no operator action.
- Validation: focused `npx tsx --test tests/lib/partner-schema.test.ts`, `npm run type-check`, `npm run lint`, and `git diff --check` pass.

### 2026-09-03 - Phase 2 Partner Model And Migration

- Changed: added the inactive-by-default `Partner` model and PostgreSQL migration `20260903010000_add_partners`. Each partner has a unique name, approved logo path, destination URL, display location, optional campaign source, stable sort order, active status, and timestamps. The location/active/order index supports the later server-rendered placement query and Super User reorder control.
- Affects: local database schema and generated Prisma client only. No partner records, advertising placement, Super User UI, payment behavior, cookies, or environment configuration were activated or changed.
- Environment: migration applied only to the configured local development database through `npm run db:deploy`. Apply to staging or production only with the required approval, rollback evidence, and recorded release validation.
- Validation: `npx prisma validate`, `npm run db:generate`, and local `npm run db:deploy` pass with no schema diagnostics.

### 2026-09-03 - Phase 1 Documentation Alignment

- Changed: aligned active documentation and repository instructions with the completed Contractor/Provider role terminology. Updated the Phase 1 README checklist and active product, security, architecture, readiness, brand, and advertising documentation. No application code, Prisma schema or migrations, environment resource, or historical change-register entry was changed.
- Affects: active documentation and contributor instructions only, including current outstanding-action terminology. Technical lowercase routes, model/field identifiers, and earlier historical records remain unchanged where they are implementation or audit references.
- Environment: no operator action.
- Validation: active-document terminology scans confirm that any remaining Client/Retailer matches are only generic technical usage, preserved legacy route/model references, or earlier historical records. `git diff --check` passes.

### 2026-09-03 - Phase 1 Persisted Role Enum Rename

- Changed: renamed PostgreSQL `Role` values `CLIENT` to `CONTRACTOR` and `RETAILER` to `PROVIDER` using in-place `ALTER TYPE ... RENAME VALUE` statements in `prisma/migrations/20260903000000_rename_role_enum_values/migration.sql`. Updated `prisma/schema.prisma`, executable TypeScript role checks/types, authentication session handling, registration payload validation, administration permissions, email recipient roles, local seed data, and test fixtures. `SUPER_USER` remains unchanged. Legacy database relation/model/column names, `/api/client` and `/api/retailer` endpoints, and `/client` and `/retailer` redirect paths remain unchanged by design.
- Affects: `User.role`, `UserRole.role`, authenticated workspace authorization, registration, role-scoped APIs, email notifications, local seed data, and tests. The enum-label rename preserves existing role-column data.
- Environment: apply only through Prisma migration deployment, never `db push`. For local development, use the direct local-only `DATABASE_URL_UNPOOLED` connection. Do not apply this migration to staging or production without the separately required approval, backup/rollback evidence, and recorded release validation.
- Validation: the migration applied successfully through `npm run db:deploy` to the configured local development database. `npm run db:generate`, `npm run type-check`, `npm run lint`, and `git diff --check` pass. The focused workspace/admin tests pass. The full suite has 120 passing tests; five unrelated existing integration-test failures remain because immutable `AuditLog` cleanup is rejected and placeholder local Stripe/Resend credentials cannot process external payment/email calls. No old role enum literals remain in source, local seed data, or tests.

### 2026-09-03 - Phase 1 Contractor And Provider Route Aliases

- Changed: added protected `/contractor` and `/provider` canonical portal aliases. Middleware applies the existing `CLIENT`/`RETAILER` role checks to both legacy and canonical prefixes, redirects authenticated legacy `/client` and `/retailer` requests to their canonical equivalents, and rewrites authorised canonical requests to the existing portal route trees. Shared navigation and role workspaces now target the canonical paths, and validated page-view tracking accepts both canonical and legacy prefixes.
- Affects: protected portal routing, navigation, and analytics path validation. No role enum, database schema, API contract, authorization policy, payment/release control, or environment configuration changed.
- Environment: no operator action.
- Validation: `npm run type-check` passes. A local development server compiled the middleware; unauthenticated requests to `/contractor`, `/provider`, `/client`, and `/retailer` all returned an authentication redirect with the expected callback path. `npm run build` remains blocked by pre-existing missing `pdf-lib/es/core/objects/PDF*` files in `node_modules`, unrelated to this change.

### 2026-09-03 - Phase 1 User-Facing Role Terminology

- Changed: renamed user-facing Client/Retailer labels and copy to Contractor/Provider across public pages, rendered policies, shared portal navigation and workspaces, registration, Super User administration and reporting, membership UI, tender messaging, and operational email templates. Legacy `CLIENT`/`RETAILER` role values, database columns, API/query names, and `/client`/`/retailer` routes are intentionally unchanged until their dedicated later Phase 1 checklist actions.
- Affects: user-visible application copy and outgoing notification copy only. No authorization logic, schema, API contract, environment configuration, or payment/release control changed.
- Environment: no operator action.
- Validation: `npm run type-check` passes after each implementation batch; `npm run lint` passes with no warnings or errors; `git diff --check` passes.

### 2026-09-03 - Four Quick-Win Outstanding Actions Completed

- Changed: fixed 4 small, self-contained items from the README Outstanding Actions list. Corrected the tender-creation upload copy so it no longer implies Retailers can preview attachments before unlock ([src/app/client/tenders/new/page.tsx](../src/app/client/tenders/new/page.tsx)). Replaced the plain-text initial password field on the Super User creation form with the shared `PasswordInput` reveal control ([src/components/admin/OwnerConsolePanel.tsx](../src/components/admin/OwnerConsolePanel.tsx)). Moved the quote comparison table/card breakpoint from `md` to `lg` so tablet widths use the condensed card layout instead of forcing horizontal scroll ([src/components/quotes/QuoteComparison.tsx](../src/components/quotes/QuoteComparison.tsx)). Added Escape-to-close and Tab focus trapping to the mobile navigation dialog ([src/components/layout/AppShell.tsx](../src/components/layout/AppShell.tsx)).
- Affects: UI copy and layout only. No schema, API, or environment changes.
- Environment: no operator action.
- Validation: `npm run type-check` and `npm run lint` pass. No behavioral/schema change, so no new automated test was required; manual keyboard/tablet verification recommended before the next staging deploy.

### 2026-09-03 - Phased Implementation Plan For New Business Plan

- Changed: added a "New Business Plan Implementation Plan" section to [README.md](../README.md), breaking the 4 code-affecting baseline decisions into four sequential phases: (1) Contractor/Provider terminology rename (labels/routes first, `Role` enum migration last, as the highest-risk step), (2) active Super-User-managed partner advertising, (3) job/tender-package data model and matching engine rework, (4) subscription tier price alignment (still inactive).
- Affects: [README.md](../README.md) only. No application code, schema, or environment configuration changed.
- Status: planning only; no phase has started.
- Environment: no operator action.
- Validation: none yet; documentation only.

### 2026-09-03 - Baseline Business Plan Decisions Resolved

- Changed: the Super User resolved all 10 open conflicts raised against the 2026-09-03 baseline business plan. Resolved: (1) Client→Contractor/Retailer→Provider is a pure rename, no new roles; (2) job-package tender splitting is approved as specified and requires a new data model/matching engine; (3) no fee changes — current £10/£10 fees and existing fee-setting controls stay; (4) current tender/quote identifier format stays, the `JOB-YYYYMMDD` scheme is not adopted; (5) active Super-User-managed partner advertising is approved; (6) no Provider confirmation step — quote lifecycle stays a single Contractor action; (7) Retailer/Provider accounts stay self-serve, no approval gate; (8) current approved brand palette stays, the proposed Construction Navy/Safety Orange palette is not adopted; (9) the plan's Azure hosting reference is a legacy artifact — Render/Neon stays; (10) the Free £0/Starter £29/Growth £49/Pro £99/Enterprise £149–199 subscription tiers are confirmed as the future pricing model for whenever Provider subscriptions are activated (feature stays built-but-inactive until then).
- Affects: [docs/TradeTender-Business-Plan.md](TradeTender-Business-Plan.md) (Baseline Change Notes section), [.github/copilot-instructions.md](../.github/copilot-instructions.md) (Roles section updated to Contractor/Provider terminology, rename not yet applied to code). No application code, schema, or environment configuration changed yet.
- Status: still a planning-stage change. The role rename (item 1) and job-package data model (item 2) are large, separate implementation phases not yet started.
- Environment: no operator action.
- Validation: none yet; documentation only.

### 2026-09-03 - New Baseline Business Plan (Contractor/Provider Model)

- Changed: replaced [docs/TradeTender-Business-Plan.md](TradeTender-Business-Plan.md) with a new baseline business plan supplied by the Super User, covering a Contractor/Provider/Super User model, job-based tenders split into per-category "tender packages," a £5 Provider quote participation fee, a percentage-based (or, per an internal inconsistency in the source, fixed £10) Contractor Accepted Quote Release Fee, active Super-User-managed partner advertising, a new job/package/quote identifier scheme, and a proposed new brand colour palette.
- Affects: no application code, schema, or environment configuration yet. Documentation only.
- Status: **not implemented**. This is a scope-defining document only. Ten open conflicts/decisions are recorded in the "Baseline Change Notes" section at the end of the business plan and must be resolved with the Super User before implementation begins, including the role-rename scope, the tender-package data model, the fee inconsistency, and the brand-palette conflict with the existing approved Brand Guide.
- Environment: no operator action.
- Validation: none yet; this is a planning document change, not a code change.

### 2026-09-02 - Add HSQE Consult Hub As Third Named Partner

- Changed: added HSQE Consult Hub as a third clearly labelled partner alongside Sinclair Safety Solutions Ltd and Smart Works Civils Ltd. HSQE Consult Hub does not yet have a website, so its logo is displayed without an outbound link (no `<a>` wrapper) until one is provided.
- Affects: [src/components/layout/SiteFooter.tsx](../src/components/layout/SiteFooter.tsx) (new logo tile), `public/images/HSQE Consult Hub Logo.png` (copied from the supplied `docs/branding/HSQE_ConsultHub_Stacked_Light.png`), [docs/TradeTender-Business-Plan.md](TradeTender-Business-Plan.md), [docs/branding/TradeTender-Brand-Rules.md](branding/TradeTender-Brand-Rules.md), [docs/Product-Requirements.md](Product-Requirements.md) (FR-090), and [docs/PRODUCTION-READINESS-REVIEW.md](PRODUCTION-READINESS-REVIEW.md).
- Environment: no operator action; no environment resource, credential, or database change. Static UI/content change only.
- Validation: `npm run type-check` and `npm run lint` pass. Add a website link once HSQE Consult Hub provides one.

### 2026-09-02 - Environment And Branch Resource Preservation Requirement

- Changed: added a permanent governance rule distinguishing local development/feature resources from protected staging and production/main environment resources. Development and feature branches must use only local databases and local-only sandbox credentials/settings. Staging and production/main branches each have explicit, dedicated environment resources and branch-specific security permissions (databases, Stripe, Resend, Sentry, Cloudflare/DNS/WAF, authentication providers, analytics/telemetry, storage, monitoring, webhooks, API credentials, service URLs, access policies, role assignments, deployment configuration, and future integrations) that must never be reset, reseeded, overwritten, repointed, rotated, disabled, downgraded, deleted, replaced, or weakened without recorded Founder/product-owner/release-owner approval, resource identification, backup/rollback evidence, a change plan, post-change validation evidence, and a named release/rollback owner.
- Affects (governance sources updated, not application code): [.github/copilot-instructions.md](../.github/copilot-instructions.md) (new "Environment Resource Preservation" section), [docs/Security-Requirements.md](Security-Requirements.md) (new SEC-118 to SEC-122 and a new Security Release Gate bullet), [docs/Architecture.md](Architecture.md) (Deployment Architecture section), [docs/health-check/README.md](health-check/README.md) (new "Protected environment resources" section in the deployment runbook), and a new [.github/PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md) checklist item confirming whether environment resources or security permissions are affected.
- Environment: no operator action. No live staging or production/main environment setting, credential, or integration was changed as part of this update; this is a documentation/governance change only. No secret values were printed or committed.
- Validation: `node scripts/health-check/validate-workflows.mjs` passes (no workflow files were changed by this entry). Reviewed the edited Markdown files for formatting; `git diff --check` shows no whitespace errors. Rollback: revert this commit; no migration or environment change accompanies it.

### 2026-09-02 - Permanent Development Branch And Staging Reconciliation

- Changed: created a permanent `development` branch (from the current `staging` tip) as the integration branch for day-to-day feature work, which flows into `staging` and then `main`. Added an approval-gated workflow, `.github/workflows/reconcile-staging-to-development.yml`, that opens a draft pull request merging `staging` back into `development` so the branches do not diverge when `staging` moves independently (e.g. hotfixes promoted from `main`, staging record commits). Added `development` to the CI trigger list in `.github/workflows/ci.yml`.
- Affects: GitHub branch topology and CI/CD workflows only. No application code, database, or environment configuration changed.
- Environment: no operator action required for this change. If branch protection rules are configured for `main`/`staging`, an operator should add equivalent protection for `development` if desired; this was not done automatically since it requires GitHub repository settings access outside this change set.
- Validation: `node scripts/health-check/validate-workflows.mjs` passes for all workflow files including the new one. `development` was pushed to `origin` and tracks `origin/development`.

### 2026-09-02 - Pending Super User Reporting Filters And Aggregate Export

- Changed: Super User analytics and CSV export now accept schema-validated Client, Retailer, tender/quote reference, category, geography, tender/quote status, date range, quoted-value band, membership/subscription plan, and payment-status filters. All filters are translated into typed Prisma relationship predicates at the server boundary; the CSV remains aggregate-only and includes the applied filter values for auditability.
- Affects: Super User dashboard and analytics route, `/api/super-user/analytics/export`, and reporting data access. No database migration or new environment configuration is required.
- Environment: no operator action. Membership and subscription filters only return matching historic records while those inactive Year 1 features remain disabled.
- Validation: focused parser/predicate unit coverage added. Run `npm ci`, `npm run type-check`, `npm test`, and `npm run build`; editor diagnostics and `git diff --check` remain required.

### 2026-09-02 - General Audit-Log Immutability

- Status: deferred until the development branch completes the migration-backed implementation.
- Required scope: enforce append-only `AuditLog` records at the database boundary while retaining authorised application inserts, and add integration coverage for rejected updates and deletes.

### 2026-09-02 - Pending Immutable Contact-Release Audit Events

- Changed: added `ContactReleaseAuditEvent` records that transactionally accompany every newly finalised contact release. Each event stores only actor and party IDs, tender/quote IDs, the `CONTACT_DETAILS` category, the exact release timestamp, authorising payment ID, and a generated correlation ID; it does not store email addresses, names, phones, or released contact data. The existing general `CONTACT_RELEASED` audit event now carries the same minimal correlation metadata.
- Affects: PostgreSQL migration `20260902140000_add_contact_release_audit_events`, contact-release finalisation, audit retention, and Super User operational review. A database trigger makes the dedicated event table append-only by rejecting update and delete operations; payment reversal can remove a release entitlement without removing its audit evidence.
- Environment: apply the migration through `prisma migrate deploy` before deploying application code. No new environment variables or secrets are required.
- Validation: focused PostgreSQL integration coverage verifies the event fields, data minimisation, shared release timestamp, generated correlation ID, and database rejection of update/delete attempts. Run `npm run db:generate`, `npm run type-check`, `npm test`, and `npm run build` after applying migrations; editor diagnostics and `git diff --check` remain required.

### 2026-09-02 - Pending Membership Payment Pricing Correction

- Changed: membership payment creation now reloads the requested active MembershipTier and uses its `monthlyPriceGbp` as the net charge. Callers no longer provide payment amounts, preventing client-originated or stale caller values from affecting membership payment, VAT, Stripe checkout, or persisted payment totals.
- Affects: future Retailer membership purchase payments only. No database migration or new environment configuration is required.
- Environment: no operator action. Keep `MEMBERSHIP_TIERS_ACTIVE` set to `false` for the approved Year 1 pay-per-unlock model; enabling it permits only active tiers to be purchased at their database-configured monthly price.
- Validation: focused PostgreSQL billing coverage verifies the disabled feature creates no payment, then verifies an enabled active £49 tier creates a £49 net, £9.80 VAT, £58.80 total pending payment. Run `npm run type-check`, `npm test`, and `npm run build` after dependencies and the test database are available; editor diagnostics and `git diff --check` remain required.

### 2026-09-02 - Pending Membership Allowance Feature Gate

- Changed: tender unlock processing now evaluates active membership allowances only when the Super User `MEMBERSHIP_TIERS_ACTIVE` platform setting is enabled. Existing active RetailerMembership records cannot grant a free tender unlock while the membership feature is inactive.
- Affects: Retailer tender unlocks and the membership feature setting. No database migration or new environment configuration is required.
- Environment: no operator action. Keep `MEMBERSHIP_TIERS_ACTIVE` set to `false` for the approved Year 1 pay-per-unlock model; enabling it activates existing eligible membership allowances.
- Validation: focused PostgreSQL coverage seeds an active tier and membership while the default setting is disabled, then verifies the server creates a pending Retailer unlock payment instead of an unlock. Run `npm run type-check`, `npm test`, and `npm run build` after dependencies and the test database are available; editor diagnostics and `git diff --check` remain required.

### 2026-09-02 - Pending Auditable Legal Holds

- Changed: added migration-backed LegalHold records scoped to Tender, Quote, or TenderAttachment. Full Super Users create and release holds through origin-protected, server-validated API endpoints; each lifecycle operation writes an audit event in the same database transaction. A database check constrains each hold to its declared scope and a partial unique index prevents duplicate active holds for the same target.
- Affects: PostgreSQL migration `20260902130000_add_legal_holds`, retention purge behavior, direct quote deletion, Super User administration APIs, and audit logs. Active tender holds protect related unaccepted quotes and attachments; direct holds protect their own target. Released holds preserve lifecycle metadata and no longer prevent scheduled deletion.
- Environment: apply the migration through `prisma migrate deploy` before deploying application code. No new environment variables or secrets are required. Legal hold management is limited to authenticated non-Accountant Super Users and should be operated only with a documented retention reason.
- Validation: focused unit coverage asserts active direct/tender hold purge exclusions; PostgreSQL integration coverage creates, audits, releases, and purges held records. Run `npm run db:generate`, `npm run type-check`, `npm test`, and `npm run build` after installing dependencies and applying migrations; editor diagnostics and `git diff --check` remain required.

### 2026-09-02 - Pending Tender Attachment Validation And Limits

- Changed: tender attachment validation now performs strict base64 decoding, records byte size from decoded content instead of client metadata, caps individual files at 10 MiB and an attachment request at 10 files/25 MiB decoded content. The server permits only signature-verified PDF, PNG, and JPEG files when their declared MIME type and filename extension also match. Unsupported types, malformed content, MIME spoofing, and PDFs containing active-content markers are rejected before persistence.
- Affects: Client tender submission validation and Postgres-backed TenderAttachment metadata. No schema migration or environment configuration change is required.
- Environment: no operator action. Existing stored attachments remain available under the authorised download controls; the new checks apply to new tender submissions.
- Validation: focused unit coverage verifies decoded-byte size derivation, MIME spoofing rejection, active PDF rejection, and aggregate limits. Run `npm run type-check` and `npm test` after dependencies are installed; editor diagnostics and `git diff --check` remain required.

### 2026-09-02 - Pending Authorised Tender Attachment Access

- Changed: unlocked Retailer tender responses now include attachment metadata, and a dynamic `private, no-store` attachment download endpoint reads Postgres-backed bytes only after server-side authenticated role, Client ownership or Retailer match, and persisted Retailer unlock checks. Successful downloads create an audit event without recording file content or personal data.
- Affects: Retailer tender detail display/download links, Client attachment retrieval, tender visibility, and audit logs. No schema migration or environment configuration change is required.
- Environment: no operator action. Existing attachment content remains in PostgreSQL and is served directly without a public object URL.
- Validation: focused PostgreSQL access test covers locked Retailer denial, unlocked metadata/byte access, Client ownership access, and audit records; run with `npm test` after migrations and test database setup. Editor diagnostics and `git diff --check` remain required.

### 2026-09-02 - Pending Geographic Tender Matching Enforcement

- Changed: TenderMatch and TenderItemMatch creation now requires an exact configured Retailer category and raw tender-location coverage. Unlock and quote submission recheck the same server-side eligibility rule, denying legacy out-of-area match records.
- Affects: tender creation, Retailer coverage/category refresh, unlock payment initiation/finalisation, and quote submission. No schema migration or environment configuration change is required because coverage remains profile data.
- Environment: no operator action. Existing out-of-area match rows may be cleaned up separately, but cannot be used to unlock or quote.
- Validation: editor diagnostics and `git diff --check` passed. Focused unit coverage covers eligible, out-of-area, unsupported-category, and partial-category cases, but could not run locally because `tsx` is unavailable; run it after `npm ci`.

### 2026-09-02 - Pending PostgreSQL Message Contact-Release Integration Test

- Changed: added a `node:test`/`tsx` Prisma integration test for the Retailer message privacy boundary.
- Affects: CI PostgreSQL test database and the message/contact-release workflow; no application, schema, or environment configuration changes.
- Environment: CI must continue to apply Prisma migrations before `npm test`; the test uses unique fictional records and deletes them after each run.
- Validation: editor diagnostics and `git diff --check` passed. Local `npm run type-check` and the focused `tsx --test` command are blocked because dependencies are not installed (`tsc` and `tsx` are unavailable). CI runs `npm ci`, migrations, and `npm test`; the test verifies that a paid tender unlock does not permit messaging before a confirmed Client release payment and `ContactRelease`, then verifies read/send access after release.

### 2026-09-02 - Next.js 16 Upgrade Plan

- Changed: documented the required upgrade sequence; no framework dependency has been changed.
- Status: deferred until the development branch completes the upgrade work.
- Scope: upgrade `next`, `eslint-config-next`, and the Node runtime to the Next.js 16-supported release line in a dedicated branch. Assess NextAuth 4 compatibility before upgrading React or NextAuth.
- Required checks: use Node 20, regenerate Prisma client, run lint/type-check/tests/build, replay migrations, then validate login/logout, protected routes, role changes, Stripe webhooks, payment flows, file access, and middleware on staging.
- Environment: deploy to staging through the approved Render gate only. Keep a production rollback commit available until post-deployment verification completes.
- Audit note: `npm audit` on 2026-09-02 reports a high-severity direct Next.js advisory for versions below 15.5.10 and a separate Prisma/deepmerge transitive advisory; track the Prisma upgrade separately.

### 2026-09-02 - `97674dd` Shared Rate Limiting And Account Lockout

- Changed: PostgreSQL-backed, hashed-client rate limits; five failed password attempts lock an existing account for 15 minutes.
- Affects: database migration `20260902120000_add_shared_rate_limiting_and_login_lockout`, authentication, registration, password-reset, admin email-test, and page-view APIs.
- Environment: apply the migration. Set `RATE_LIMIT_HASH_SECRET` to a unique secret, or rate-limit identifiers fall back to `NEXTAUTH_SECRET`.
- Validation: editor diagnostics and whitespace checks passed. Run migration replay, type check, and rate-limit tests under Node 20.

### 2026-09-02 - `5429973` Active Session Claim Revalidation

- Changed: server session access reloads suspension, role membership, Owner, and Accountant flags; JWT lifetime is eight hours.
- Affects: all protected server pages and APIs using `getCurrentUser` or `requireRole`.
- Environment: no new configuration or migration.
- Validation: add and run suspension, role-revocation, and multi-role session tests.

### 2026-09-02 - `e676e12` Render-Gated Deployment Path

- Changed: Render auto-deploy disabled; protected GitHub workflows deploy approved SHAs through Render hooks.
- Affects: `render.yaml`, staging/production deployment workflows, release operations.
- Environment: `RENDER_STAGING_DEPLOY_HOOK` and `RENDER_PRODUCTION_DEPLOY_HOOK` are configured as protected GitHub environment secrets. Apply the blueprint and run an approved staging deployment.
- Validation: record a successful staging deployment and exact deployed SHA.

### 2026-09-02 - `6377097` Payment And Tender Workflow Controls

- Changed: recoverable Stripe webhook finalisation, payment reversal ledger and revocation, contact-release message gate, and tender expiry enforcement.
- Affects: database migration `20260902000000_add_payment_reversals`, Stripe webhook, payments, unlocks, releases, messaging, and quoting.
- Environment: apply the migration; enable Stripe refund and dispute webhook events.
- Validation: run PostgreSQL integration tests for retries, reversals, release gating, and closed/expired tenders.

### 2026-09-02 - `45c0dfd` Retailer Matching And Delivery District

- Changed: retailer match ranking uses raw server-side location; pre-unlock views show only broad area plus postcode district; full postcode remains restricted until unlock.
- Affects: retailer opportunity/dashboard/detail views and tender summary API.
- Environment: no migration; existing tender locations are formatted dynamically.
- Validation: run geography and retailer opportunity tests under Node 20.

### 2026-09-11 - Production Review Payment And MFA Hardening

- Changed: rejected unpaid Stripe Checkout completion events before payment confirmation or entitlement finalisation; completed sessions are checked for GBP currency and any previously stored PaymentIntent; payment reversal state, entitlement removal, and the reversal audit event are committed transactionally; reversed direct-contact payments now clear the released contact state; active MFA cannot be replaced without first disabling it; MFA recovery-code use is atomic against concurrent reuse; and existing Super User registration attempts now return the same generic pending response as other existing accounts.
- Affects: Stripe webhook payment confirmation, direct-contact access, Super User MFA enrollment/login/disable flows, registration privacy, and related regression tests.
- Environment: no new migration or external resource change. Stripe event fixtures and deployed webhook verification must still be exercised in staging with provider-side evidence.
- Validation: focused MFA tests (4 passing), payment reversal/dispute tests (7 passing), type-check, lint, and full test suite remain required before commit; browser MFA and real Stripe staging tests remain outstanding.