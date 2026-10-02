# OWL LAB Monitor Workstreams v1

Status: candidate product contract for OWL LAB Desktop 1.0 DEV.

## Goal

Monitor must answer, at a glance:

1. Who sent work into OWL?
2. Which logical session/workstream owns it?
3. Who is executing now?
4. What was handed from one component to another?
5. What is waiting?
6. What happens next?
7. Which work belongs to another concurrent ChatGPT session or future Worker?

Monitor is a projection of Runtime/coordination facts. It is not a second execution authority and does not scrape full chat transcripts.

## Stable workstream identity

The primary workstream key is the stable OWL logical owner ID.

A transport session is only a connection. Reconnects may create a new transport session while preserving the same logical owner/workstream.

Current source kinds:

- chatgpt
- worker
- cloud
- desktop
- agent
- mcp

MCP clients may provide:

- `x-owl-owner-id`
- `x-owl-client-kind`
- `x-owl-client-label`

The owner ID is hashed before becoming a Runtime session ID. The raw upstream identity is not exposed in Monitor.

If no explicit client kind is supplied:
- explicit OWL owner header defaults to ChatGPT for the current ChatGPT integration;
- Desktop fallback identity defaults to Desktop;
- unstable transport identity defaults to MCP.

Future Worker sessions MUST provide their own stable owner ID and should set `x-owl-client-kind: worker`.

## Workstream membership

A Runtime Task belongs to a workstream when at least one is true:

1. `task.ownerSessionId === workstream.ownerId`
2. planner checkpoint `taskIds` contains the task ID
3. task orchestration ID matches the checkpoint orchestration ID

AgentRequests belong to a workstream through their claim owner. Unclaimed requests remain in the shared Agent Inbox workstream.

Cloud RemoteCommands attach to the workstream of their mapped Runtime task. Processing/uncertain commands without a mapped task appear in a separate Cloud workstream.

## Live card

Each live workstream card shows:

- source/client label and kind
- connected transport count
- goal
- current phase
- current executor
- current action
- linked/running Runtime Tasks
- recent semantic handoffs
- next actions
- progress-reporting cadence state

Semantic handoffs are compact coordination facts, not verbatim conversation messages. Examples:

```text
User / caller → ChatGPT
  goal checkpoint

ChatGPT → OWL Runtime
  durable Task dispatch

OWL Runtime → ChatGPT
  canonical Task progress

OWL Runtime → claimed agent
  AgentRequest

OWL Cloud → Desktop → OWL Runtime
  RemoteCommand
```

## Concurrent sessions

Monitor MUST NOT choose one global "current ChatGPT task" and merge unrelated work.

Example:

```text
ChatGPT · A
  Goal: finish Desktop Monitor
  Task: desktop tests
  Next: commit

ChatGPT · B
  Goal: investigate Cloud billing
  Task: provider comparison
  Next: sandbox checkout

Night Worker
  Goal: nightly regression
  Task: integration suite
  Next: report failures
```

These remain three distinct workstreams even though they use the same OWL Desktop, Runtime and Tunnel.

## Progress reporting contract

Interactive multi-step work should not leave the user without a useful progress message for long stretches.

Recommended policy:

- approximately 15 seconds maximum silence during active interactive work;
- no more than 3 substantive tool/execution steps without a concise user-visible progress update.

A useful progress update says:

1. what just finished;
2. what is happening now;
3. what comes next.

Do not emit updates for trivial single-step actions and do not invent progress.

MCP server instructions publish this policy to connected planners. Planner checkpoints remain the durable source for goal/phase/completed/next-action recovery after stream loss.

## UI hierarchy

Default Monitor Live view is intentionally compact:

1. workstream summary
2. one card per active/recent source
3. recent handoffs
4. next actions

Detailed execution facts remain available under the collapsed detailed section and the Timeline / Graph / System tabs.

This keeps normal monitoring readable without discarding Runtime evidence, verification or diagnostic detail.
