# Runtime AgentRequest Consumer v1

Status: **Desktop events.list integration implemented and live accepted**

## Purpose

OWL Desktop owns one canonical local Agent Inbox.

OWL Runtime owns canonical Task, Skill Candidate, validation, verification and
execution truth. Runtime may identify a deterministic state that needs semantic
reasoning, but it does not own Desktop claim/lease/completion state.

The integrated boundary is:

~~~text
OWL Runtime canonical state
        ↓
Runtime transactional public-event outbox
        ↓
durable public event journal
        ↓
RuntimeEventRuntimeClient.events.list
        ↓
RuntimeAgentRequestEventBridge
        ↓
RuntimeAgentRequestEventConsumer
        ↓
Desktop Agent Inbox
        ↓
ChatGPT / AI Worker
~~~

Desktop does not read Runtime state files, Task JSON or diagnostics to infer
AgentRequest transitions.

## Runtime public contract consumed

Runtime public API remains:

~~~text
POST /runtime/v0.1/rpc
~~~

Desktop feature-detects:

~~~text
extensions.publicEventJournal.version >= 1
extensions.agentRequestProducer.version >= 1
~~~

The consumed RPC is:

~~~text
events.list
~~~

Desktop v1 always requests the complete AgentRequest channel:

~~~json
{
  "afterCursor": "runtime-events:41",
  "limit": 100,
  "types": [
    "agent_request.proposed",
    "agent_request.withdrawn"
  ]
}
~~~

The two event types are requested together because Runtime v1 exposes one
global sequence. A partial filter is not a safe contiguous channel.

## Desktop layers

### RuntimeAgentRequestEventConsumer

File:

~~~text
electron/services/runtime-agent-request-consumer.mjs
~~~

Responsibility:

- strict AgentRequest event parsing;
- eventId replay dedupe;
- sequence continuity;
- proposal/dedupe collision checks;
- local AgentRequest materialization;
- pending-only withdrawal;
- minimal durable event receipt journal.

It does not perform HTTP polling.

### RuntimeAgentRequestEventBridge

File:

~~~text
electron/services/runtime-agent-request-event-bridge.mjs
~~~

Responsibility:

- Runtime feature detection;
- events.list polling;
- durable cursor resume;
- pagination;
- page acknowledgement discipline;
- retention/cursor error classification;
- explicit reconciliation state;
- Desktop lifecycle integration.

The bridge does not own AgentRequest claim/lease/completion semantics.

## Exact event position contract

Runtime v1 events must contain both:

~~~text
sequence >= 1
cursor = runtime-events:<same sequence>
~~~

Desktop rejects:

- sequence without cursor;
- cursor without sequence;
- malformed cursor;
- cursor/sequence mismatch;
- sequence 0;
- unknown event fields.

Malformed event data is a replay-integrity failure, not a transient transport
warning.

## Supported events

### agent_request.proposed

Required fields:

~~~text
eventType
eventId
proposalId
sequence
cursor
requestType
priority
subject
reasonCode
errorCodes
contextRefs
allowedActions
requiresUserConfirmation
dedupeKey
occurredAt
~~~

Desktop materializes exactly one local AgentRequest:

~~~text
producer = runtime
correlationId = proposalId
dedupeKey = Runtime dedupeKey
~~~

### agent_request.withdrawn

Required fields:

~~~text
eventType
eventId
proposalId
sequence
cursor
subject
reasonCode
dedupeKey
occurredAt
~~~

Withdrawal cancels only the matching request while it is still pending.

It does not silently cancel:

- claimed work;
- completed work;
- already-cancelled work;
- another request with a different proposal identity.

A claimed request records claimed_not_cancelled; the active agent must
re-observe canonical Runtime state before continuing.

## Prompt-injection boundary

The parser is allow-list based.

The Runtime event channel rejects uncontracted fields such as:

~~~text
prompt
instructions
payload
secret
sourceCode
raw user content
permission grants
~~~

AgentRequest events carry coordination metadata and canonical references, not
hidden instructions.

## Durable consumer checkpoint

Desktop persists:

~~~text
lastSequence
lastCursor
bounded event receipts
~~~

Each receipt contains only:

~~~text
eventId
eventType
proposalId
sequence
cursor
occurredAt
appliedAt
outcome
~~~

The original Runtime event payload is not persisted in the consumer journal.

The sequence and cursor checkpoint must either both be null or exactly agree.

## Page acknowledgement rule

For every events.list page:

~~~text
Runtime returns page
        ↓
Desktop consumes event 1
        ↓
Desktop consumes event 2
        ↓
...
        ↓
all events accepted
        ↓
consumer.lastCursor MUST equal page.nextCursor
~~~

If event N fails:

~~~text
events 1..N-1 may already be durably accepted
event N is rejected
page.nextCursor is NOT acknowledged
polling enters reconciliation
~~~

Desktop therefore never acknowledges past an event it failed to consume.

## Reconciliation state machine

The bridge exposes:

~~~text
stopped
healthy
degraded
unsupported
needs_attention
~~~

### degraded

Used for a temporary transport/runtime failure when replay integrity is still
known.

Desktop may retry from the same durable cursor.

### unsupported

Used when Runtime does not expose both required optional extensions.

Desktop keeps its local Inbox but does not fabricate events from diagnostics or
Task files.

### needs_attention

Used when Desktop can no longer prove contiguous replay.

Examples:

~~~text
CURSOR_EXPIRED / RETENTION_GAP
CURSOR_AHEAD
sequence gap
sequence conflict
dedupe collision
malformed event position/schema
corrupt consumer journal
corrupt Runtime public journal
page nextCursor mismatch
local Runtime AgentRequest history with a missing local checkpoint
first Desktop replay begins above Runtime journal genesis
~~~

needs_attention is durable across Desktop restart.

Normal background polling is blocked while reconciliation is unresolved.

## No skip-to-latest behavior

There is intentionally no:

~~~text
skip to latest
reset to newest
acknowledge gap
advance cursor
~~~

operation in the Desktop bridge or renderer API.

The only current operator action is:

~~~text
Retry saved cursor
~~~

That retry calls Runtime again with the exact same durable afterCursor.

If Runtime still returns CURSOR_EXPIRED, Desktop remains in needs_attention.

A temporary network failure during explicit retry also preserves the original
reconciliation state rather than hiding it as ordinary degradation.

## First-checkpoint protection

A brand-new Desktop with no checkpoint is not allowed to silently begin at an
already-truncated retention floor.

Example:

~~~text
Desktop cursor = none
Runtime oldest retained sequence = 150
Runtime newest sequence = 220
~~~

Desktop enters:

~~~text
RUNTIME_EVENT_HISTORY_TRUNCATED_BEFORE_FIRST_CHECKPOINT
needs_attention
~~~

It does not consume event 150 and does not establish a new cursor.

This prevents "no cursor" from becoming an implicit skip operation.

## Lost-checkpoint protection

If the local Agent Inbox already contains producer=runtime history but the
Runtime event consumer checkpoint is empty, Desktop enters:

~~~text
LOCAL_RUNTIME_EVENT_CHECKPOINT_MISSING
needs_attention
~~~

It does not restart from Runtime's current retained floor.

## Replay semantics

Consumer rules:

1. same eventId replay -> duplicate/no-op;
2. same proposal replay under a new valid eventId -> existing AgentRequest reused;
3. same dedupeKey under another proposalId -> fail closed;
4. lower sequence -> stale/no-op without moving checkpoint;
5. same sequence with another unseen event -> fail closed;
6. sequence gap -> fail closed;
7. consumer restart -> durable checkpoint/replay protection retained.

Runtime v1 itself uses stable deterministic eventIds, so rule 2 is defensive
Desktop idempotency rather than an expected producer behavior.

## Candidate revision identity

Runtime's deterministic identity includes Candidate revision and digest.

A later Candidate revision is therefore distinct semantic work.

Desktop does not infer whether a Candidate issue still exists. Runtime emits
the corresponding agent_request.withdrawn when the canonical issue is
resolved, revised or dismissed.

## Desktop UX

Agent Inbox now exposes a first-class Runtime Durable Event Feed panel.

Healthy view shows:

- durable cursor;
- sequence;
- Runtime retained range;
- last successful replay.

needs_attention view shows:

- reason code;
- detail message;
- saved cursor;
- saved sequence;
- Runtime retention floor when available;
- Retry saved cursor.

The sidebar and Overview surface persistent needs-attention state.

## Tests

Transport-independent consumer:

~~~text
npm run verify:runtime-agent-request-consumer
~~~

Live cross-repository gate:

~~~text
npm run verify:runtime-agent-request-live
~~~

Unit coverage includes:

- strict event schema;
- exact sequence/cursor binding;
- replay idempotency;
- restart;
- stale event handling;
- sequence gaps;
- sequence conflicts;
- dedupe collisions;
- claimed-withdrawal behavior;
- prompt-like field rejection;
- bridge pagination;
- unsupported Runtime fallback;
- lost local checkpoint;
- truncated first replay;
- cursor expiration;
- explicit saved-cursor retry;
- reconciliation persistence.

## Live acceptance

Desktop has passed the real public HTTP integration against:

~~~text
owl-runtime
a44c5d26636c71faf8a8c146ef43e2af71332b11

Runtime public API:
0.1
~~~

The live test configures Runtime public-event retention to 2 and proves:

~~~text
semantic-invalid Skill Candidate
→ Runtime validation
→ agent_request.proposed
→ Desktop events.list
→ one local AgentRequest

Desktop consumer restart
→ replay from durable cursor
→ no duplicate

Candidate revision resolves issue
→ Runtime agent_request.withdrawn
→ matching pending AgentRequest cancelled

Desktop remains at cursor 2
Runtime advances to sequences 3, 4, 5
retention floor becomes 4
→ Runtime returns CURSOR_EXPIRED
→ Desktop enters needs_attention
→ cursor remains 2
→ normal polling stops
→ explicit retry still uses cursor 2
→ no jump to newest

fresh Desktop with no cursor
+ retention floor 4
→ explicit needs_attention
→ no retained event materialization
→ no cursor established
~~~

## CR-DESKTOP status

For AgentRequest delivery:

~~~text
CR-DESKTOP-010 Runtime producer
= delivered by Runtime candidate contract

CR-DESKTOP-002 durable public event foundation needed by AgentRequest
= delivered and consumed through events.list
~~~

CR-DESKTOP-002's broader future log/session/task/process/provider event
projection remains a separate backlog item.

## Authority remains unchanged

~~~text
Runtime
= canonical Task/Candidate/validation/execution truth
= durable public event producer truth

Desktop
= durable event consumer checkpoint
= explicit reconciliation state
= Agent Inbox coordination truth

ChatGPT / AI Worker
= semantic reasoning consumer
~~~

AgentRequest completion still does not imply Runtime success.
