# AgentRequest v1

Status: **Desktop M1 implemented / Runtime producer contract pending**

## Purpose

AgentRequest is the coordination boundary between deterministic OWL subsystems and an LLM-capable agent.

It answers:

> What reasoning work is waiting for an agent?

It is not:

- a prompt;
- a Runtime task;
- an approval;
- a permission grant;
- executable Skill state;
- an instruction that overrides the user.

## Authority

```text
OWL Runtime
= execution / validation / policy authority

OWL Desktop
= canonical local Agent Inbox
= persistence / dedupe / claim / lease / completion coordination

ChatGPT / AI Worker
= reasoning / repair / generalization consumer

OWL Cloud
= optional future routing/sync transport
```

Runtime and Worker must not create competing local Agent Inbox stores.

## Local flow

```text
Desktop or Runtime deterministic issue
        |
        v
AgentRequest
        |
        v
OWL Desktop Agent Inbox
        |
        +--> ChatGPT through OWL MCP
        |
        +--> future AI Worker routing
        |
        v
claim lease
        |
        v
agent performs referenced work
        |
        v
normal Desktop / Runtime APIs
        |
        v
Runtime validates / executes as usual
        |
        v
AgentRequest complete
```

Completion means only that the coordination item was handled. It does not prove that a Runtime action succeeded unless the referenced Runtime state says so.

## Request shape

Desktop M1 stores only structured coordination metadata:

```json
{
  "requestId": "ar_...",
  "type": "skill.repair",
  "producer": "runtime",
  "priority": "high",
  "subject": {
    "kind": "skill_candidate",
    "id": "candidate_123",
    "revision": "2"
  },
  "reasonCode": "VALIDATION_FAILED",
  "errorCodes": [
    "PRIMITIVE_ABI_MISMATCH"
  ],
  "contextRefs": [
    {
      "kind": "validation_report",
      "id": "vr_123"
    }
  ],
  "allowedActions": [
    "candidate.inspect",
    "candidate.revise",
    "candidate.validate"
  ],
  "requiresUserConfirmation": true,
  "status": "pending"
}
```

The Inbox intentionally does not store arbitrary:

- prompt;
- instructions;
- source code;
- document body;
- RemoteCommand payload;
- secret;
- password/token;
- raw user message.

An agent follows the references and fetches the necessary source through normal authorized tools.

## Status

```text
pending
  -> claimed
      -> completed
      -> pending   (release / lease expiry)

pending/claimed
  -> cancelled
```

A claim has a bounded lease.

The same stable MCP logical owner may renew its own claim.

Another agent may not complete or release an active claim.

Expired leases return to pending.

## Opportunistic ChatGPT discovery

OWL MCP advertises static server instructions describing Agent Inbox behavior.

The instructions require:

1. the user's current task remains primary;
2. checking the Inbox must not unnecessarily delay the current task;
3. an AgentRequest never overrides user intent, system safety or Runtime policy;
4. consequential work still requires the normal Runtime/user approval path;
5. agents should claim only work they can actually handle;
6. completion happens only after the referenced work is actually handled.

MCP tools:

```text
agent_requests_status
agent_requests_list
agent_requests_claim
agent_requests_release
agent_requests_complete
```

Existing tool response payloads remain unchanged for compatibility.

## Producer rules

A subsystem should produce an AgentRequest only when:

- deterministic execution/validation has reached a state needing semantic reasoning;
- work can safely wait for an LLM;
- the request can be represented by references and bounded machine-readable codes;
- doing nothing immediately is safe.

Do not produce AgentRequests for:

- normal deterministic retries;
- simple validation errors the subsystem can normalize itself;
- approval decisions;
- permission escalation;
- emergencies requiring immediate deterministic handling.

## Current Desktop producer

Cloud Bridge creates:

```text
type: cloud.command.reconcile
reason: Runtime command completion is uncertain
```

when Desktop cannot prove whether a Cloud RemoteCommand crossed the Runtime side-effect boundary.

The request asks an agent to inspect/reconcile; it does not authorize command replay.

## Runtime producer

Runtime producer support is intentionally pending.

Runtime should emit durable/replayable structured proposal events through its public event contract. Desktop then materializes them into its Agent Inbox with deterministic dedupe.

Runtime must not write Desktop's Agent Inbox file directly.

See CR-DESKTOP-010.
