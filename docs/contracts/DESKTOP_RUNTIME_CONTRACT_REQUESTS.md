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

## CR-DESKTOP-009 — User Skill Registry, candidate validation and evidence-backed promotion

**Owner:** owl-runtime 1.x.

**Priority:** post-1.0 / non-blocking for Runtime 1.0 stable.

**Observed baseline:** current AgentOS Runtime 1.0.x has a static built-in Skill catalog. Unknown Skill IDs are rejected. Durable workflow learning currently persists as Task -> M2 Episodic -> optional M3 Semantic Memory; it does not create an executable Skill.

**Need:** add a canonical User Skill lifecycle that reuses the existing Primitive, durable Task, evidence, privacy/quality gate, Approval and verification architecture.

Requested Runtime surface:

Candidate ingestion / repair loop:

- `candidate.submit`
- `candidate.get`
- `candidate.revise`
- `candidate.validate`
- `candidate.dismiss`

Test/evidence:

- `candidate.compile_test`
- `candidate.test`
- `candidate.inspect`

Promotion:

- `candidate.promote`

Canonical Registry:

- list installed Skills and immutable versions;
- install/promote exactly one validated digest;
- enable/disable;
- activate a specific version;
- roll back;
- uninstall version/Skill;
- report provenance/digest/integrity/compatibility;
- expose canonical availability based on Primitive/provider/policy/permission state.

Validation result must be machine-readable and suitable for an external LLM repair loop. It should include stable error codes, target ABI versions, field/file references where possible, required/allowed Primitives, contract mismatches, and a candidate/package digest.

Required invariants:

- Desktop never writes Runtime Skill Registry files directly;
- Desktop/Runtime do not require an embedded LLM for semantic repair;
- ChatGPT/AI Worker may revise Candidate content but cannot bypass validation/promotion;
- Cloud distribution does not bypass local Runtime validation;
- user Skills execute through the same Approval, Resource Arbiter, Primitive ABI and Verifier boundaries as built-ins;
- declarative user Skills cannot call provider internals or L0.5 Actions directly;
- test execution should reuse durable Task semantics where possible;
- promotion evidence references real Task/M2 evidence rather than an LLM self-assessment;
- M3 Semantic Memory remains knowledge/procedure memory and is not executable Registry state;
- one successful Task cannot silently auto-activate a new Skill;
- Skill versions are immutable and reversible;
- Candidate revisions and installed packages are digest-bound;
- promotion installs exactly the digest that was validated/tested/reviewed;
- candidate provenance links back to evidence without embedding user secrets in catalog metadata.

Suggested promotion gate inputs:

- schema validation;
- Skill ABI / Primitive ABI compatibility;
- required Primitive closure;
- execution contract;
- risk / side effects / resources;
- verification plan;
- package integrity;
- test Task result;
- unresolved side-effect review;
- M2 evidence digest;
- quality gate;
- privacy gate;
- candidate digest.

Acceptance:

1. An external Skill submitted by ChatGPT/Desktop becomes a Candidate, not an installed Skill.
2. Invalid Candidates return deterministic machine-readable repair errors.
3. A revised Candidate can be revalidated without creating duplicate ambiguous state.
4. A valid Candidate can compile/run as a controlled test Task.
5. Runtime records evidence and exposes promotion readiness.
6. User confirmation promotes exactly the validated/tested Candidate digest.
7. Installed Skill appears in the canonical Runtime Registry/catalog and executes under normal policy.
8. Update creates a new immutable version without mutating the old one.
9. Rollback reactivates a previous immutable version.
10. Repeated-work discovery may propose Candidates, but M2/M3 memory alone never silently becomes an installed Skill.

See `docs/skills/SKILL_MANAGER_V1.md` for the Desktop product contract.
