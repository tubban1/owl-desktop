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
