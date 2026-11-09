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
