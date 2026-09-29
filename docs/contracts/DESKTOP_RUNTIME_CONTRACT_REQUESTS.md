# OWL Desktop → Runtime Contract Requests

Status: **Active integration backlog**.

OWL Desktop must not fill these gaps by reading Runtime internals or creating a second execution state model.

## CR-DESKTOP-001 — Session inventory projection

**Need:** Control must show active/recent logical consumer sessions and associate work with the owning session.

Requested Runtime surface:

- stable logical session ID
- session state / last-seen timestamp
- owned task/process counts or references
- transport-independent identity
- read-only projection only

Acceptance: reconnecting the same logical session does not create a duplicate identity; Desktop never reads Runtime state files.

## CR-DESKTOP-002 — Cursor-based event/log stream

**Need:** Control must show near-real-time logs separated by session, task, process and provider.

Requested semantics:

- monotonic cursor
- bounded history query
- filters for sessionId/taskId/processId/providerId/level
- reconnect from last cursor
- explicit gap/truncation marker
- no secret-bearing payloads by default

Acceptance: disconnect/reconnect can resume without inventing or duplicating events.

## CR-DESKTOP-003 — Usage/telemetry projection

**Need:** local dashboard needs trustworthy usage counts without deriving execution truth from Desktop-side guesses.

Requested projection:

- calls/tasks/processes by time window
- success/failure/cancelled/uncertain counts
- duration summary
- provider/capability grouping
- no billing semantics

Acceptance: metrics are derived from canonical Runtime audit/event records.

## CR-DESKTOP-004 — Runtime host lifecycle readiness

**Need:** Desktop owns packaging and host lifecycle, but requires an explicit daemon readiness/shutdown contract.

Requested provider behavior:

- deterministic ready signal
- graceful shutdown hook
- version/API report before accepting traffic
- startup failure diagnostics
- no mutation of Runtime execution semantics

Desktop may spawn/supervise the process; Runtime remains execution authority.

## CR-DESKTOP-005 — Consequential request replay / idempotency

**Need:** Local E2E Gate 3 requires transport retry to never duplicate a consequential side effect after the first attempt may already have reached Runtime.

Current Runtime HTTP request IDs provide cancellation ownership, but the public contract does not yet define completed-request replay or duplicate-request suppression.

Requested semantics:

- idempotency/replay key scoped to stable logical session identity
- duplicate in-flight request returns or joins the original execution
- duplicate completed request returns the canonical prior result/receipt
- bounded retention policy is explicit
- uncertain completion remains explicit; Desktop must not retry through another backend
- consequential calls cannot rely on Desktop-local dedupe as execution truth

Acceptance: fault injection after Runtime acceptance and before MCP response delivery proves one consequential execution and one canonical receipt.

## CR-DESKTOP-006 — Named browser profile/session binding

**Need:** Identity & Session Vault can identify an external account, but Runtime currently exposes one configured/default Chromium profile rather than a public per-account profile binding contract.

Requested semantics:

- stable `browserProfileId` owned by Runtime;
- create/list/status/retire profile metadata through a public Runtime contract;
- Primitive/Skill execution may request an explicit allowed profile binding;
- Runtime owns profile directory, CDP lifecycle, locking and crash recovery;
- Desktop stores only the account → `browserProfileId` reference;
- no raw cookie/session database export to Desktop;
- profile use remains subject to Runtime policy and execution ownership.

Acceptance: two external accounts for the same service can remain logged in concurrently, an action explicitly selects the intended account/profile, and Runtime proves profile isolation without Desktop reading browser state files.

## CR-DESKTOP-007 — Production Runtime Host artifact

**Owner:** owl-runtime.

Desktop release assembly needs a provider-owned native Host artifact rather than rebuilding Runtime Host source itself.

Requested artifact:

- bundle ID remains `fan.fde.owl.runtime`;
- stable independent Host version;
- universal arm64 + x86_64 Mach-O, or separately versioned signed artifacts with identical bundle identity policy;
- Developer ID signature suitable for notarized Desktop distribution;
- machine-readable version/fingerprint manifest;
- ordinary Runtime code updates remain compatible without replacing the Host;
- explicit native-host upgrade semantics preserve/revalidate macOS permissions.

Acceptance: Desktop can stage the exact signed artifact, verify architecture/signature/version, install it only when missing or explicitly upgraded, and never compile a competing Host implementation.

## CR-DESKTOP-008 — Versioned OWL Tunnel artifact and secret handoff

**Owner:** OWL Tunnel transport provider / Cloud transport boundary.

Requested contract:

- explicit tunnel protocol version;
- signed/versioned arm64 and x64 macOS binaries;
- deterministic readiness/health projection;
- reconnect semantics independent from Runtime task/process state;
- loopback MCP target contract;
- secret handoff through Keychain provider, inherited file descriptor, stdin, or equivalent non-persistent mechanism;
- compatibility manifest consumable by OWL Desktop packaging.

Current compatibility binary v0.0.15 accepts `file:` API-key input, so Desktop uses a 0600 ephemeral file only while the process is running. This is transitional and not the preferred production secret transport.
