# OWL LAB Desktop — Friend Beta P0.3 Status

Date: 2026-10-07

Status: **local P0 lifecycle hardening substantially closed; friend-beta release
still gated by onboarding/owner acceptance, Cloud/transport revalidation and
source publication.**

This document is the current truth table. It does not rewrite the historical
2026-10-01 findings.

## Exact local baseline

```text
Desktop main: becb35492d19e312f9631996e8c7b4d58f46d11b
Runtime main: 893a5a98f159ce98212dd728afabd8889630d26e
Runtime:      1.0.0-rc.4
Runtime API:  0.1
Cloud main:   9cd8f291e3dc5183e2e4504bd4a2bd5050c32b4b
```

Desktop and Runtime are currently ahead of their remotes. Git push remains
disabled by normal Runtime policy.

## P0 / automated acceptance truth table

| Gate | 2026-10-07 status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| A1 exact packaged Runtime identity | **PASS locally** | Active component pin moved to Runtime `893a5a9`; release-components verifier PASS; packaged local bootstrap PASS; exact Runtime version/API/codeRoot/stateRoot verified | Clean-machine reproducibility waits for exact Runtime Git object publication |
| A2 Runtime execution access | **PASS automated path** | Runtime access client and effective-access tests PASS; readiness requires Runtime `READY`, not account identity alone | Re-run against next packaged friend-beta account/device |
| A9 Runtime restart + reauthorization | **PASS deterministic recovery path** | Stored refresh-token session resumes Cloud account/lease and reprojects Runtime access to `READY` without interactive login; dedicated recovery tests PASS | Owner-assisted packaged Runtime restart/reopen still required before friend distribution |
| A10 launchd repeated restart / error 5 | **PASS implementation + bootstrap repetition** | Controlled teardown wait, bounded bootstrap retry and healthy-current no-churn tests PASS; official local bootstrap verifier passed twice consecutively with current Runtime pin | Run packaged restart stress on the next artifact |
| A11 wrong Runtime / port owner | **PASS automated** | Foreign Runtime on configured port is rejected by identity-aware bootstrap test; DEV also refuses unknown/stale owner on its isolated port | Packaged artifact smoke on next candidate |
| P0.2 session/tunnel lifecycle | **PASS live dogfood** | One authoritative Tunnel, transient Runtime session TTL/retention/cap, workstream GC, compact host health, error taxonomy and resource-admission fixes live-verified | Preserve in package baseline |
| Source gate | **PASS** | Desktop full gate: 60/60 test files, 282/282 tests; TypeScript/Vite build PASS; `git diff --check` PASS | Re-run after subsequent P0/P1 edits |

## Runtime release baseline correction

The 2026-10-01 internal RC embedded Runtime `4e24c19f...`.

That SHA is historical evidence only.

The active 1.1 local release baseline now pins:

```text
893a5a98f159ce98212dd728afabd8889630d26e
```

This is necessary because Reliability P0.2 lives in that Runtime revision.

Validated with the current pin:

- Runtime stage from the exact local sibling checkout: PASS;
- Runtime Host universal arm64/x86_64 rebuild: PASS;
- OWL LAB Helper universal arm64/x86_64 rebuild: PASS;
- release-components verifier: PASS;
- packaged local Runtime bootstrap: PASS;
- official bootstrap verifier repeated twice consecutively: PASS.

One bootstrap attempt immediately after universal native-component compilation
returned a transient `fetch failed`. The same staged components passed a
dedicated launchd debug bootstrap and then two official verifier runs. The
health timeout was not widened based on that single transient observation.

## A9 reconnect contract

The Desktop recovery path is now isolated behind a testable service:

```text
Runtime online again
  -> Cloud account already ready
  -> recover device identity from encrypted credential
  -> resume stored account refresh token
  -> refresh effective access / Runtime lease
  -> project Runtime access
  -> READY
  -> update Desktop account state
```

No interactive login is required when the stored Cloud session remains valid.

The live DEV stack was intentionally not killed to prove this because the
current `dev:full` treats Runtime child exit as fatal to the complete DEV
stack. Packaged/owner restart acceptance remains explicit rather than risking
the active dogfood environment.

## P0/P1 work still open

### First-run onboarding / B1

**IMPLEMENTED — automated lifecycle/model PASS; fresh packaged owner acceptance still open.**

Current product now has:

- a dedicated first-run shell that replaces the control-plane dashboard until
  setup is explicitly completed;
- persistent `onboardingInProgress / onboardingCompletedAt` lifecycle state;
- migration protection so an already enrolled device is not forced back through
  first-run setup;
- aggregate readiness states:
  `LOCAL_RECOVERY / SETUP_REQUIRED / AUTHORIZATION_REQUIRED /
  CHATGPT_CONNECTION_REQUIRED / READY`;
- a four-step setup projection:
  Local Runtime → OWL LAB account/device → execution access → ChatGPT connection;
- one primary action for the current setup state;
- normal setup copy that requires no Terminal, port, Tunnel ID or API key;
- packaged Runtime startup presented as `Preparing this Mac` instead of a false
  recovery failure while the first Runtime probe is still pending;
- READY requires both local Runtime and execution access plus remote transport;
- explicit `Enter OWL LAB` completion before the normal dashboard appears;
- Repair Runtime, Reauthorize and connectivity recovery actions for genuine
  failures.

Automated evidence:

- onboarding lifecycle tests PASS;
- onboarding readiness-step model tests PASS;
- full Desktop gate after onboarding changes:
  **62/62 test files, 289/289 tests PASS**;
- TypeScript/Vite production build PASS;
- `git diff --check` PASS.

Still required before claiming B1 owner PASS:

- fresh packaged profile walkthrough on a clean/secondary Mac;
- confirm the user understands sign-in and ChatGPT connection without docs;
- verify Advanced Settings remain unnecessary for the normal path.

### Cloud / managed transport

Still requires current-Cloud revalidation:

- Cloud Bridge route/capability compatibility;
- no persistent NOT_FOUND loop;
- managed transport provisioning as the normal flow;
- no manual Tunnel ID/API key in normal-user onboarding.

### Distribution

Still blocked by:

- Runtime `893a5a9` not yet published to canonical origin;
- Desktop local commits not yet published;
- clean-Mac friend-beta acceptance;
- public signing/notarization credentials for a public release.

## Next serialized boundary

Do not reopen Runtime feature scope.

Proceed in this order:

1. close/owner-test first-run onboarding and aggregate readiness;
2. revalidate current Cloud Bridge + managed transport against Frankfurt;
3. build the next arm64/x64 friend-beta artifact from the exact 1.1 baseline;
4. run packaged restart/recovery and clean-Mac acceptance;
5. only then create an immutable 1.1 release-candidate manifest.
