# OWL LAB Connectivity Recovery Runbook v1

Status: **operator + dogfood runbook**.

## Goal

Determine which layer failed before restarting anything.

Do not restart the entire stack merely because the ChatGPT UI shows a network/recovery error.

## Layer order

Inspect in this order:

```text
1. Runtime
2. managed durable work
3. Connection Host
4. MCP
5. Tunnel
6. Desktop renderer/main
7. ChatGPT/upstream UI
```

The order is deliberate: first protect and identify durable work, then repair transport/UI layers.

## Runtime

Verify:

- Runtime HTTP health;
- access state;
- running durable Tasks;
- managed processes;
- stdout/stderr progress.

If Runtime and managed work are healthy, do not terminate them merely to repair Desktop/Tunnel.

## Connection Host

Verify:

- process exists;
- /health answers inside deadline;
- MCP server reports expected URL;
- session count;
- active request count;
- Tunnel supervisor state;
- last transport proof.

A process that exists but whose /health request times out is not healthy.

## MCP

Verify:

- local /mcp initialization works;
- existing live stream/request is not being idle-reclaimed;
- new tool request can roundtrip to Runtime;
- owner/workstream binding is correct.

If Connection Host restarted, do not assume an old Chat planner identity unless an explicit stable owner/workstream can be proven.

## Tunnel

Verify independently:

- child process;
- local target endpoint;
- upstream reachability proof;
- reconnect attempt/state;
- stale age.

Do not label Tunnel READY from child PID alone.

## Desktop

Renderer crash is not Runtime failure.

The expected product behavior is:

```text
Desktop UI restart
Runtime continues
Connection Host continues when healthy
managed processes continue
```

If Electron capability bridge is unavailable, Connection Host calls that require Desktop capabilities should fail fast with a bounded error rather than hang.

## Recovery sequence

Prefer the smallest repair:

1. retry bounded control RPC;
2. recover/restart Tunnel if transport stale;
3. restart Connection Host if host itself is unhealthy;
4. restart Desktop UI/main if its bridge/UI is unhealthy;
5. restart Runtime only when Runtime itself is unhealthy and durable recovery semantics are understood.

Never restart all layers first.

## Connection Host restart caveat

The upstream ChatGPT/Tunnel path currently provides no verified stable conversation identity across a Connection Host restart.

Therefore:

- preserve Planner Handoff state;
- preserve workstream checkpoint;
- preserve Runtime Task IDs;
- allow a fresh MCP transport to resume through explicit Continuity flow;
- never fingerprint User-Agent/IP/time to merge sessions.

## Long process inspection

Use managed-process observations and persistent logs.

A lack of new stdout does not by itself mean the process is dead.

Distinguish:

- running;
- waiting_input;
- finished;
- failed;
- terminating;
- lost.

After Runtime recovery, a process may remain alive while stdin is no longer attached. Surface that explicitly.

## Fault-injection dogfood

Run these deliberately:

- kill Renderer;
- kill Desktop main;
- kill Tunnel child;
- stall Tunnel local/upstream path without killing child;
- stall Connection Host HTTP handler;
- stall Desktop capability bridge;
- kill Connection Host;
- disconnect MCP client mid Runtime call;
- restart Runtime while detached process runs;
- open fresh Chat and resume handoff.

For each test record:

- failure injected at;
- first detection time;
- state transition;
- recovery start;
- recovery end;
- whether durable work continued;
- whether duplicate work was created;
- whether Monitor matched reality.

## Success criteria

No recoverable local transport/UI fault should require discarding a healthy Runtime Task or detached managed process.

No component may remain visually READY after its proof of reachability has gone stale.
