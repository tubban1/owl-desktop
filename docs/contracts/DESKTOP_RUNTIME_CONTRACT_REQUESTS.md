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

**Status:** **AgentRequest-required durable public event subset delivered; broader observability stream remains open.**

Runtime now exposes the durable public event foundation required by
CR-DESKTOP-010 through RuntimeEventRuntimeClient / events.list, including
monotonic sequence/cursor replay, bounded retention and explicit cursor-expiry
semantics. OWL Desktop consumes that subset with a durable cursor and explicit
reconciliation.

The remaining request in CR-DESKTOP-002 is the broader Control-plane
observability projection for session/task/process/provider logs and filters.

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

## CR-DESKTOP-010 — Runtime AgentRequest producer events

**Status:** **Runtime producer delivered and Desktop public-event consumer live accepted.**

Accepted Runtime producer baseline:

~~~text
owl-runtime
a44c5d26636c71faf8a8c146ef43e2af71332b11
~~~

Desktop consumes the producer only through events.list, materializes one
canonical local Agent Inbox, and enters needs_attention rather than advancing
past an unrecoverable cursor/retention gap.

**Owner:** owl-runtime 1.x.

**Depends on:** CR-DESKTOP-002 durable/replayable Runtime event streaming.

**Need:** Runtime must be able to surface deterministic states that require semantic reasoning without embedding an LLM and without creating a second Agent Inbox.

Runtime remains the owner of the underlying Task / Skill Candidate / verification / execution truth. Desktop remains the owner of local AgentRequest coordination state.

Recommended event model:

~~~text
Runtime canonical state
  -> agent_request.proposed
  -> Desktop Agent Inbox

Runtime issue resolved independently
  -> agent_request.withdrawn
  -> Desktop cancels matching pending request
~~~

A proposal should contain only structured coordination metadata:

- stable proposal ID;
- event ID / sequence / cursor;
- request type;
- priority;
- subject reference (kind, id, optional revision);
- reason code;
- bounded error codes;
- context references to canonical Runtime objects;
- allowed coordination actions;
- whether later consequential work still requires user confirmation;
- deterministic dedupe key;
- created/updated timestamp.

It must not contain arbitrary prompt text, hidden instructions, secrets, raw document/message bodies, copied source code when a canonical Runtime reference exists, or permission grants.

Candidate producer examples:

- Skill Candidate validation requires semantic repair/generalization;
- repeated verified workflows are strong enough to propose Skill generalization;
- a Task failed in a way that deterministic retry cannot resolve;
- a verification mismatch needs explanation/replanning;
- an unresolved ambiguity needs an LLM but is safe to defer.

Do not propose AgentRequests for deterministic retries, normal approval decisions, permission escalation, or cases Runtime can resolve itself.

Required invariants:

1. Runtime does not persist Desktop claim/lease/completion state.
2. Desktop does not mutate Runtime canonical Task/Candidate state when an AgentRequest is claimed/completed.
3. Runtime events are durable/replayable so Desktop restart does not lose a proposal.
4. Duplicate/replayed proposal events materialize one Desktop AgentRequest.
5. A Runtime withdrawal cancels only the matching still-pending request; it must not erase audit history.
6. Agent completion does not imply Runtime success; Runtime state must independently confirm the result.
7. AgentRequest never bypasses Runtime policy, Approval, Resource Arbiter, Verifier, Skill promotion gate, or user confirmation.

Acceptance:

- Runtime can emit one deterministic proposal from a test Task/Candidate condition.
- Desktop can materialize it once through event replay.
- ChatGPT can discover/claim it through OWL MCP.
- ChatGPT can use normal Runtime APIs to repair/replan.
- Runtime independently validates the result.
- Desktop marks coordination complete only after the referenced work is actually handled.
- Restart/reconnect/replay does not duplicate the request.

See docs/contracts/AGENT_REQUEST_V1.md.


## CR-DESKTOP-011 — Detached long-task execution + truthful frontend progress

**Status:** **Runtime baseline delivered and integration-verified.**

Accepted Runtime baseline:

~~~text
owl-runtime
852fdb4eb7595800eb1c3e64e822b15cf5528ef6
~~~

**Owner:** owl-runtime Task contract; consumed by OWL MCP / Desktop / agent frontends.

**Problem:** Long-running Tasks can outlive an interactive AI frontend request window. Keeping one MCP/HTTP request open for minutes makes Runtime correctness depend on ChatGPT, gateway and transport idle limits. Sending fabricated heartbeat text merely to keep a socket alive would hide the real lifecycle instead of fixing it.

**Contract:** long work is detached from the interactive transport. Runtime accepts a durable Task start quickly, continues execution independently, and exposes a bounded progress projection from canonical Task state. ChatGPT or another consumer polls that projection and may surface a concise user-facing update before its own frontend idle deadline.

Runtime surfaces:

- `tasks.start` / MCP `task_start`: start or resume durable execution and return an acceptance receipt without waiting for the Task to finish;
- `tasks.get` / MCP `task_status`: expose canonical Task state plus a `progress` projection;
- existing `tasks.run` / `task_run` remains as the synchronous compatibility path.

Minimum `progress` projection:

- monotonic `revision` advanced by real Task lifecycle events;
- `phase` and terminal flag;
- bounded step counts (total/pending/running/waiting approval/succeeded/failed/needs review);
- currently active step IDs/actions and elapsed active time;
- latest privacy-bounded meaningful Runtime event and timestamp;
- short human-readable message derived from Runtime execution state;
- recommended consumer poll interval;
- no secrets, raw prompt bodies, credentials, or unbounded stdout.

Required behavior:

1. Runtime Task execution does not depend on the original ChatGPT/MCP/HTTP request staying connected.
2. Repeating `task_start` for an already active Task is idempotent at the Task lifecycle level and reports the current canonical state instead of starting a competing run.
3. Progress revision changes only when Runtime records a real lifecycle event. Elapsed time may advance between revisions but must not be represented as fabricated work.
4. ChatGPT/MCP consumers may send a concise progress message before their frontend idle deadline using the latest real projection; they must not invent actions or completion.
5. Terminal success/failure/block/cancel remains canonical Task state, never inferred from a frontend heartbeat.
6. Restart/reconnect uses the durable Task record. A new consumer can call `task_status` and continue from the current progress revision.
7. The existing v1 public event journal remains the AgentRequest channel. `task.progress` is not inserted into that global sequence because filtered consumers currently require contiguous AgentRequest sequence/cursor semantics.
8. Native MCP progress notifications or a future broader observability stream may be added later as transport/UI optimizations, but are not required for execution correctness.

Acceptance:

- Starting a synthetic long Task returns a durable acceptance receipt promptly while execution continues.
- Disconnecting the initiating transport does not cancel the Task.
- Repeated status reads expose a monotonic progress revision and truthful current active-step elapsed time.
- A repeated start does not create a second competing run.
- ChatGPT can surface periodic real progress updates without keeping one Runtime request open.
- Restart/reconnect can recover the Task and its latest progress from durable state.
- Existing AgentRequest event replay remains gap-free and unchanged.
