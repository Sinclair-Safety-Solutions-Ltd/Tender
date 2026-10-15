# Mobile biometric authentication

Trade Tender’s native app is Expo / React Native (`mobile/`). Web login stays NextAuth cookies. Mobile login stays `POST /api/mobile/auth/login` (USER only) and an 8-hour HS256 access JWT. Biometric login extends that path. It does not replace it.

## Architecture overview

1. The user signs in with email and password (and authenticator code if that account has MFA).
2. The server issues a short-lived access token. Authorization, roles, suspension, and `sessionVersion` are still checked on every protected request.
3. If the device can protect secrets, the app may offer Face ID, Touch ID, fingerprint, or device passcode for **this device only**.
4. After the OS verifies the user, the app registers a `MobileDevice` row and receives a refresh token **once**.
5. That refresh token is stored in Expo SecureStore with `requireAuthentication` (iOS Keychain / Android Keystore). The app never stores the password and never receives biometric templates.
6. Later launches prompt the OS, unlock the refresh token, and call `POST /api/mobile/auth/refresh`. Workspace access is granted only after that server check succeeds.

## Enrolment flow

1. Existing login (and MFA if required) succeeds.
2. Forced password change, if any, completes first.
3. The app checks hardware, enrolment, and `MOBILE_BIOMETRIC_LOGIN_POLICY`.
4. The user is asked, with privacy wording, whether to enable biometric login.
5. The OS prompt runs.
6. `POST /api/mobile/auth/devices` registers the device.
7. The refresh token is written to biometric-protected SecureStore. The access token is kept in memory only while biometric login is enabled.

Enrolment is never automatic. On eligible devices, policy `required` hides skip and refuses a settings disable; email/password stays available for devices without eligible biometrics. Sign-out still revokes that device.

## Token and secure storage

| Material | Where | Protection |
|---|---|---|
| Access JWT | Memory while biometric login is on; otherwise SecureStore `WHEN_UNLOCKED_THIS_DEVICE_ONLY` | Not biometric-bound |
| Refresh token | SecureStore `requireAuthentication` + `WHEN_PASSCODE_SET_THIS_DEVICE_ONLY` | OS biometric / passcode |
| Password, MFA secret | Not stored on device | Server only |
| Device meta (id, email, enabled) | SecureStore without biometric | Not a credential |

Refresh tokens are opaque, hashed with SHA-256 on the server, rotated on each refresh, bound to `sessionVersion`, and expire according to `MOBILE_REFRESH_TOKEN_LIFETIME_SECONDS` (default 90 days). `MOBILE_DEVICE_MAX_AGE_DAYS` (default 90) is an absolute cap from `MobileDevice.createdAt`; refresh rotation cannot extend past it. The client writes the rotated refresh token to the biometric vault before treating refresh as success; if that write fails, the new token is revoked. Password change, password reset, MFA enable/disable, and Super User temporary passwords increment `sessionVersion`, which rejects both old access JWTs and device refresh.

## Biometric login flow

1. Meta says biometric login is enabled on this install.
2. OS prompt runs.
3. Vault unlocks the refresh token, or the user is sent to email/password (re-enrolment if biometrics changed).
4. `POST /api/mobile/auth/refresh` validates the device, account, role (`USER` only), sign-in gate, and `sessionVersion`.
5. A new access token and rotated refresh token are issued.
6. Audit: `MOBILE_BIOMETRIC_LOGIN_SUCCEEDED` (no tokens in metadata).

Local biometric success is never treated as platform access.

## Step-up authentication

When biometric login is enabled, the app asks for a fresh OS verification immediately before:

- profile or company updates
- password change
- biometric-login setting
- adding an additional user
- tender unlock
- quote accept / contact release
- direct contact
- professional interest
- data-protection support requests

Validity is `MOBILE_STEP_UP_VALIDITY_SECONDS` (default 120) and is per action. App launch unlock does not satisfy step-up. The in-memory last step-up is cleared on password sign-in, sign-out, biometric lock/unlock, and inactivity re-lock, so a previous confirmation cannot cover a new session. Server payment, unlock, and contact-release rules are unchanged. Step-up is local presence, not a permission grant.

Owner, Super User, billing, and other operator consoles remain web-only.

## Logout behaviour

Sign out:

- calls `POST /api/mobile/auth/logout` with this device id
- revokes that device’s refresh token
- deletes access and biometric material on this device
- does not sign out other devices or the website

Re-enabling biometric login requires a full password (and MFA if applicable) sign-in on that device.

## Device revocation

`GET /api/mobile/auth/devices` lists the current user’s registrations (id, platform, status, dates — no tokens). `POST /api/mobile/auth/devices/revoke` accepts a refresh token or an authenticated device id. This is the foundation for a later “Manage trusted devices” screen. Administrators are not given a mobile console in this change.

## Administrative policy settings

Stored as `PlatformSetting` keys with defaults. There is no Owner UI in this change (operator consoles stay web and were not extended). Keys:

- `MOBILE_BIOMETRIC_LOGIN_POLICY`: `disabled` \| `optional` \| `recommended` \| `required` (default `optional`)
- `MOBILE_DEVICE_CREDENTIAL_FALLBACK`: `true`
- `MOBILE_STEP_UP_VALIDITY_SECONDS`: `120`
- `MOBILE_DEVICE_MAX_AGE_DAYS`: `90` (absolute age from device registration; refresh also checks this, not only `expiresAt`)
- `MOBILE_REFRESH_TOKEN_LIFETIME_SECONDS`: `7776000`
- `MOBILE_ACCESS_TOKEN_LIFETIME_SECONDS`: `28800`
- `MOBILE_INACTIVITY_TIMEOUT_SECONDS`: `0` (disabled; matches current product)
- `MOBILE_STEP_UP_ACTIONS`: JSON array of action ids

`required` does not lock out password login on devices without biometrics. Eligible devices cannot skip enrolment or turn the setting off while the policy is `required`.

Rooted/jailbroken-device blocking is **not** implemented. The existing security policy has no such control; adding a client-only detector would be theatre. Documented limitation.

## Offline limitations

The app has no offline marketplace mode. Biometric success does not create offline access. Cached session restore still needs a successful refresh or a still-valid access token for non-biometric users.

## Error handling

OS and server failures fail closed. Typical copy:

- unsupported / no hardware
- no biometrics enrolled
- cancelled / failed / temporary lockout
- secure credential unavailable / biometrics changed (re-enrol)
- session expired / device revoked / sign-in closed

Email and password remain on the lock screen. The app does not retry prompts in a loop.

## Privacy

Exact user wording:

“The application does not collect, store or process your fingerprint, facial image or biometric template. Biometric verification is performed by your device’s operating system. The application receives only the authentication result required to provide the biometric-login feature.”

Device registrations and audit events **are** personal/operational data and are described in `/policies/privacy`.

## Audit events

`MOBILE_DEVICE_REGISTERED`, `MOBILE_BIOMETRIC_ENABLED`, `MOBILE_BIOMETRIC_DISABLED`, `MOBILE_DEVICE_REVOKED`, `MOBILE_BIOMETRIC_LOGIN_SUCCEEDED`, `MOBILE_TOKEN_REFRESH_REJECTED`, plus client-reported `MOBILE_BIOMETRIC_LOGIN_*` / `MOBILE_STEP_UP_*` / `MOBILE_FULL_REAUTHENTICATION_REQUIRED`. Metadata is `channel` / `platform` / `reason` only.

## Test coverage

- Server: register, refresh rotation, `sessionVersion` invalidation, revoke, disabled policy, device max-age, no refresh token in audit metadata.
- Mobile source: Face ID usage string, SecureStore `requireAuthentication`, enrolment copy, no password in the biometric vault, step-up action list, step-up cleared on session boundaries, vault write before session save on refresh, logout clears the vault.
- Physical Android and iOS devices are still required before store submit. Simulators do not prove biometric security.

## Known limitations

- No refresh for users who decline biometric login (existing 8-hour access JWT restore).
- Access JWTs are not denylisted; logout revokes the refresh token and deletes local material. Residual access JWT lifetime is the pre-existing 8-hour window if it was copied off-device.
- iOS Keychain items can survive reinstall with the same bundle id; the app treats a missing/invalid vault as re-enrolment and still requires server refresh.
- Step-up is enforced in the app when biometric login is enabled. Server APIs still require a valid bearer and existing authorization; they do not independently prove that the OS prompt ran.
- Marketplace `USER` only. Owner/Super User remain 403 on mobile login.
- No rooted/jailbroken detection (no existing policy).
- `MOBILE_INACTIVITY_TIMEOUT_SECONDS` default `0`.

## Android and iOS configuration

- Plugin `expo-local-authentication` with Face ID usage copy.
- Plugin `expo-secure-store` Face ID copy + Android backup exclusion.
- `NSFaceIDUsageDescription` in `app.json`.
- No camera permission (OS facial authentication is not app camera access).
- `USE_BIOMETRIC` comes from the Expo module.
- Play Data safety notes that biometric templates are not collected.
- A new binary is required; this is source parity, not an EAS Update.

## Deployment

1. `npx prisma migrate deploy` (adds `MobileDevice`).
2. Rebuild the Expo app (`eas build`) so Face ID and biometric Keystore options are in the binary.
3. Do not put `MOBILE_AUTH_SECRET` in the app.

## Rollback

1. Set `MOBILE_BIOMETRIC_LOGIN_POLICY=disabled`.
2. Ship a build that omits enrolment if needed.
3. Existing password login and 8-hour access tokens continue to work.
4. `MobileDevice` rows can remain; refresh is rejected when policy is disabled only for **new** registrations. To invalidate current biometric sessions, revoke rows or increment `sessionVersion`.

## Support guide

**Enable:** Sign in with email and password → accept the prompt, or open Profile → Biometric Login.

**Disable:** Profile → Biometric Login off, or Sign out (this device only).

**Unavailable biometrics:** Enrol Face ID / fingerprint / a passcode in system settings, then re-enable in Profile.

**Standard login:** Always available on the sign-in screen.

**Lockout:** Use email and password. Temporary OS lockout is not a Trade Tender account lock.

**Lost device:** Sign in on another device or the website and change the password (invalidates refresh). A trusted-device list UI is not shipped yet; `GET /api/mobile/auth/devices` is the server foundation.
