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


## Workstream protocol when upstream conversation identity is unavailable

Current ChatGPT MCP traffic does not reliably provide OWL with a stable ChatGPT conversation identifier. OWL therefore MUST NOT assume the Desktop fallback owner is equivalent to one chat conversation.

For meaningful multi-step work the planner opens an explicit workstream:

```text
workstream_open
  goal
  label?
  client_kind?
  resume_workstream_id?
```

OWL returns a random durable `owl-workstream:<uuid>`.

Every OWL tool accepts an optional `workstream_id`. After opening a workstream, the planner should include that ID on every subsequent OWL call for the logical task.

This gives two isolation paths:

1. preferred: explicit `workstream_id` on each tool call;
2. compatibility: the current MCP transport remembers the last bound workstream.

The explicit ID is the authority when one MCP transport is reused across multiple logical conversations.

Reconnect flow:

```text
Chat/Worker reconnects
→ workstream_open(resume_workstream_id=<known id>)
→ OWL validates the active workstream
→ transport rebinds
→ existing Runtime ownership continues
```

Completed workstreams cannot be resumed.

## Progress protocol

The planner mirrors concise user-visible progress into:

```text
workstream_progress
  completed[]
  current
  next_actions[]
  summary?
  status?
```

This is semantic coordination data, not a copy of the assistant message.

Each non-meta OWL tool completion increments the active workstream's
`toolStepsSinceProgress`. Calling `workstream_progress` resets that counter.

Monitor marks a progress update due when active work satisfies either:

- elapsed time since `lastProgressAt` >= 15 seconds;
- `toolStepsSinceProgress` >= 3.

Only the following bounded operational metadata is stored for recent tool calls:

- tool name
- completion timestamp
- duration
- success/error outcome

Tool arguments, command text, file contents, browser content, prompts and full assistant/user messages are not copied into the workstream journal.

## Workstream completion

`workstream_complete` marks the logical workstream terminal and clears the transport's compatibility binding. It does not delete Runtime Tasks, verification evidence, process history, or Cloud audit records.

## Product guarantees strip

Monitor exposes three real-time guarantees above the workstream list:

### PERSISTENT

Derived from Runtime availability plus recoverable workstream/checkpoint state.

It answers:

> Will the work survive the chat/transport disappearing?

### OBSERVABLE

Derived from Runtime event health, source/workstream count, current executor and semantic handoffs.

It answers:

> Can I tell who is doing what, what changed, and what happens next?

### AUTHORIZED

Derived from Runtime access mode/state and signed lease verification.

It answers:

> Is this agent currently allowed to enter the local computer data plane?

A green AUTHORIZED state requires enforced Runtime access with a verified Cloud-signed lease. A connected MCP/Tunnel without valid Runtime authorization remains visibly LOCKED.


## Real MCP interaction stream

Monitor Live MUST lead with real MCP traffic, not historical Runtime Task inference.

Every MCP tool invocation emits two correlated operational events with the same interaction ID:

```text
request
  client/workstream → OWL
  tool
  bounded real arguments preview

response
  OWL → client/workstream
  success/error
  duration
  bounded real result preview
```

The request event is emitted before execution begins, so long-running calls appear as `RUNNING` immediately. The response event completes the same interaction when the tool returns.

Interaction payloads are real MCP payload previews, not generated summaries. For privacy and safety:

- credential-like keys are redacted;
- strings, arrays, object depth and total preview size are bounded;
- full chat transcripts and hidden model reasoning are never available to or reconstructed by Monitor.

The Live hierarchy is:

1. Persistent / Observable / Authorized assurance strip
2. Real MCP interaction stream
3. Current/recent workstreams
4. Detailed execution (collapsed)
5. Historical Timeline / Graph / System views

Historical terminal/failed Runtime Tasks MUST NOT remain in the Live workstream list indefinitely. A legacy stream without a current transport/workstream/active execution is retained in Live only for a short recent window; durable history stays available in Timeline/Graph.


## Single-view Agent Operations

Monitor is a single live operations surface. The product UI does not require users to switch between Live, Timeline, Graph and System tabs to understand current agent work.

The primary graph renders the actual current path:

```text
ChatGPT / Worker / Cloud
→ OWL MCP / Tunnel
→ Runtime authorization gate
→ OWL Runtime
→ current tool / task / process
→ result back to source
```

The same surface carries:

- Persistent: current recoverable/durable work;
- Observable: Runtime event health and real MCP traffic;
- Authorized: enforced access state and Cloud-signed lease verification;
- current real request/response payload preview;
- current workstreams and next actions.

Historical terminal tasks, old AgentRequests and support diagnostics do not occupy the live surface. They remain Runtime/audit history but are not presented as current agent activity.

### Live activity stability

The 750 ms Activity IPC stream is the authoritative renderer source for real MCP interactions while Monitor is open.

The slower Runtime snapshot refresh MUST NOT overwrite the renderer's live activity buffer. Snapshot activity is only a bootstrap/fallback source before the first Activity poll. This avoids alternating between a 200-event live buffer and the smaller snapshot projection, which previously caused real interaction cards to appear and disappear every few seconds.
