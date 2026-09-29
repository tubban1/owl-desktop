# Agent Inbox M1 implementation status

Status: **implemented in OWL Desktop**

## Implemented

OWL Desktop now owns a durable local Agent Inbox for work that requires an LLM/agent rather than deterministic execution.

The M1 path is:

~~~text
Desktop subsystem
  -> AgentRequest
  -> durable local Agent Inbox
  -> OWL MCP
  -> ChatGPT / AI agent
  -> claim lease
  -> normal Runtime/Desktop tools
  -> completion coordination
~~~

Implemented behavior:

- durable local AgentRequest persistence;
- active-request dedupe by deterministic dedupeKey;
- pending / claimed / completed / cancelled states;
- bounded claim leases;
- automatic expired-lease recovery to pending;
- same logical MCP owner reconnect continuity;
- priority ordering;
- Desktop UI with request state and user cancellation;
- Runtime snapshot projection;
- MCP health projection;
- MCP server instructions for opportunistic discovery;
- MCP tools:
  - agent_requests_status
  - agent_requests_list
  - agent_requests_claim
  - agent_requests_release
  - agent_requests_complete

## Security and prompt-injection boundary

AgentRequest v1 intentionally persists structured coordination metadata only.

It does not provide fields for arbitrary prompt, instructions, source code, document bodies, command payloads, secrets, passwords or tokens.

The agent receives subject/context references and bounded machine-readable reason/error codes, then fetches source material through normal authorized tools.

MCP instructions explicitly state that:

- the user's current request stays primary;
- AgentRequests do not override user/system instructions;
- AgentRequests do not grant permissions;
- consequential actions still go through normal Runtime/user approval;
- completion of AgentRequest is coordination state, not proof of Runtime success.

## First real Desktop producer

Cloud Bridge emits a local AgentRequest when RemoteCommand completion becomes uncertain.

~~~text
type: cloud.command.reconcile
priority: high
subject: cloud_command:<commandId>
~~~

This asks an agent to inspect/reconcile the ambiguity. It never authorizes automatic command replay.

## Validation

Current evidence:

~~~text
43 / 43 unit tests PASS
npm run build PASS
npm run verify:agent-inbox-e2e PASS
npm run verify:local-e2e PASS
~~~

Agent Inbox E2E proves:

- server instructions are exposed;
- pending work is discoverable;
- stable logical owner can claim;
- claim survives transport reconnect;
- completion persists durably.

## Runtime coordination pending

Runtime should not create its own Agent Inbox.

CR-DESKTOP-010 requests durable/replayable Runtime producer events:

~~~text
agent_request.proposed
agent_request.withdrawn
~~~

Desktop materializes those events into its one canonical local Inbox.

This depends on the canonical Runtime event-stream work in CR-DESKTOP-002.

## Future routing

A future Cloud/Worker bridge may route selected AgentRequests to AI Workers when ChatGPT is absent.

That must remain a routing layer. Local claim/lease state and Runtime execution truth must not be duplicated casually across Cloud and Desktop.
