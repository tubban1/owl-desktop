# OWL LAB Conversation Continuity V1

Status: Desktop/MCP 1.1 product contract.

## Problem

A ChatGPT conversation, MCP transport, Tunnel connection, Desktop renderer and
Runtime Task have different lifetimes.

A planner conversation ending must not imply:

- the user's work ended;
- the durable Task should be recreated;
- a workspace lease may be stolen;
- completed verification should be repeated;
- the next planner must reconstruct state from chat history.

## Terminology

**Conversation Continuity**
: Desktop product capability that manages planner-session saturation and
cross-conversation recovery.

**Planner Handoff**
: Desktop-owned durable continuation record linking a bounded Resume Capsule to
an existing OWL workstream.

**Workspace Handoff**
: Runtime-owned lease transfer protocol. It is unrelated to Conversation
Continuity and keeps its existing meaning.

**Durable Task**
: Runtime-owned execution state. A planner handoff references the same Task IDs;
it does not clone or restart them.

## Authority boundary

Desktop/MCP owns:

- OWL-observed conversation traffic accounting;
- continuity risk;
- planner checkpoints;
- Planner Handoff records;
- discovery and consumption of handoffs;
- Conversation Continuity UX.

Runtime owns facts:

- Tasks and Task progress;
- Processes;
- workspace leases;
- Approvals;
- Runtime events;
- Verification;
- artifacts and evidence references.

Desktop must not infer Runtime facts that can be queried canonically.

## Planner Handoff V1

A handoff is stored beside PlannerContinuation state and is discoverable across
planner owner/session IDs.

```text
handoffId
status: ready | consumed
project?
reason
continuityRisk?
sourceOwnerId
sourceWorkstreamId
sourceCheckpointRevision?
createdAt
updatedAt
consumedAt?
consumedByOwnerId?

capsule:
  goal
  phase?
  summary?
  completed[]
  nextActions[]
  decisions[]
  constraints[]
  doNotRepeat[]
  workspace?
  orchestrationId?
  taskIds[]

evidenceRefs[]
```

The capsule is intentionally bounded. Full chat text, secrets, credentials,
command dumps and private file contents must not be copied into it.

## MCP surface

### conversation_handoff_prepare

Creates or refreshes a durable planner handoff from the current workstream and
checkpoint. Caller may add compact decisions, constraints, do-not-repeat items
and evidence references.

### conversation_handoff_latest

Returns the newest unconsumed handoff, optionally filtered by project. This is
the normal entry point for a new Chat.

It is read-only and does not create a new workstream.

### conversation_handoff_get

Reads one handoff by ID.

### conversation_handoff_consume

Marks a handoff consumed after the receiving planner has successfully rebound to
the original workstream. Consumption is acknowledgement, not execution
authority transfer.

## Resume protocol

```text
1. New Chat calls conversation_handoff_latest.
2. If ready:
     read handoff.sourceWorkstreamId
3. Call workstream_open(
     resume_workstream_id = sourceWorkstreamId,
     goal = capsule.goal
   )
4. Call orchestration_snapshot / task_status as needed.
5. Continue existing Task(s); never create replacements merely because the
   planner conversation changed.
6. Call conversation_handoff_consume.
```

The workstream ID is stable across the planner transition.

## Cached tool-catalog compatibility

ChatGPT may keep the connector tool catalog that was loaded when a conversation
started. A running OWL MCP server can therefore expose newer dedicated handoff
tools while an already-open planner conversation still sees an older tool set.
Conversation Continuity must not require the user to manually refresh tools.

For that case, two already-stable compatibility surfaces remain sufficient:

- get_capabilities returns bounded conversationContinuity bootstrap metadata,
  including the latest READY handoff and an explicit resumeVia instruction;
- skill_run intercepts Desktop/MCP-owned owl.continuity.status,
  owl.continuity.latest, owl.continuity.prepare and owl.continuity.resume before
  Runtime Skill dispatch.

owl.continuity.resume performs the same semantic sequence as the dedicated API:
resume the original workstream, bind the receiving transport, complete a
superseded temporary implicit workstream when present, then consume the handoff.
It never creates a replacement Runtime Task and never moves Continuity execution
authority into OWL Runtime.

## Context accounting

V1.1 Context Meter measures only traffic OWL can observe. It may estimate
token-equivalent volume for:

- MCP tool arguments;
- MCP tool results;
- repeated payloads;
- recent growth rate.

The UI calls this value the Observed context floor. It is a lower-bound heuristic,
not ChatGPT's actual context size or remaining tokens, because ordinary planner
conversation text is not visible to OWL.

Risk model V2 calibrates observed-volume signals at approximately 40K, 60K and
90K OWL-visible token-equivalent floors. These are intentionally predictive:
other signals such as planner-session age, substantive OWL call count, rapid
growth, repeated payloads and active durable work combine with volume before a
HIGH/CRITICAL recommendation is emitted.

User-facing state is categorical:

```text
Healthy -> Growing -> Handoff Recommended -> Handoff Ready -> Disconnected
```

Risk is:

```text
LOW | MEDIUM | HIGH | CRITICAL
```

### Planner continuity epochs

Conversation risk belongs to the current planner conversation segment, not to
the durable workstream. When a new planner resumes an existing workstream, OWL
keeps the workstream ID, checkpoint and Runtime Task references unchanged but
starts a new Continuity epoch. Observed traffic, recent growth, duplicate ratio,
substantive-call baseline and planner-session age restart for the new Chat.

The previous epoch is retained only as a bounded statistics record (volume,
score, risk, age and related counters). Full chat text and MCP payload contents
are not archived into epoch history.

## Fail-safe rule

When risk becomes HIGH, prepare the handoff first and notify second.

A Desktop warning without a prepared recovery object is insufficient.

## Privacy

Planner Handoff is local Desktop continuity state. It stores compact operational
metadata only. Sensitive values are prohibited by contract and should be
rejected/redacted at ingress as implementation hardening evolves.

## Implementation status — 2026-10-02

Conversation Continuity V1 is implemented in the Desktop/MCP development tree.

The implementation stores no full MCP payload in the continuity meter. It
stores bounded counters and exact-payload digests after the existing sensitive
field sanitizer. Monitor previews remain separately truncated.

HIGH/CRITICAL behavior is fail-safe:

    risk threshold crossed
      -> durable Planner Handoff prepared/refreshed
      -> Monitor becomes Handoff Ready
      -> next enforced progress boundary carries handoffReady + handoffId
      -> ChatGPT can recommend a new Chat

A manual Handoff may also be prepared while risk is LOW for testing or planned
conversation transfer.

Live dogfood found and fixed one pre-release identity issue: a headerless
ChatGPT/Tunnel path could be represented by the shared Desktop fallback owner,
which let concurrent implicit Chats collide. Headerless remote MCP sessions now
derive a stable planner owner from the MCP transport session. The same session
keeps its owner across normal reconnect traffic, while a distinct Chat/session
gets a distinct owner. The persistent Desktop fallback is accepted only when
the request explicitly identifies itself as a Desktop client.

The first real Session A -> Session B dogfood then exposed a second integration
constraint: the live MCP server had all dedicated Continuity tools, but the fresh
planner conversation still held a cached connector catalog. The compatibility
path above was added and verified live. The receiving Chat used get_capabilities
to discover the existing READY OWL LAB handoff and the already-known skill_run
tool to execute owl.continuity.resume. The original workstream was rebound and
the handoff was durably consumed. Post-resume summary reported zero READY
handoffs and the original workstream connected as a ChatGPT workstream-binding.

That dogfood also supplied the first real calibration sample: about 267K
OWL-observed MCP characters (~67K token-equivalent floor), 108 substantive calls
and nearly four hours of planner activity. V1 scored only 30/MEDIUM, which was
too late for a predictive warning. V2 moves the volume thresholds earlier and
separates planner continuity epochs from the durable workstream so a newly
opened Chat does not inherit the old Chat's context-risk counters.


## Visible progress acknowledgement protocol

Dogfood on 2026-10-02 showed that a soft PROGRESS_UPDATE_REQUIRED boundary was
insufficient: the boundary was reset server-side immediately, so a planner could
retry substantive tools without first producing a user-visible progress message.

New workstreams now use progressAckProtocol=2:

    threshold reached
      -> persist progressBoundary.pending
      -> block substantive OWL tools
      -> planner emits progressBoundary.userVisibleProgress to the user
      -> workstream_progress acknowledges the exact boundaryId + visible text
      -> gate clears
      -> tool work may continue

The MCP server cannot inspect the ChatGPT UI itself, so it cannot independently
prove that pixels were rendered. The protocol therefore makes the acknowledgement
explicit and persistent rather than pretending MCP can inject an assistant
message.

Rollout is backward compatible. Workstreams created before protocol v2 remain on
legacy_soft behavior so an already-open Chat with a cached tool catalog cannot be
locked out by a newly introduced acknowledgement tool. Newly created workstreams
use protocol v2.
