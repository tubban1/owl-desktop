# Desktop Commander Stability Reference

Status: **third-party engineering research reference**.

This document is not an OWL dependency contract.

## Baseline

```text
Repository: wonderwhy-er/DesktopCommanderMCP
Version: 0.2.52
Commit: c774c3b505de990219637ecdc9a830c8772fae9d
Release commit date: 2026-09-29
License: MIT
Local research checkout: ../_reference/DesktopCommanderMCP
```

The checkout is intentionally outside `owl-desktop` and is not part of the OWL build.

## Why source checkout is necessary

The npm package exposes compiled `dist` code, which was sufficient to locate the major stability mechanisms but not sufficient for a complete reliability study.

The source repository adds:

- TypeScript source;
- reconnect/half-open tests;
- integration tests;
- commit history;
- issue/PR-linked fixes;
- exact rationale in source comments;
- release evolution.

Recent upstream commits immediately relevant to this study include:

- `550a0b3` — desynchronize realtime recovery;
- `2434718` — recover pending calls after reconnect;
- `7bad545` — stop device auth polling on terminal server answers;
- `c774c3b` — 0.2.52 release.

## High-value source paths

Primary remote reliability code:

```text
src/remote-device/remote-channel.ts
src/remote-device/device.ts
src/remote-device/desktop-commander-integration.ts
```

Primary process UX code:

```text
src/terminal-manager.ts
src/tools/improved-process-tools.ts
src/utils/process-detection.ts
```

High-value tests:

```text
test/test-remote-channel-reconnect.js
test/**remote**/
test/**process**/
```

## Reliability mechanisms to study

### Reachability instead of process liveness

Desktop Commander treats cached channel state as insufficient.

Important patterns:

- joined state cross-checked against confirmed heartbeat;
- joining wedge timeout;
- presence acknowledgement;
- local executor probe;
- reachability predicate gates ONLINE state.

OWL adaptation: unified Reachability State, not direct code copying.

### Jittered reconnect

Desktop Commander applies jitter to stepped reconnect timing to avoid synchronized reconnect waves.

OWL adaptation: add jitter to Tunnel/transport backoff.

### Bounded recovery

Channel recreation is wrapped in an overall timeout so a stuck recovery does not leave the watchdog permanently disabled.

OWL adaptation: all supervisors use bounded single-flight recovery.

### Half-open socket replacement

Desktop Commander explicitly destroys a stale socket and waits for the underlying client to leave a transient disconnecting state before recreating.

OWL adaptation: detect half-open transport at the correct abstraction layer. Do not assume the same Supabase-specific workaround applies to OWL Tunnel.

### Durable remote-call truth

Realtime delivery acts as a doorbell while durable database rows represent pending calls.

OWL adaptation: keep Cloud RemoteCommand durable and use notification only as wake-up.

### Duplicate execution defense

Desktop Commander combines local duplicate suppression with durable claim semantics.

OWL adaptation: preserve Runtime idempotency/task authority; do not copy duplicate policy into multiple OWL layers.

### Result-write fail-fast

Desktop Commander sanitizes unstorable output and, if a result write fails, attempts to record a terminal failure rather than leaving a phantom executing call until timeout.

OWL adaptation: reconciliation paths must prefer a durable terminal failure/uncertain state over silent indefinite pending.

### Local executor recovery

Desktop Commander resets readiness immediately when the child MCP disconnects, uses shared reinitialization, and verifies a real MCP operation before marking it ready.

OWL adaptation: READY requires a functional probe, not process PID.

### Output buffering and interaction

Desktop Commander protects in-memory output with caps and provides short long-poll reads.

OWL adaptation: keep OWL's stronger persistent-log architecture; borrow only cursor/long-poll UX.

## Where OWL is already stronger

Do not replace these with Desktop Commander designs:

- durable managed-process metadata;
- encrypted process records;
- detached process survival;
- persistent stdout/stderr files;
- Runtime restart PID reconciliation;
- process control capability;
- Task/Session ownership;
- workspace write leases;
- Planner Workstream + Handoff;
- explicit Runtime execution authority.

## Research rule

For every Desktop Commander mechanism:

1. identify the failure it prevents;
2. read its test;
3. inspect the commit/PR that introduced it when available;
4. reproduce the failure in an OWL-specific test;
5. implement the smallest OWL-native mechanism that enforces the same invariant;
6. do not mechanically port provider-specific or architecture-specific code.

## License boundary

The upstream repository is MIT licensed.

OWL may study and reuse MIT-licensed techniques/code subject to preserving required copyright/license notices for copied substantial portions.

Default engineering preference is to reimplement the invariant in OWL-native architecture rather than copy source wholesale.

## OWL-native Tunnel evidence source discovered during implementation

The current OWL Tunnel is not a black box. The vendored component is
openai/tunnel-client 0.0.15 (a390c168ff1b2d14e73a95991c186c6aba3ff5a0)
and already exposes a structured local health contract:

- /healthz — process liveness;
- /readyz — readiness gate;
- /health?details=true — structured component observations;
- control-plane — polling attempts, last success, failures, retry/backoff and
  bounded failure category.

Therefore OWL must **not** copy Desktop Commander's Supabase/WebSocket-specific
socket introspection into Tunnel Supervisor.

The transferable Desktop Commander invariant is:

> process/channel state is insufficient; require current functional evidence and
> recover a stale live process.

OWL implements that invariant by consuming the Tunnel component's own supported
health surface. This is both more stable and less coupled to vendor internals.
