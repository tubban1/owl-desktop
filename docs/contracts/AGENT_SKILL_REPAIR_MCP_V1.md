# AgentRequest Skill Repair MCP v1

Status: **Desktop stacked integration live accepted against pinned Runtime R1**

## Purpose

This contract closes the reasoning loop for Runtime-produced `skill.repair`
AgentRequests without moving validation, execution, promotion, or replay truth
out of OWL Runtime.

The intended path is:

~~~text
Runtime Skill Candidate validation
→ agent_request.proposed
→ Desktop durable Agent Inbox
→ stable MCP owner claims request
→ privacy-safe repair context
→ ChatGPT proposes revised manifest
→ replay-protected Runtime Candidate revise
→ replay-protected Runtime Candidate validate
→ Runtime emits withdrawal / next proposal
→ Desktop reconciles Inbox
→ agent completes handled request
~~~

## Authority

~~~text
Runtime
= Candidate / revision / digest / validation truth
= consequential request replay truth

Desktop
= AgentRequest claim/lease/completion truth
= privacy-safe presentation boundary

ChatGPT / AI Worker
= semantic repair author

Skill Manager + user confirmation
= promotion / activation UX
~~~

The MCP repair path never promotes or activates a Skill.

## Tools

### skill_repair_context

Read-only.

Requires:

- Runtime-produced AgentRequest;
- type `skill.repair`;
- subject kind `skill_candidate`;
- request claimed by the current MCP logical owner;
- stable owner identity;
- `candidate.inspect` in allowedActions.

It fetches the Candidate only through Runtime public API and returns a
Desktop-owned privacy projection.

It does not return:

- Candidate revision history;
- Runtime public-event outbox state;
- raw embedded-secret detector matches;
- known credential-bearing values.

### skill_repair_apply

Mutation composed from two existing public Runtime operations:

~~~text
skill-candidates.revise
→ skill-candidates.validate
~~~

Requires the same claimed request and both:

~~~text
candidate.revise
candidate.validate
~~~

in allowedActions.

It also requires:

~~~text
extensions.consequentialRequestReplay.version >= 1
~~~

Desktop refuses the repair mutation on an older Runtime rather than making a
potentially duplicated Candidate mutation after response loss.

## Replay identity

For one claimed AgentRequest:

~~~text
revise idempotency key
= stable(requestId, candidate-revise)

validate idempotency key
= stable(requestId, candidate-validate)
~~~

Each HTTP transport attempt gets a new requestId.

A lost response can therefore replay the same logical repair without creating
a second Candidate revision.

Changing method/params under the same key is rejected by Runtime's canonical
request digest.

Desktop does not generate a new key to force execution after:

- IDEMPOTENCY_OUTCOME_UNCERTAIN;
- IDEMPOTENCY_REPLAY_EXPIRED;
- IDEMPOTENCY_RECEIPT_PERSIST_FAILED;
- IDEMPOTENCY_KEY_CONFLICT.

## Source revision binding

The AgentRequest references the revision that created the semantic issue.

On a normal first apply, that is the current Runtime revision.

After a response-loss retry, Runtime may already have advanced to the repaired
revision. Desktop therefore verifies that the AgentRequest source revision and
expected digest still exist in immutable Candidate history, then sends the
same replay-protected request to Runtime.

Runtime remains responsible for determining whether that request is:

- a canonical replay;
- a digest conflict;
- stale because another actor revised the Candidate.

Desktop does not infer execution truth from current revision number alone.

## Privacy projection

Runtime `candidate.get/inspect` may contain the raw manifest and validation
details. Those responses are not exposed directly as MCP repair context.

Desktop projects only the current repair material and applies a conservative
redaction layer.

Always redacted when detected:

- password/token/secret/API-key/credential-like keys;
- recognizable token/key/private-key/JWT/Bearer patterns.

When Runtime reports `USER_SKILL_EMBEDDED_SECRET_BLOCKED`, Desktop also:

- removes validation issue `actual` values, retaining only redacted metadata
  such as match count;
- conservatively redacts string literals in execution arguments, input
  defaults, and verification literals.

The model must never attempt to reconstruct or guess a redacted secret.
The repair should replace embedded credentials with governed inputs/providers.

## Completion

`skill_repair_apply` does not automatically complete the AgentRequest.

The agent should first inspect Runtime's returned validation result.

Runtime may emit:

~~~text
withdrawn(old revision)
proposed(new revision)
~~~

independently.

A claimed request is not silently cancelled by a Runtime withdrawal. The
claiming agent completes the old coordination item after the referenced repair
has actually been handled.

## Promotion boundary

These tools do not expose:

- Candidate promotion;
- User Skill activation;
- Registry install;
- approval bypass.

Promotion continues through the normal Runtime gate and explicit product/user
confirmation.

## Acceptance gate

Pinned Runtime R1 provider target:

~~~text
owl-runtime
f00ba4f7f5c3fbddc18cf7c04fc0cfccdbb786bd
~~~

Live acceptance evidence:

~~~text
16 test files PASS
92 / 92 unit tests PASS
TypeScript + renderer build PASS

Runtime repair extensions PASS
Runtime repair proposal -> Desktop Agent Inbox PASS
stable MCP owner claim PASS
privacy-safe repair context PASS
Candidate revise + revalidate PASS
same logical repair replay -> one Candidate revision PASS
claimed repair survives Runtime withdrawal PASS
durable AgentRequest completion PASS
~~~

The accepted live scenario proves:

1. invalid Candidate produces a Runtime AgentRequest;
2. Desktop materializes it once;
3. stable MCP owner claims it;
4. privacy-safe context is returned;
5. apply creates revision 2 and validates it;
6. repeating the same apply does not create revision 3;
7. Runtime withdrawal is consumed;
8. claimed work is not silently cancelled;
9. agent completion persists;
10. no promotion occurs.
