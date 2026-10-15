# Trade Tender Action Tracker

This file is the canonical project action tracker for Trade Tender.

It is intentionally stored in the repository so it travels with the code across branches and environments, rather than living in a branch-local or environment-local document. Update this file in the same change set as the work it tracks, and keep it as the source of truth for open and in-progress actions. Completed items are removed from this file; historical change notes stay in [Implementation-Change-Register.md](Implementation-Change-Register.md) and [PRODUCTION-RELEASE-ACTION-LIST.md](PRODUCTION-RELEASE-ACTION-LIST.md).

## Outstanding Actions

The ambition is **enterprise-ready**: a specified package workspace that a Tier 1 contractor can trust for closed regional procurement, then national use. Bar is 70. Last honest score on staging `d0699a4` was **59/100**. Live rail remains 12. Production remains **BLOCKED**.

Work top to bottom — live-rail config first, then remaining operational evidence. Specify → Compare → Award was re-walked on localhost (23 September 2026). Localhost axe WCAG 2 A/AA was clean on the public first-journey pages and the signed-in dashboard. Real-device confirmation is still outstanding. Expo Buyer/Supplier workspace, production EAS store profiles, and Play/App Store listing copy are in `mobile/`; Apple/Google Console accounts, reviewer demos, device screenshots, and the Stripe-versus-store-billing decision remain open. Do not submit store binaries until production APIs match the packaged app.

Repository engineering for payment ledger, privileged MFA, trusted client IP, own-tender IDOR, Project/Award schema, frozen package revision, PO on accept, four-eyes ControlChange, conversion funnel, measured contractor units, Award/Project backfill, county operating-location remap, `/user` buying URLs, Year 1 fixed release fees, sandbox password repair, workspace 403, Trade Tender IDs, automated-verification copy, and native store packaging is in code. Live Stripe, Resend, Sentry, retention, an approved staging deploy SHA, real-device QA, store Console setup, and paid-plan capacity evidence remain Before Production items.

Actions below include the 2026-09-22 enterprise due-diligence recommendations. Existing tracker items were kept where still open; due-diligence items that already appeared here or were closed as Year 1 product decisions were not duplicated.

### Before Production

- [ ] Configure Stripe. Add live keys, register a production webhook at `/api/webhooks/stripe`, store its signing secret, then test payment confirmation, refund, and chargeback handling.
- [ ] Verify Resend for production. Verify the sending domain, set `EMAIL_FROM`, and send an email-verification and contact-release test. Staging is already verified (2026-08-31).
- [ ] Configure the retention job: set `RETENTION_JOB_URL` as a production GitHub Actions environment secret to the full production origin plus `/api/internal/retention`, and set the production GitHub `RETENTION_JOB_SECRET` to exactly the same random value configured as Render production `RETENTION_JOB_SECRET`. Then run the workflow manually and retain a successful run as evidence.
- [ ] Configure Sentry for production and confirm one test event. Set browser/server DSNs and verify a scrubbed error event arrives. Staging is already verified.
- [ ] Handle Stripe refunds and disputes. Implementation complete in `6377097`. Outstanding: apply the reversal migration in staging and complete provider-side verification.
- [ ] Make deployment gates govern Render, not Azure. Implementation and hook configuration complete in `e676e12`. Outstanding: run one approved staging deployment and verify that the recorded deployment matches the requested commit.
- [ ] Re-run release validation against the deployed staging SHA. The current health-check record predates the staging tip. Re-run CI, PostgreSQL migration replay, workflow checks, and staging verification for the exact deployed commit; require the recorded SHA as release evidence. This also covers verifying the already-completed Next.js 16 upgrade against the deployed staging environment.
- [ ] Confirm on staging that password reset and MFA enrollment or disablement invalidate prior JWT sessions (`sessionVersion`).

### Production Readiness

- [ ] Complete load and recovery evidence for the 1,000-concurrent-user target with representative staging tests, documented capacity limits, and alerting evidence.
- [ ] Do not market a national launch or Cyber Essentials / ISO 27001 claims until the evidence pack exists. Keep any live use as a closed regional pilot.

### Security and Compliance

- [ ] Point production at a durable storage location (`ATTACHMENT_STORE_DIR` outside the default ephemeral directory, or `STORAGE_DRIVER` / `STORAGE_LOCATIONS`). Do not add a single-instance host disk as the durable store. Session downloads, checksums, and the export/relocate scripts are in place. Outstanding: independent malware scanner, and a verified backup of the export manifest.
- [ ] Commission an independent web penetration test after live Stripe is proven; close Critical and High findings before wider access.
- [ ] Execute processor DPAs (Render, Neon, Stripe, Resend, Sentry, Consulthub), a DPIA, and a DSAR/erasure runbook that covers database, files, backups, email, and observability stores.
- [ ] Name deputies for deploy, Stripe, and incidents so production operations are not a single-person dependency.

### Engineering Work

- [ ] Complete accessibility, real-device, and first-journey QA, including a repeatable axe pass on a physical device (P2-M01 / P2-M03). Localhost axe WCAG 2 A/AA was clean on `/`, `/login`, `/register`, `/security`, `/demo`, and `/user` on 23 September 2026. Mobile nav hit targets are 44px. Real-device confirmation is still outstanding.
- [ ] Establish production capacity and availability evidence. Free-tier Render services have no demonstrated path to the required 1,000 concurrent users. Select an appropriate plan, document connection/scaling limits, configure alerts, and pass representative load and recovery tests.

### Native app and store release

- [ ] Confirm `MOBILE_AUTH_SECRET` (32+ characters) is set on Tender Staging and Trade Tender production in Render. Do not commit or paste the value. Staging `POST /api/mobile/auth/login` is live; the secret is only proven after a successful mobile login.
- [ ] Walk the internal preview APK against staging: register or use verified Buyer and Supplier accounts, create a tender, unlock, quote, accept with a purchase order number, then messages / site-visit contact. Keep that evidence for the mobile stress-test gate. Do not use this APK as a store binary.
- [ ] Enrol in the Apple Developer Program, create the App Store Connect app with bundle ID `com.tradetender.app`, and configure EAS iOS distribution credentials plus an App Store Connect API key. Listing copy is in `mobile/store.config.json`. Do not submit for public review until production serves the current mobile APIs.
- [ ] Create the Google Play Console app with package `com.tradetender.app`, link a Play Developer API service account, and store `mobile/google-service-account.json` locally (gitignored). Paste listing and Data safety from `mobile/store/play-en-GB.json` and `mobile/store/play-data-safety.json`. First `eas submit` stays internal/draft.
- [ ] Capture phone screenshots for both stores and a 1024×500 Play feature graphic from a physical device. Add App Review / Play review demo accounts (verified Buyer and Supplier) in the consoles only — never in git.
- [ ] Decide before any store submit whether Stripe Checkout for unlock and contact-release fees is acceptable under Apple 3.1.1 and Google Play Billing, or whether store in-app purchase products are required. Do not weaken server-side payment, audit, or contact-release controls to get a listing.
- [ ] Build production AAB and iOS store binaries (`npm run build:android:store` / `npm run build:ios:store` from `mobile/`) only after `https://trade-tender.onrender.com` serves the current mobile JSON APIs and production `MOBILE_AUTH_SECRET`. Upload as TestFlight / Play internal draft. Do not auto-release or enable EAS Update.

### Data, Product, and Marketplace

- [ ] Run a closed regional beachhead (one geography, limited trades, invited demand) and instrument match → unlock → quote → accept → release before any national acquisition spend. Conversion funnel exists in Super User code. Owner MFA is required for Owner accounts only; Super User and marketplace accounts do not enroll. The ops board flags a missing or placeholder `PLATFORM_OWNER_EMAIL` and Owners with MFA off. Outstanding: set a real `PLATFORM_OWNER_EMAIL` on each environment and complete Owner MFA enrollment.
- [ ] Before enterprise sales, move sponsored placements off the quote-comparison surface. Year 1 launch keeps sponsorship on comparison (founder decision 2026-09-18); this is not a Year 1 reopen.

### Operations and Recovery

- [ ] Run and time a production backup restore. Publish RTO/RPO, name an incident owner, and keep a written incident/severity runbook.
- [ ] Verify protected GitHub environments, branch rules, required checks, Render deploy hooks, and named release/rollback ownership.

### Later (not launch blockers)

- [ ] Public versioned API for integrations.
- [ ] SSO/SAML for larger Client organisations.
- [ ] Generative AI tender authoring only after DPIA, contractual “no training on customer jobs,” and human-in-the-loop controls.
- [ ] Activate Provider subscriptions only after paid-unlock conversion is evidenced.

## Routine Checks

Run before opening a pull request or deploying:

```bash
# keep this section for release validation commands as they are added
npm run stress-test -- --base-url https://<staging-origin>
```
