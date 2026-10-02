# OWL LAB Connectivity Reliability Model v1

Status: **OWL LAB 1.1 engineering baseline**.

## Purpose

OWL LAB must not equate process existence with end-to-end reachability.

The reliability model covers the product path:

```text
ChatGPT / remote planner
  -> Tunnel transport
  -> Connection Host
  -> OWL MCP
  -> Runtime HTTP
  -> OWL Runtime
  -> managed execution
```

A green state is valid only when the layer has current evidence for the capability it claims.

## Core invariant

```text
process alive
!= local endpoint healthy
!= upstream transport healthy
!= MCP routable
!= Runtime callable
!= execution ready
```

The product must expose these as separate facts.

## Reachability state machine

Every connectivity-bearing component should report one of:

- STARTING
- READY
- DEGRADED
- STALE
- RECOVERING
- UNREACHABLE
- STOPPED

READY requires a recent successful proof for the layer's declared capability. A cached state string such as `running`, `joined`, or `connected` is insufficient by itself.

## Required evidence

### Tunnel

Track separately:

- processAlive
- localEndpointHealthy
- upstreamTransportHealthy
- lastTransportOkAt
- reconnectAttempt
- recoveringSince
- lastFailure
- lastFailureAt

The supervisor must detect the half-open case where the process remains alive while no end-to-end transport proof has arrived inside the stale window.

### Connection Host

Track:

- processAlive
- controlRpcHealthy
- mcpServerHealthy
- activeMcpSessionCount
- lastControlRoundtripAt
- lastMcpRoundtripAt
- recoveryState

All Desktop -> Connection Host RPC must be bounded by timeout and cancellation.

### OWL MCP

Track:

- transport session count
- active request count
- last request activity
- owner binding
- workstream binding
- stale/superseded transport reclamation
- accepted Runtime call survival after upstream disconnect

A live Streamable HTTP request must never be reclaimed only because an idle TTL elapsed.

### Runtime

Runtime remains the execution authority.

Track:

- HTTP health
- access state
- capability readiness
- task state
- process state
- durable execution evidence

Runtime 1.0 must not be reopened merely to implement transport UX. Existing durable Task and managed-process semantics remain authoritative.

## Recovery design

Recovery must use single-flight semantics:

```text
if recovery already running:
  await the same recovery

otherwise:
  mark RECOVERING
  run bounded recovery transaction
  always clear recovery guard in finally
```

A recovery attempt itself must have an outer deadline. A hung recovery must not permanently disable the watchdog.

## Backoff

Use exponential backoff with jitter for network/tunnel reconnects.

Conceptual form:

```text
delay = min(maxDelay, base * 2^attempt) * jitter
jitter ~= 0.5..1.5
```

Local executor recovery may use a shorter maximum delay than remote-network recovery.

## Half-open detection

The control plane must explicitly cover these states:

- process alive, transport dead;
- socket reports open, no confirmed heartbeat;
- channel/stream reports joined, no successful roundtrip;
- repeated joining beyond the normal convergence window;
- local endpoint accepts TCP but does not answer;
- Electron/Desktop process alive but capability bridge stalls.

A stale threshold must trigger bounded recovery rather than allowing indefinite green status.

## Status writes and races

Asynchronous state transitions that can race, such as OFFLINE during teardown and ONLINE during recovery, must be serialized or revision-guarded.

The final durable status must reflect the newest proven reachability, not whichever asynchronous write completes last.

## Heartbeat rules

A heartbeat that claims ONLINE may be emitted only while the full reachability predicate is true.

If reachability cannot be proven, stop asserting freshness and allow stale detection to age the component out.

## Durable notification rule

Realtime/WebSocket/push is a wake-up signal, not the source of truth.

For Cloud RemoteCommand:

```text
ephemeral notification
  -> fetch durable RemoteCommand
  -> claim/dedupe
  -> Runtime Task/operation
  -> durable Runtime event/result
  -> Cloud reconciliation
```

A lost notification must be recoverable by scanning durable pending work.

## Long process UX

OWL Runtime's durable managed-process design is retained:

- detached child process;
- durable encrypted process metadata;
- persistent stdout/stderr files;
- owner/session/task isolation;
- workspace lease;
- Runtime restart recovery;
- orphan claim.

Do not replace this with a large in-memory terminal buffer.

Desktop/MCP UX may add a cursor-based output read with bounded long-poll behavior:

```text
read after cursor
wait up to N ms for new output/state
return immediately on output, prompt, exit, failure, or timeout
```

This is an additive UX capability, not a reason to reopen the Runtime 1.0 execution model.

## Connection Host restart boundary

Current ChatGPT/Tunnel requests do not expose a verified stable Chat conversation identifier.

Therefore a Connection Host restart is an explicit planner recovery boundary.

Do not infer planner identity from User-Agent, IP address, timestamps, or other weak fingerprints.

Recovery must use durable Planner Handoff / Workstream state.

## Monitor projection

Monitor must show real evidence, not a decorative green graph.

For each hop display at least:

- state
- last verified time
- active request count where relevant
- recovery attempt/state
- latest failure
- whether the evidence is local-only or end-to-end

The graph should distinguish forward request flow and reverse result/telemetry flow.

## Non-goals

- moving Runtime policy into Desktop;
- duplicating Runtime idempotency/approval rules in Tunnel;
- claiming exact ChatGPT network or context state when OWL cannot observe it;
- treating third-party implementation details as OWL architecture requirements.
