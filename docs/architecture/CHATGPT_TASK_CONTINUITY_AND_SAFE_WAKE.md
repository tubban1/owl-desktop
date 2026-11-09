# Task completion, interruption evidence, and safe ChatGPT continuation

Status: task-level read-only diagnosis implemented; consumer ChatGPT autonomous wake is **not** enabled.

## What OWL can prove

OWL Runtime Task status and step verification receipts are canonical execution evidence. The Monitor and orchestration_snapshot now distinguish running, queued, paused, waiting for approval, needs review, failed, completed (reported), and verified completed. The progress percentage is successful steps / total steps, **not an estimated remaining time**. A terminal status alone never confirms an external side effect was committed or delivered.

An interrupted ChatGPT response, a failing MCP stream, and a stopped Runtime Task are separate events. Correlation in time is not proof of causation. Missing Task heartbeats may indicate a long step or observer failure. No user goal should be retried solely because a ChatGPT message delivery timed out.

## Necessary end-to-end identity

Bind these identifiers to one authorized goal: goal_id, workstream_id, orchestration_id, task_id, step_id, MCP request ID, idempotency key, process ID, local Task progress revision, verification receipt. A ChatGPT conversation URL and account/session fingerprint may only be added after explicit user authorization and a verified binding. OWL cannot presently prove which ChatGPT conversation generated every historical primitive call.

## Recovery and notification rules

1. After any transport reconnect, query the canonical orchestration_snapshot or task_status before starting work. Rebind the original durable workstream; this restores OWL ownership, **not a halted model run**.
2. If Runtime Task still runs, monitor; never re-execute it. If status cannot be read, classify unknown pending reconciliation.
3. If completed, inspect verification before declaring verified. If failed, blocked or side-effect-uncertain, require reconciliation or approval; never assume rollback.
4. A separate one-time ChatGPT notification may be submitted into the **exact previously authorized conversation** using a bound Agent Browser session. It creates a new user turn, not resumption of the original generation. Do not fall back to an arbitrary tab. Verify same URL/account, no busy generation, and no unconfirmed browser send.
5. Persist a dedup notification key (conversation fingerprint, goal, terminal revision, notice type). Pause on uncertain send; do not automatically replay. Cap notifications and preserve consent/auth.
6. Where supported, native ChatGPT Scheduled Tasks or Work can send periodic/event-driven notifications. They are different from a general consumer ChatGPT conversation-write API.

## Acceptance still outstanding

- Across all tool calls: persist conversation-to-task correlation and trace lineage, and instrument client delivery acknowledgement independently.
- Atomic Runtime drain/checkpoint and idempotent continuation across disconnect/OTA (Desktop issue 107).
- Windows Guardian process-tree fault injection and postactivation rollback (109, 86).
- Windows Background Host after signout/reboot (44); provider upload and rich editor end-to-end (108).
- Account-scoped OAuth migration and removal of Cloud legacy JWT bypass (Cloud 7).
- Browser chat notification consent, exact conversation identity check, approval and verified once-only delivery.

Do not enable unattended outbound ChatGPT messages before identity, authorization, dedup, and failure-injection tests all pass.

## 2026-11-09 Recovery coordinator implementation plan

A ChatGPT connection is an observer and conversational planner, not the
execution authority for an OWL Runtime Task. Runtime tasks, external effects
and the current ChatGPT turn have separate status machines.

### End-to-end envelope

Persist one immutable goal binding with these fields before work starts:

| Field | Purpose |
| --- | --- |
| goal_id / workstream_id | Stable user objective and execution owner |
| conversation_fingerprint / account_fingerprint | Exact, expressly authorized ChatGPT target; no arbitrary active tab |
| task_id / step_id / progress_revision | Runtime state and evidence for each atomic operation |
| mcp_request_id / trace_id / idempotency_key | Correlate accepted invocation without replaying side effects |
| outcome / verification_receipt | Completion reported vs actually verified |
| incident_id / transport_state / observed_at | Separate browser delivery loss, MCP disconnect, tunnel down, Runtime unobserved |
| notification_key / send_state | Prevent duplicate status turns, especially on lost browser acknowledgements |

Write goal/task associations at invocation acceptance. Do not infer them by
matching timestamps or picking the newest Task.

### State machine and triggers

```text
User-authorized goal binding
  → Runtime executes Task independently
  → Monitor receives Task revisions + transport events
      ├─ Runtime still running; ChatGPT delivery is lost
      │    → confirm incident ≥60 s → observe canonical Task
      │    → optional single status-continuation notice, never Task replay
      ├─ Runtime temporarily unobservable
      │    → unknown / reconcile when reconnected; never assume failed
      ├─ Task verified completed
      │    → final revision + verification receipt → completion notice candidate
      ├─ Task completed, receipt absent/uncertain
      │    → unverified completion notice candidate
      ├─ Task failed / blocked
      │    → review notice, retain idempotency evidence
      └─ approval requested or Task paused
           → wait for permitted approval, no autonomous resubmission
```

A **status continuation notice** is a new ChatGPT user turn in the exact
preauthorized conversation, not resumption of an aborted inference process.
For running tasks its content instructs the model to inspect the existing
`workstream_id`/`task_id` and not repeat external actions. A final notice
reports results and a link to evidence. Never copy browser credentials, full
terminal output, personal data, or approval tokens into the notice.

### Outbox / delivery transaction

1. Evaluate the pure, fail-closed `mcp/chatgpt-recovery-plan.mjs` policy.
   It requires goal↔Task correlation, a real Task terminal revision or a
   confirmed ≥60-second frontend disconnect with Runtime still observed,
   a pinned chat URL/fingerprint and account identity, scoped user consent,
   a verified idle Agent Browser session and an unambiguous send state.
2. Atomically reserve an outbox key
   `sha256(goal_id,task_id,revision_or_incident,notice_type,conversation_fingerprint)`.
   Reserve before interacting with ChatGPT. Coalesce repeated progress events.
3. Before sending, re-verify account, exact conversation URL, signed consent
   and the absence of an already-generating response. Limit one notice per
   incident/terminal revision and rate-limit per user.
4. Send only the status notice via a user-authorized browser session adapter.
   Store a reply/turn receipt and mark delivery verified **only if observed**.
5. On timeout or unknown outcome set `send_state=uncertain` and stop.
   Reinspect the exact conversation; never automatically send again because
   the receipt may have been lost after the message reached ChatGPT.
6. Remove/expire consent on account change, conversation deletion or
   explicit opt-out. No durable service may steal Chrome focus, prompt for
   passwords or bypass website permission checks.

Delivery states:
`candidate → reserved → sending → acknowledged` or
`uncertain → user_reconciles`. A read-only resume is always safe; repeating
a write without the same external idempotency key is not.

### Recovery transports and user control

- **Prefer** native ChatGPT Work/Scheduled notifications for tasks those
  products support. These are not a general API for resuming an arbitrary
  consumer ChatGPT chat.
- **Fallback** Agent Browser may open a specific ChatGPT conversation and
  send a *new* status turn only after user opt-in and the outbox checks.
- OWL Cloud can retain Task/notification ledger and device health;
  local Mac/Windows Workers remain authoritative for actual tool executions.
- Expose per-goal `observe_only`, `notify_on_terminal`,
  `notify_on_disconnect` and `off` controls, with a visible kill switch.
  Default is **observe_only** (no unsolicited ChatGPT messages).
- The currently implemented planner is **read-only**. It does not create
  the durable outbox or send/activate any ChatGPT conversation.

### Remaining P0 work (not covered by the short-lived MCP fence)

The new `/ota/drain` admission lease serializes incoming MCP tools on the
same Connection Host event loop, checks current Runtime tasks/processes,
and expires within 45 seconds if the updater crashes. This closes the
HTTP tool-entry race between the last observation and the handoff.
**It is not an atomic drain of all possible Runtime entry points.**

Before #107 can close, implement a Runtime-side persistent accepting/draining
generation barrier covering local, Cloud and scheduled task producers.
Checkpoint or complete accepted work, reconcile unknown external side
effects, and fault-inject disconnect/restart during a real long-lived task.
Before #109 can close, run Windows Guardian collision and postactivation
fault injection plus unattended cleanup soak on the deployed revision.
