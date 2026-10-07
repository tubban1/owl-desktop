# OWL LAB Desktop — Friend Beta P0.3 Status

Date: 2026-10-07

Status: **local P0 lifecycle hardening substantially closed; friend-beta release
still gated by onboarding/owner acceptance, Cloud/transport revalidation and
source publication.**

This document is the current truth table. It does not rewrite the historical
2026-10-01 findings.

## Exact local baseline

```text
Desktop code baseline: 940622f6b6fb985495f3bba825347035e7168442
Runtime release pin:  8f553f6e4a00e8e2d571086d89041d9d224a0b22
Runtime repo HEAD:     8f553f6e4a00e8e2d571086d89041d9d224a0b22
Runtime:      1.0.0-rc.4
Runtime API:  0.1
Cloud main:   9cd8f291e3dc5183e2e4504bd4a2bd5050c32b4b
```

Desktop and Runtime are currently ahead of their remotes. Git push remains
disabled by normal Runtime policy.

## P0 / automated acceptance truth table

| Gate | 2026-10-07 status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| A1 exact packaged Runtime identity | **PASS locally** | Active component pin moved to Runtime `8f553f6`; release-components verifier PASS; packaged local bootstrap PASS; exact Runtime version/API/codeRoot/stateRoot verified | Clean-machine reproducibility waits for exact Runtime Git object publication |
| A2 Runtime execution access | **PASS automated path** | Runtime access client and effective-access tests PASS; readiness requires Runtime `READY`, not account identity alone | Re-run against next packaged friend-beta account/device |
| A9 Runtime restart + reauthorization | **PASS deterministic recovery path** | Stored refresh-token session resumes Cloud account/lease and reprojects Runtime access to `READY` without interactive login; dedicated recovery tests PASS | Owner-assisted packaged Runtime restart/reopen still required before friend distribution |
| A10 launchd repeated restart / error 5 | **PASS implementation + bootstrap repetition** | Controlled teardown wait, bounded bootstrap retry and healthy-current no-churn tests PASS; official local bootstrap verifier passed twice consecutively with current Runtime pin | Run packaged restart stress on the next artifact |
| A11 wrong Runtime / port owner | **PASS automated** | Foreign Runtime on configured port is rejected by identity-aware bootstrap test; DEV also refuses unknown/stale owner on its isolated port | Packaged artifact smoke on next candidate |
| P0.2 session/tunnel lifecycle | **PASS live dogfood** | One authoritative Tunnel, transient Runtime session TTL/retention/cap, workstream GC, compact host health, error taxonomy and resource-admission fixes live-verified | Preserve in package baseline |
| Source gate | **PASS** | OWL LAB self-dogfood launched the Desktop full gate as a durable process: 62/62 test files, 289/289 tests; TypeScript/Vite build PASS; `git diff --check` PASS | Re-run after subsequent P0/P1 edits |

## Runtime release baseline correction

The 2026-10-01 internal RC embedded Runtime `4e24c19f...`.

That SHA is historical evidence only.

The active 1.1 local release baseline now pins:

```text
8f553f6e4a00e8e2d571086d89041d9d224a0b22
```

Reliability P0.2 closed at `893a5a98f159ce98212dd728afabd8889630d26e`. Managed-process admission fail-fast landed at `125c8faf1bbc0fc9e7489af2e376836fba8db3f6`. Encrypted request-replay compaction landed at `edad5221302d098238b332aa15b44e240c6d8375`. The active `8f553f6` baseline preserves all three and adds bounded managed-browser profile storage.

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

## Runtime self-dogfood follow-up

While OWL LAB was used to modify and validate itself, one full Desktop gate
launch exposed a control-plane deadline bug:

```text
start_process
-> shell concurrency admission may wait 10,000 ms
-> outer Runtime/MCP request deadline is also 10,000 ms
-> capacity pressure could surface as Runtime request timed out
```

Runtime `125c8fa` fixes this by giving managed-process start a separate bounded
admission wait (`2,000 ms` default, `5,000 ms` hard maximum). Capacity pressure
now returns `SHELL_CAPACITY_BUSY` before the control-plane deadline instead of
appearing as a hung Runtime call.

Verifier evidence:

```text
managedStartAdmissionWaitMs = 1200
sameWorkspaceThirdWaitMs    = 814
siblingWorkspaceWaitMs      = 0
capacityBusyWallMs          = 1204
managedStartFailFast        = PASS
```

The same OWL LAB session then launched the complete Desktop test/build gate as
a durable managed process with `concurrencyWaitMs = 3`; it completed with exit
code `0`, 62/62 test files and 289/289 tests PASS plus the production build.

## Request replay retention follow-up

Runtime `edad522` separates replayable receipts from long-lived duplicate-
prevention evidence:

```text
*.state      = encrypted live receipt with bounded result/error replay payload
*.tombstone  = encrypted minimal key/digest terminal identity; never re-executes
```

Production keeps the 7-day response replay window. Development defaults to a
24-hour payload window so dogfood/test traffic cannot fill the live receipt
budget. Expired receipts are proactively compacted at startup and incrementally
thereafter. Tombstones do not consume the live receipt budget; both capacities
remain fail-closed rather than evicting duplicate-prevention identities.

Live DEV migration after loading `edad522`:

```text
before:  ~110 MB request-replay, ~7.4K live receipts, 0 tombstones
startup: 404 compacted, 5,156,904 bytes reclaimed
sweep:   5,231 more compacted, 66,610,164 bytes reclaimed
after:   ~44 MB request-replay, 1,420 live receipts, 6,041 tombstones
```

Regression evidence:

```text
expiredPayloadCompactsToEncryptedTombstone = PASS
expiredTombstoneNeverReexecutes            = PASS
tombstonesDoNotConsumeLiveRecordCapacity   = PASS
request cancellation                       = PASS
fault recovery                              = PASS
Runtime typecheck/build                     = PASS
```

## Managed browser storage follow-up

Runtime `8f553f6` makes the OWL-owned browser profile bounded and reclaimable
without deleting website login/session state.

Default managed-browser policy:

```text
extensions       disabled
Chrome sync      disabled
disk cache       64 MiB max
media cache      32 MiB max
```

Before launching a fresh managed Chrome, Runtime first attempts reconnect to any
surviving OWL Chrome. Only after proving no managed Chrome is using the profile
does it reclaim cache/package data. It preserves Cookies, Sessions, Session
Storage, IndexedDB, Preferences, Secure Preferences and extension settings.
When extensions remain disabled, the large extension package directory itself
is reclaimable; explicit `BROWSER_ALLOW_EXTENSIONS=true` preserves packages.

Live DEV cleanup:

```text
browser profile     761 MB -> 98 MB
.owl-runtime-dev    814 MB -> 151 MB
reclaimed           ~663 MB
Cookies             preserved
Sessions            preserved
IndexedDB           preserved
Preferences         preserved
```

Regression/live evidence:

```text
browser profile policy verifier             PASS
auth and site state preservation             PASS
extension opt-in preservation                PASS
browser startup/retry regression              PASS
browser cancellation/recovery                 PASS
real cleaned managed profile cold-start smoke PASS
Runtime production build                      PASS
```

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

- Runtime `8f553f6` not yet published to canonical origin;
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
