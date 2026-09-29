# Identity & Session Vault v1

Status: **Desktop-owned candidate contract**.

This contract covers external service identities that OWL may need while operating websites, SaaS products, social media or native applications.

It is separate from OWL Cloud account authorization.

## Authorities

- **OWL Cloud** owns OWL user/account/organization identity and effective device access such as `canView`, `canRun`, `canSchedule`, `canApprove`.
- **OWL Desktop** owns local storage and orchestration of external-service credentials and login sessions.
- **OWL Runtime** remains the final execution/policy authority for actions that use those sessions.
- The external service remains the authentication authority for its own account.

Desktop must not duplicate Cloud RBAC or Runtime policy.

## Supported authentication families

The account model supports:

- password
- OAuth
- third-party OAuth/login
- QR scan
- SMS OTP
- email OTP
- TOTP/authenticator code
- authenticator push
- passkey/WebAuthn
- device code
- native application session

These are not treated as equivalent secrets.

## Storage classes

### 1. Long-lived secrets

Examples: password, API token, refresh token, optional recovery code.

Rules:

- OS-backed encryption at rest;
- never returned to Renderer after storage;
- never written to logs;
- use is explicit and scoped to an account/service;
- deletion removes the encrypted local record.

### 2. Session artifacts

Examples: browser profile, OAuth session, native app login state.

Rules:

- prefer reusing the service/browser/native app's own session store;
- Desktop stores a reference/identity, not a copied plaintext cookie jar;
- do not export cookies or native application credentials merely to make automation easier;
- expiry/revocation is reported as session state.

### 3. Interactive factors

Examples: QR, SMS/email OTP, passkey, authenticator push.

These become **Login Challenges**.

Desktop must surface:

```text
needs_login
→ waiting_for_human
→ authenticating
→ ready | expired | failed
```

OWL must not bypass MFA, simulate human possession, or silently weaken a service's authentication requirement.

## TOTP policy

A TOTP seed is more sensitive than a transient TOTP code.

Default v1 behavior:

- do not require storing a TOTP seed;
- prefer human authenticator entry/approval;
- if managed TOTP is added later, it must be explicit opt-in with stronger local protection and audit.

## Browser login sessions

Each managed web account may reference a dedicated browser profile identity.

Preferred flow:

```text
Account
→ Managed Browser Profile
→ interactive login if needed
→ service session becomes ready
→ Runtime browser actions reuse profile
```

Profile ownership and browser-provider integration require a Runtime session/profile contract; Desktop must not read Runtime browser internals.

## Native app sessions

For WhatsApp Desktop, WeChat, Slack, desktop SaaS clients and similar apps:

- prefer the already-authenticated native application session;
- record that the account uses `native_app_session`;
- do not extract the application's password/session database;
- if the app presents QR/MFA again, surface a Login Challenge.

## OAuth and third-party login

OAuth tokens may be stored only when issued to OWL or explicitly imported.

For "Continue with Google/Apple/Microsoft/etc.":

- the identity provider flow remains interactive when required;
- Desktop may reuse the resulting browser session;
- OWL does not store the third party's primary password merely because another service uses it.

## Automation readiness

An account can expose local metadata such as:

- `canProvideStoredSecret`
- `requiresHumanChallenge`
- `browserSessionPreferred`
- `nativeSessionPreferred`

These describe login mechanics only. They are not Cloud permissions and are not Runtime execution capabilities.

## Cloud sync

Default: credential material and raw session artifacts do **not** sync to OWL Cloud.

Future optional encrypted sync requires a separate end-to-end encrypted vault contract and explicit user opt-in.

Cloud may store non-secret account references for UX only if the contract later permits it.

## Audit boundary

Audit may record:

- service
- account ID/label
- auth method
- challenge state
- successful/failed use
- session expiry/revocation

Audit must not contain:

- passwords
- OTP values
- TOTP seeds
- refresh tokens
- cookies
- recovery codes
