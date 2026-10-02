# OWL LAB 1.1 — Connectivity Reliability Hardening

Status: **active RC plan**.

## Why this exists

Dogfood repeatedly showed cases where a process still looked alive while the user-facing transport had stalled.

A source-level comparison against Desktop Commander 0.2.52 confirmed that OWL Runtime's durable local execution is already stronger, while OWL's remote connectivity control plane needs more mature reachability and self-healing semantics.

This plan hardens the control plane without reopening Runtime 1.0.

## Reference baseline

Third-party research baseline:

```text
repo: wonderwhy-er/DesktopCommanderMCP
version: 0.2.52
commit: c774c3b505de990219637ecdc9a830c8772fae9d
license: MIT
local reference: ../_reference/DesktopCommanderMCP
```

Use the source and tests as a reliability reference, not as a vendored dependency.

## P0 — Required before 1.1 RC

### P0.1 Bounded ConnectionHostClient RPC

Target:

`electron/services/connection-host-client.mjs`

Add timeout, AbortSignal, structured timeout error, and cleanup.

Acceptance:

- stalled HTTP endpoint cannot block a Desktop refresh forever;
- unit tests prove timeout and caller cancellation;
- ordinary healthy request behavior remains unchanged.

### P0.2 Bounded capability-bridge RPC

Target:

`connection-host/server.mjs::bridgeRpc()`

Add a hard deadline and distinguish unavailable vs timed-out bridge.

Acceptance:

- stalled Electron bridge fails within deadline;
- Connection Host remains responsive to health requests;
- no unbounded pending promise.

### P0.3 Reachability Supervisor

Extend Tunnel/Connection Host state beyond process existence.

Required facts:

- processAlive;
- local health;
- last successful transport/roundtrip;
- staleAt or stale duration;
- recovery attempt;
- recovery state;
- last error.

Acceptance:

- a live process with stale transport proof is not reported READY.

### P0.4 Half-open / stale transport watchdog

Add a periodic health check independent from process exit events.

Detect:

- transport stale despite process alive;
- endpoint stalled;
- recovery/join phase wedged.

Acceptance:

- injected half-open/stall transitions READY -> STALE -> RECOVERING;
- recovery is bounded;
- no manual UI restart required.

### P0.5 Independent Connection Host recovery

`dev:full` and product supervision must treat Connection Host as its own fault domain.

Required behavior:

- Connection Host exit does not kill Runtime;
- existing managed processes continue;
- host restarts;
- new MCP session can initialize;
- if planner identity cannot be proven, surface Session Handoff/recovery rather than guessing.

### P0.6 Recovery transaction timeout + single-flight

All recovery paths use one in-flight recovery promise/guard and an outer timeout.

Acceptance:

- repeated watchdog ticks do not launch concurrent recovery;
- hung recovery clears its guard after timeout;
- subsequent recovery attempt can proceed.

## P1 — Strongly recommended for 1.1

### P1.1 Jittered reconnect backoff

Add jitter to Tunnel restart delays.

### P1.2 Truthful Monitor reachability

Monitor Live Graph shows:

- process;
- transport;
- MCP;
- Runtime;
- execution;

with last verified time and recovery state.

Do not animate a hop as healthy merely because its child process exists.

### P1.3 Long-process output long-poll UX

Keep Runtime durable files.

Expose cursor/offset-based output reads that may wait briefly for new output/state.

Goals:

- avoid repeated empty reads;
- return quickly on prompt/exit/failure;
- never accumulate unbounded in-memory output.

If this requires a new Runtime public fact, file it for additive 1.x work; do not reopen the frozen 1.0 ABI casually.

### P1.4 Bounded shutdown

Bound:

- Tunnel stop;
- MCP session close;
- HTTP listener close.

Graceful close failure must not hang the product indefinitely.

### P1.5 Serialize competing status transitions

Any durable ONLINE/OFFLINE/DEGRADED writes that can race must be ordered or revision guarded.

### P1.6 Fast-fail transport capability

After repeated failed recovery, stop advertising a transport as available until it proves reachability again.

## P2 — Follow-up hardening

- fault injection for Wi-Fi loss / sleep-wake / stalled loopback endpoint;
- long soak with repeated MCP reconnect;
- clock-skew review for any future token/presence provider;
- network transition telemetry without secrets;
- per-hop latency and last-success histograms;
- release soak on packaged Desktop, not only dev:full.

## Already strong — do not regress

OWL Runtime already provides:

- detached durable managed processes;
- persistent stdout/stderr;
- encrypted process metadata;
- Runtime restart process reconciliation;
- process control capability;
- owner Session/Task isolation;
- workspace leases;
- cancellation;
- process-group termination;
- durable Runtime Tasks.

OWL MCP already provides:

- active-request protection from idle reclamation;
- accepted Runtime operation survival after upstream disconnect;
- stale owner transport supersession;
- reconnect soak coverage;
- planner ownership isolation;
- Session Handoff / Workstream Continuity.

The reliability project must improve the weak transport/control-plane layer without replacing these stronger mechanisms.

## Verification matrix

Each item must be automated where practical:

| Failure | Expected behavior |
| --- | --- |
| Renderer crash | Desktop UI restarts; Runtime/Connection Host work survives |
| Tunnel child exits | automatic restart with backoff+jitter |
| Tunnel child alive but transport stale | STALE -> RECOVERING -> READY or UNREACHABLE |
| Connection Host control endpoint stalls | Desktop request times out; UI remains responsive |
| Desktop capability bridge stalls | Connection Host request times out; host remains healthy |
| Connection Host exits | Runtime/tasks/processes survive; host restarts |
| MCP upstream disconnects mid-call | accepted Runtime operation continues |
| MCP idle TTL during live stream | live stream not reclaimed |
| repeated reconnect | no session leak beyond cap/TTL |
| Runtime restarts | durable Task/process recovery remains correct |
| Chat A -> Chat B | resume original workstream; no replacement Runtime Task |
| Host restart with no stable upstream planner ID | explicit handoff/recovery boundary; no identity guess |

## Release gate

1. Full Desktop test suite passes.
2. New connectivity fault-injection tests pass.
3. `npm run build` passes.
4. `git diff --check` passes.
5. dev:full proves independent Desktop and Connection Host recovery.
6. One real ChatGPT dogfood intentionally kills/restarts each recoverable local layer while a durable Runtime process continues.
7. Monitor's displayed reachability matches injected failures.

## Implementation checkpoint — 2026-10-02

The first Connectivity Reliability hardening slice is now implemented in the
Desktop / Connection Host control plane.

Completed:

- **P0.1 bounded Connection Host control RPC**
  - ConnectionHostClient.request() now uses AbortController;
  - default and per-operation deadlines are explicit;
  - caller cancellation is preserved separately from timeout;
  - unavailable, timeout and application failures have distinct error codes.

- **P0.2 bounded Desktop capability-bridge RPC**
  - Connection Host no longer uses an unbounded raw fetch() to Electron;
  - bridge timeout, cancellation and unavailability are distinct;
  - bridge fault injection proves a stalled Electron-side endpoint cannot pin a
    Connection Host request forever.

- **P0.3 evidence-based Tunnel reachability**
  - OWL consumes the vendored openai/tunnel-client health contract instead of
    inferring health from process liveness or parsing log messages;
  - Tunnel starts with an ephemeral --health.url-file;
  - Supervisor reads /health?details=true and /readyz;
  - the control-plane component supplies bounded upstream evidence including
    last success, failures, retry state and failure category;
  - running remains a process lifecycle fact and no longer implies READY.

- **P0.4 half-open / stale watchdog**
  - periodic health checks continue while the Tunnel process is alive;
  - stale health endpoint or stale degraded control-plane evidence transitions
    the Tunnel to STALE/RECOVERING;
  - a stale live process is terminated and restarted instead of remaining green;
  - recovery is single-flight.

- **P0.5 Connection Host fault-domain isolation — automated isolation gate complete**
  - dev:full now uses a dedicated child supervisor and restarts Connection Host
    independently after process exit or spawn error;
  - fault injection proves a Host exit launches a replacement without sending
    any signal to a healthy Runtime child;
  - spawn error + exit is handled once rather than triggering duplicate recovery;
  - coordinated shutdown cancels queued restarts;
  - a real destructive Host-restart dogfood is still intentionally pending
    because killing the currently controlling Connection Host would sever the
    active Jarvis session. That final acceptance test must run through an
    isolated harness or a prepared handoff.

- **P0.6 bounded recovery**
  - Tunnel recovery has one in-flight recovery promise;
  - child termination escalates TERM -> KILL with bounded timers;
  - Connection Host graceful shutdown bounds listener close, Tunnel stop and MCP
    close independently.

- **P1.1 jittered reconnect backoff**
  - Tunnel automatic restart now adds bounded jitter to exponential backoff.

- **P1.2 truthful Monitor reachability**
  - Monitor connectivity and Live Graph prefer Tunnel reachability evidence over
    process state;
  - READY is green;
  - DEGRADED/STALE is attention;
  - STARTING/RECOVERING is waiting;
  - the graph carries last health evidence and marks recovery as current work.

- **P1.3 durable process output wait**
  - Runtime 1.0 remains unchanged;
  - the MCP compatibility layer now returns a stateless output cursor;
  - follow-up reads may provide after_cursor + wait_ms (max 5 seconds);
  - the read returns immediately when durable stdout/stderr or process state
    changes, otherwise returns unchanged at the bounded deadline;
  - terminal processes never wait;
  - each internal Runtime observation uses a distinct read-only request identity,
    avoiding stale idempotency replay across one long-poll operation.

Also cleaned:

- duplicate continuation projection in the MCP server snapshot.

Verification at this checkpoint:

    targeted reliability gate: 7/7 files, 38/38 tests PASS
    full Desktop gate:          47/47 files, 219/219 tests PASS
    TypeScript + Vite build:    PASS
    git diff --check:           PASS

The implementation preserves the existing MCP guarantees that an accepted
Runtime operation survives upstream disconnect and that live/in-flight MCP
sessions are not reclaimed by idle TTL.

Post-P1.3 / Host-isolation verification:

    isolated Host supervisor:   3/3 tests PASS
    full Desktop gate:          49/49 files, 226/226 tests PASS
    TypeScript + Vite build:    PASS
    git diff --check:           PASS
