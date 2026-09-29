# Runtime AgentRequest Consumer v1

Status: **Desktop consumer semantics implemented on feature branch; Runtime transport pending**

## Why this exists

OWL Desktop already owns the canonical local Agent Inbox.

The missing cross-repo boundary is:

~~~text
OWL Runtime
  -> durable/replayable AgentRequest events
  -> OWL Desktop
  -> local Agent Inbox
~~~

Desktop must be ready to consume those events without reading Runtime state files, importing Runtime internals, or inventing a polling workaround.

## Runtime gap observed on the current baseline

The current Runtime public RPC surface exposes Task, Skill, Schedule, Approval, Process, Health and Diagnostics operations.

It does **not** expose a public durable event stream with cursor/sequence semantics.

Runtime does maintain Task-local persistent events as M2 evidence, but that Task-local trace is not a replacement for a public cross-consumer event stream.

Therefore Desktop intentionally does not attach to a fake Runtime transport yet.

## Desktop consumer boundary

The transport-independent consumer lives at:

~~~text
electron/services/runtime-agent-request-consumer.mjs
~~~

Its input is one typed Runtime event.

Its output is an idempotent mutation of the local Agent Inbox plus a minimal consumer journal.

The consumer does not know how events arrived.

Future adapters may use HTTP polling, SSE, WebSocket or another public Runtime transport, but all must feed the same consumer contract.

## Supported event types

### agent_request.proposed

Required semantic fields:

~~~text
eventType
eventId
proposalId
sequence or cursor
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

Desktop materializes this as one local AgentRequest with:

~~~text
producer = runtime
correlationId = proposalId
dedupeKey = Runtime dedupeKey
~~~

### agent_request.withdrawn

Required semantic fields:

~~~text
eventType
eventId
proposalId
sequence or cursor
subject
reasonCode
dedupeKey
occurredAt
~~~

A withdrawal may cancel only the matching **pending** local AgentRequest.

It does not cancel:

- claimed work;
- completed work;
- already-cancelled work;
- another request that merely looks similar.

## Strict parsing

The event parser is allow-list based.

Unknown fields are rejected.

This deliberately rejects fields such as:

~~~text
prompt
instructions
payload
secret
sourceCode
raw user content
~~~

The Runtime event channel is coordination metadata, not a hidden prompt channel.

Nested subject/context references are also allow-list parsed.

## Replay and ordering model

The consumer keeps a small local journal containing only:

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

It does not persist the original Runtime event payload.

Rules:

1. same eventId replay -> duplicate/no-op;
2. same proposal replay under a new eventId -> existing AgentRequest reused;
3. same dedupeKey with another proposalId -> fail closed as collision;
4. sequence lower than the last applied sequence -> stale/no-op;
5. same sequence with a different unseen event -> fail closed as sequence conflict;
6. sequence gap -> fail closed and do not advance the journal;
7. consumer restart -> journal resumes replay protection.

For a cursor-only future Runtime stream, eventId + Inbox materialization idempotency still protects proposal/withdrawal replay.

## Candidate revisions

Candidate revision belongs in the subject and should also affect Runtime's deterministic dedupeKey.

Example:

~~~text
runtime:skill_candidate:candidate_123:r2:validation_failed
runtime:skill_candidate:candidate_123:r3:validation_failed
~~~

A new revision is therefore a new reasoning item.

Runtime remains responsible for deciding whether an older revision is stale and should emit agent_request.withdrawn when appropriate.

Desktop does not infer Candidate truth.

## Withdrawal versus claim

Once an AI agent has claimed an AgentRequest, Desktop does not silently cancel that lease because Runtime later emits withdrawn.

The consumer records:

~~~text
claimed_not_cancelled
~~~

The agent must then re-observe canonical Runtime state before continuing or completing the work.

This avoids a background Runtime event unexpectedly taking work away from an active logical agent session.

## Conformance fixture

Fixture:

~~~text
tests/fixtures/runtime-agent-request-events-v1.json
~~~

Standalone gate:

~~~text
npm run verify:runtime-agent-request-consumer
~~~

Unit coverage:

~~~text
tests/runtime-agent-request-consumer.test.mjs
~~~

The fixture covers:

~~~text
Skill Candidate revision 2 proposal
-> withdrawal
-> Skill Candidate revision 3 proposal
~~~

The tests additionally cover replay, restart, sequence gaps, dedupe collisions, claimed-withdrawal behavior and rejected prompt-like fields.

## Runtime integration requirement

Do not connect this consumer to Runtime until Runtime exposes a provider-owned public durable event contract.

The eventual adapter must:

- start from a durable cursor/checkpoint;
- deliver events at least once;
- never acknowledge a cursor past an event the Desktop consumer rejected;
- surface retention/cursor-expiry explicitly;
- preserve sequence/cursor identity across Runtime restart;
- never derive AgentRequest events by scraping diagnostics or Task JSON.

CR-DESKTOP-002 and CR-DESKTOP-010 remain the provider requirements.

## Authority remains unchanged

~~~text
Runtime
= canonical Task/Candidate/validation/execution truth

Desktop
= Agent Inbox coordination truth

ChatGPT / AI Worker
= semantic reasoning consumer
~~~

AgentRequest completion still does not imply Runtime success.
