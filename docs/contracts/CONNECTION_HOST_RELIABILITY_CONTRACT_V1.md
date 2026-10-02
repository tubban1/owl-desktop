# Connection Host Reliability Contract v1

Status: **required for OWL LAB 1.1 RC**.

## Scope

This contract covers:

```text
OWL Desktop
  <-> Connection Host control RPC
Connection Host
  <-> Desktop capability bridge
Connection Host
  -> OWL MCP
Connection Host
  -> Tunnel Supervisor
```

It does not move execution authority out of OWL Runtime.

## C1 — Bounded control RPC

`ConnectionHostClient.request()` must support:

- default timeout;
- per-call timeout override;
- caller AbortSignal;
- deterministic timeout error code;
- cleanup of timer and abort listeners.

Suggested defaults:

- health: 2-3 seconds;
- ordinary control RPC: 3-5 seconds;
- Tunnel start/restart: bounded separately, up to the expected recovery window.

No control-plane request may wait forever.

## C2 — Bounded capability bridge RPC

`connection-host/server.mjs::bridgeRpc()` must have a hard deadline.

Desktop main/Electron being alive but stalled must not pin a Connection Host request indefinitely.

The error must distinguish:

- connection refused/unavailable;
- timeout/stalled bridge;
- bridge responded with application error.

## C3 — Unified reachability projection

Connection Host health must expose separately:

- Connection Host process health;
- MCP server health;
- MCP session count;
- active MCP request count;
- Tunnel process state;
- Tunnel reachability state;
- last successful transport proof;
- current recovery attempt/state.

`running` is not sufficient to represent reachability.

## C4 — Recovery single-flight

Tunnel and Connection Host recovery paths must not stack concurrent restart/recreate operations.

All callers observing an in-progress recovery must await or observe the same recovery attempt.

## C5 — Bounded recovery transaction

A full recovery attempt must have an outer timeout and a `finally` path that clears recovery state.

A failed/hung recovery cannot permanently disable future watchdog attempts.

## C6 — Exponential backoff with jitter

Tunnel automatic restart uses exponential backoff plus jitter.

Repeated fleet failures must not synchronize all devices onto identical reconnect times.

## C7 — Half-open watchdog

The watchdog must detect at least:

- child process alive but transport proof stale;
- local endpoint alive but end-to-end roundtrip stale;
- recovery/join state stuck longer than its allowed convergence period.

Stale transport must transition:

```text
READY -> STALE -> RECOVERING
```

and not remain green.

## C8 — Connection Host crash semantics

A Connection Host crash must not stop:

- OWL Runtime;
- existing durable Runtime Tasks;
- detached managed processes;
- persistent process logs.

The host may restart independently, but planner identity must not be guessed after restart.

If the upstream MCP transport cannot prove the prior planner identity, surface a recovery boundary and use Planner Handoff / Workstream recovery.

## C9 — Graceful shutdown deadline

Connection Host shutdown must be bounded.

Stopping Tunnel, closing MCP sessions, and closing the HTTP listener cannot block forever.

After the graceful deadline, the supervisor may force termination while preserving Runtime durable work.

## C10 — Monitor truthfulness

Monitor labels READY only from current evidence.

Examples:

```text
Tunnel process alive + stale upstream proof -> DEGRADED/STALE
MCP alive + Runtime unavailable -> DEGRADED
Runtime alive + access locked -> not runnable
Renderer unavailable + Runtime alive -> UI unavailable; execution may continue
```

## C11 — No fallback execution backend

If MCP or Runtime is unavailable, Desktop must not silently execute through a legacy backend.

Uncertain execution is surfaced as uncertain; consequential work is not retried through an alternate execution path.

## C12 — Compatibility with Continuity

Connection Host reliability must preserve:

- distinct ChatGPT planner ownership per MCP transport where no explicit owner exists;
- workstream binding;
- active request survival;
- Session Handoff semantics;
- continuity epoch rotation on planner handoff.

Connection Host recovery must never merge unrelated Chat sessions.
