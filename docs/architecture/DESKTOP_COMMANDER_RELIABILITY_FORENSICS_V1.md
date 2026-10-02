# Desktop Commander Reliability Forensics v1

Status: Phase 2 source-forensics baseline for OWL LAB 1.1 reliability hardening.

## Scope

Upstream repository: wonderwhy-er/DesktopCommanderMCP
Research checkout: /Users/wahaha/Documents/Me/Project/cursor/_reference/DesktopCommanderMCP
Baseline release: 0.2.52
Baseline commit: c774c3b505de990219637ecdc9a830c8772fae9d
License: MIT

This document studies seven upstream stability commits at the level of:
failure mode -> exact implementation mechanism -> regression test -> transferable invariant -> OWL-native mapping.

The goal is not to clone provider-specific Supabase/Reatime code. The goal is to preserve the failure invariant using OWL's own Tunnel, Connection Host, MCP and Runtime architecture.

---

## 1. 65c4a4b — recover a half-open socket instead of recycling it forever

Commit:
65c4a4b3e6f6d938907e5aee44e9af0b643c4d91
2026-06-25
fix: recover device Realtime channel from half-open socket on reconnect (#520)

### Failure before the fix

After idle, Wi-Fi loss or sleep/wake, the Supabase socket could remain locally OPEN while the peer was already gone.

The old recovery sequence removed a channel without awaiting removal and created a replacement immediately. The channel registry therefore never necessarily reached zero, realtime-js kept the old half-open WebSocket, every new subscribe timed out, and only a full process restart repaired it.

A second failure existed inside the recovery mechanism itself: an await that never settled could leave the recreate guard permanently true, disabling later watchdog recovery.

### Exact upstream implementation changes

RemoteChannel gained:
- reconnectAttempt;
- isRecreatingChannel;
- compact connState diagnostics;
- a bounded withTimeout helper;
- a recreateChannel transaction with a re-entrancy guard.

The recovery sequence changed from "remove and immediately recreate" to:
1. refuse a second recreate while one is in progress;
2. await removeChannel so the old channel registry can drain;
3. explicitly disconnect realtime so a half-open socket is destroyed;
4. wait for socket teardown before a new subscribe;
5. put the whole transaction behind an outer timeout;
6. clear the recovery guard in the final path.

The health checker also stopped treating every non-joined state as immediately fatal. A normal joining state was allowed to converge so the watchdog did not amputate the SDK's own recovery.

CLOSED was changed into a settling failure rather than a branch that could leave a subscribe/recreate promise hanging.

### Regression evidence

test/test-remote-channel-reconnect.js added deterministic cases:
- control: recovery when the old socket is torn down first;
- half-open socket recovery;
- joining is transitional and must not be destroyed immediately.

The commit body records the old behavior as repeated TIMED_OUT joins reusing the same dead socket.

### Transferable invariant

A cached OPEN/connected state is not proof of a usable transport.
A recovery path must be single-flight, bounded, and must destroy stale transport state before rebuilding it.

### OWL mapping

OWL does not own the OpenAI Tunnel's internal WebSocket and therefore must not reproduce Supabase-specific disconnect internals.

OWL-native equivalent:
- TunnelSupervisor consumes the vendor-supported local health surface;
- stale live processes enter STALE/RECOVERING;
- recovery is single-flight;
- TERM escalates to KILL on a bounded timer;
- Tunnel restart is jittered;
- Connection Host RPC and bridge RPC are deadline-bounded.

Implemented primarily in:
- electron/services/tunnel-supervisor.mjs
- electron/services/connection-host-client.mjs
- connection-host/bridge-rpc.mjs

Status: implemented and tested.

---

## 2. 0590356 — joining is healthy only for a bounded amount of time

Commit:
059035678a7c75866bc130f6f65d6a964ec0a8a9
2026-07-08
fix(remote-device): recover from reconnect wedge when channel stalls in joining (#528)

### Failure before the fix

The previous repair deliberately treated joining as healthy so realtime-js could run its normal rejoin backoff.

Production then exposed the opposite edge case: on a half-open socket, the channel could remain in joining indefinitely. Because joining was unconditionally accepted, the only path that destroyed the dead socket never fired.

The upstream report describes a device offline for more than four minutes with no recreate attempt while an unrelated HTTP heartbeat continued advancing last_seen.

### Exact upstream implementation changes

A JOINING_WEDGE_TIMEOUT_MS of 30 seconds was introduced.

RemoteChannel added joiningSince and changed health logic to:
- reset joiningSince when joined;
- start a monotonic "continuous joining" window on first joining observation;
- permit short joining intervals;
- force recreate after the bound;
- reset the timer on any other state.

The bound was selected against the SDK's approximately 10-second join push timeout, so an uninterrupted 30-second joining interval was treated as a stalled state machine rather than ordinary convergence.

### Regression evidence

test/test-remote-channel-reconnect.js added:
"recovers when a half-open socket leaves the channel stuck in joining"

The test advances a simulated clock instead of sleeping in wall time.

### Transferable invariant

Transitional states need a convergence budget.
"STARTING", "JOINING" or "RECOVERING" cannot be accepted forever simply because they are not explicit errors.

### OWL mapping

OWL does not see the Tunnel's private channel state. It sees:
- /readyz;
- /health?details=true;
- control-plane component observations;
- last successful control-plane evidence.

OWL uses:
- startup grace;
- periodic health probes;
- stale evidence windows;
- STALE -> RECOVERING transition.

This is the same invariant at the correct abstraction boundary.

Status: implemented and tested.

---

## 3. 51b36a0 — joined is not liveness, and wall clock is not a liveness clock

Commit:
51b36a0634d6acab83838a6af53a18145b1424d4
2026-09-02
fix(remote-device): correct clock skew and half-open socket wedges (#629)

### Failure A: joined forever

The channel could stay joined on a half-open socket. The health checker returned early on state === joined, so no recovery occurred.

### Failure B: local wall-clock skew

A forward-skewed machine made auth-js treat fresh tokens as expired and refresh continuously. The commit cites more than 9,300 refreshes in 24 hours on one affected device.

A review then found a more general timing problem: if liveness timers also use Date.now, correcting wall clock during the process can jump the measured elapsed time forwards or backwards.

### Exact upstream implementation changes

Transport liveness:
- add lastHeartbeatOkAt;
- record confirmed heartbeat replies;
- treat a fresh successful subscribe as proof of life;
- while state reads joined, cross-check heartbeat freshness;
- force recreate after HEARTBEAT_STALE_TIMEOUT_MS = 75 seconds.

Clock handling:
- correct auth wall-clock calculations from the server Date header;
- disable auth-js automatic refresh and drive token refresh on a fixed cadence;
- move liveness duration math to performance.now;
- keep wall-clock correction for token expiry and timestamps where wall time is actually semantically required.

The recreate self-heal shortcut was also hardened: joined is not enough to cancel a pending recreate if the heartbeat evidence that triggered recovery is already stale.

### Regression evidence

test/test-remote-channel-reconnect.js covers:
- stuck-at-joined half-open recovery;
- fixed token refresh cadence under simulated skew;
- server-Date correction;
- small drift ignored;
- skew restoration;
- malformed/missing Date ignored;
- reconnect growth/bounds.

The stuck-at-joined test deliberately pins Date.now hours backward while advancing performance.now. A Date.now-based liveness implementation fails that regression.

### Transferable invariant

Elapsed-time safety decisions must use a monotonic clock.
Wall clock belongs to timestamps, expiry contracts and human time; it must not be the sole clock for watchdog elapsed time.

### OWL mapping discovered by this forensic pass

OWL already separated structured Tunnel evidence from process state, but its stale-age calculation still mixed returned absolute timestamps with Date.now.

Phase 2 therefore added:
- monotonic start time;
- monotonic last local-health proof;
- monotonic observation time for changes in control-plane last-success evidence;
- stale and startup-grace calculations based on monotonic elapsed time.

A regression test now moves Date.now backward by six hours while monotonic time advances beyond the stale window. Recovery still fires.

Status: newly implemented during Phase 2; targeted regression passes.

---

## 4. 07ead63 — a healthy transport is not a healthy executor

Commit:
07ead6324ab82b058aa71e04273c8588363e0057
2026-09-22
fix(remote): bind device readiness to the local executor, not just the channel (#717)

### Failure before the fix

The hosted service selected devices from an online status.

RemoteChannel considered channel joined sufficient for reachability. A dead local MCP child could therefore be advertised online again by heartbeat even when it could not execute a tool.

Three related defects were reproduced:
- a dead local executor could be advertised online while the channel was healthy;
- repeated routed calls could drive one child spawn per call after restart failures;
- completing MCP initialize was treated as enough proof to return online even if tools/list and tools/call were unusable.

A follow-up review found another subtle interaction: removing false-online behavior removed the incoming-call retry driver. If recovery attempted only once and failed, the device could now stay honestly offline forever.

### Exact upstream implementation changes

RemoteChannel:
- setLocalExecutorProbe;
- isReachable became transport joined AND local executor ready;
- online/offline status was synchronized through that predicate;
- concurrent status writes were serialized.

DesktopCommanderIntegration:
- restart attempt count;
- bounded restart backoff;
- one shared reinitialization promise;
- verifyExecution using a real listTools request;
- a child that handshakes but cannot serve tools is discarded and counts as a failed restart.

MCPDevice:
- installs a live local-executor probe;
- marks the device offline on local MCP loss;
- keeps retrying recovery in the background with pacing;
- does not declare online merely because the local child restarted;
- recovery must also respect remote channel readiness.

### Regression evidence

test/test-remote-device-readiness.js includes:
- dead local executor not advertised online;
- repeated restart failures are spaced;
- online withheld until tool layer answers;
- initialize not ready until child serves a request;
- shutdown cancels initialization in flight;
- queued online cannot overtake local-loss offline;
- failed restart recovers without an incoming tool call;
- joined channel does not announce online while executor dead;
- recovery does not announce online while channel down.

### Transferable invariant

Readiness is the AND of every capability required to complete the advertised operation.

Transport readiness, protocol handshake and execution readiness are separate facts.

### OWL mapping

OWL already models these facts separately instead of collapsing them into one status:
- Tunnel reachability;
- MCP endpoint state;
- Runtime reachability;
- Runtime access state;
- operational state;
- durable Task/process execution state.

For that reason Phase 2 deliberately does not redefine mcpAvailable to mean execution-ready. That would collapse facts and recreate the design mistake in another form.

The required OWL rule is:
remote scheduling must use the combined readiness/authorization facts appropriate to the operation, never mcpAvailable or Tunnel PID alone.

The new tunnelTransportAvailable helper specifically refuses to advertise remote transport capability unless process, local readiness and control-plane evidence all agree.

Status: architecture already separated; transport advertisement hardened; scheduler/Cloud policy should continue to preserve the multi-fact contract.

---

## 5. 7504827 — never announce ready before the delivery path is proven

Commit:
75048278f4866f0d8bde26f6f9aa3b8d39dca870
2026-09-22
fix(remote): stop announcing a device ready before anything can reach it (#724)

### Failure before the fix

registerDevice wrote online before the realtime subscription was usable.

A join failure could be swallowed while the process still printed Device ready. The service then selected a device with no working delivery path.

Review found progressively narrower races:
- channel joined but presence/capability publication failed;
- presence track returned OK but the durable capability write was refused;
- online and capability writes could disagree;
- heartbeat could run in the narrow interval after presence acknowledgement but before durable readiness writes landed.

### Exact upstream implementation changes

A ChannelUnreachableError separated recoverable channel faults from unrecoverable registration failures.

Registration changed to:
- write offline first;
- join the channel;
- publish presence;
- write transport capability;
- only after capability is durably recorded write online;
- raise presenceTracked last, after every fact it claims has landed.

isReachable evolved to require:
channel joined AND presence durably proven AND local executor ready.

queueStatusWrite serialized online/offline writes so teardown and recovery could not complete out of order.

Heartbeat was gated through the same readiness predicate instead of asserting online independently.

### Regression evidence

test/test-remote-device-ready-requires-channel.js includes:
- healthy join becomes online;
- failed join is visible;
- registration does not claim online before join;
- joined channel without presence is not ready;
- refused readiness write is not ready;
- heartbeat cannot publish online while readiness writes are in flight;
- missing device row is fatal rather than mislabeled recoverable.

test/test-remote-transport.js additionally checks:
- heartbeat silent without joined transport;
- heartbeat silent without presence;
- heartbeat writes only when both are proven;
- concurrent status writes stay ordered.

### Transferable invariant

A readiness flag is a claim, not an aspiration.
Set it last, after all prerequisites are proven, and make every reader use the same predicate.

### OWL mapping

OWL's Tunnel process state remains a lifecycle fact only.

Phase 1/2 changed remote tunnel availability to fail closed:
- process must be running;
- reachability must be READY;
- localReady must be true;
- control-plane component must be OK.

Phase 2 also added Tunnel generation identity so an old async health result cannot overwrite the state of a newer process generation.

Status: implemented and tested.

---

## 6. 2434718 — notification is a doorbell; durable pending work is the source of truth

Commit:
2434718a0a8993d882cb05dc648c669f09bb4399
2026-09-23
fix(remote): recover pending calls after reconnect (#752)

### Failure before the fix

A remote call could be inserted while the realtime connection was briefly down.

If its one new_call notification was missed, nothing rediscovered the pending row. The call could sit until timeout even though the device had already reconnected.

### Exact upstream implementation changes

After presence becomes genuinely usable, RemoteChannel fires recoverPendingCalls.

recoverPendingCalls:
- exits if client/device/readiness is absent;
- queries the durable mcp_remote_calls table;
- selects only this device;
- selects only pending rows;
- ignores expired rows;
- sorts oldest first;
- caps each reconnect scan to a bounded batch;
- feeds each row through the same onDoorbell claim path;
- stops scanning if reachability is lost during recovery.

The notification path itself uses a conditional pending -> executing claim. Because backlog recovery reuses that same atomic claim, a late notification may race the recovery scan without executing the side effect twice.

The code explicitly treats an ambiguous already-executing row conservatively: without claimant identity, guessing could duplicate a side effect, so it skips rather than executing again.

### Regression evidence

test/test-remote-pending-recovery.js was added.

The surrounding remote-transport suite validates:
- duplicate delivery executes once;
- another claimant wins cleanly;
- wrong-device calls are ignored;
- transient claim failures retry;
- ambiguous executing state is not guessed into a duplicate execution.

### Transferable invariant

Ephemeral notifications are wake-ups.
Durable work records are the source of truth.
Reconnect must reconcile pending durable work through the same idempotent/claim authority used by the fast path.

### OWL mapping

OWL Cloud already follows this pattern:
- Cloud RemoteCommand is durable;
- Cloud Bridge polls/reconciles durable commands;
- local outbox persists events/telemetry;
- Runtime Task is execution authority;
- idempotency keys prevent replacement work;
- uncertain completion enters reconciliation instead of blind replay.

For ChatGPT/Tunnel, once OWL MCP has accepted Runtime work, upstream HTTP/Tunnel disconnect does not cancel the Runtime operation. Reconnect tests rediscover durable Task state.

Status: architectural equivalent already implemented and covered by disconnect/reconnect tests.

---

## 7. 550a0b3 — desynchronize recovery and avoid capability flapping

Commit:
550a0b3e31da18b7cf25e87ed840e3d953b6da42
2026-09-24
fix(remote): desynchronize realtime recovery (#745)

### Failure before the fix

Even correct retry logic can create a fleet outage if every client retries on the same deterministic schedule.

Presence failure also had a second-order effect: immediately withdrawing a previously proven broadcast capability could move the device into a much faster legacy heartbeat tier, multiplying writes during a transient provider incident.

### Exact upstream implementation changes

The commit introduced jitterAround.

realtimeReconnectDelayMs keeps the SDK-shaped 1s/2s/5s/10s schedule but multiplies each device independently by approximately 0.5..1.5.

presenceRetryDelayMs preserves the existing 500ms-per-attempt shape but adds independent jitter.

A presenceFailureStartedAt monotonic timer adds a grace period:
- if broadcast capability was already proven and the channel remains joined, a short presence-only failure does not immediately withdraw capability;
- the health checker keeps retrying;
- sustained failure beyond the grace period withdraws capability;
- successful presence clears the degradation timer.

### Regression evidence

Reconnect tests cover:
- realtime schedule jitter;
- presence retry jitter;
- reconnect backoff growth and bounds.

Remote transport tests cover:
- transient presence failure retains previously proven capability;
- sustained presence failure withdraws after grace;
- recovery clears the grace timer.

### Transferable invariant

Retry correctness is not enough; retry populations must be desynchronized.

Capability withdrawal should be fail-safe but should also distinguish a transient sub-capability failure from a sustained loss, when the prior capability was actually proven and continuing to advertise it for the grace interval is safe.

### OWL mapping

OWL Tunnel process restart now uses exponential backoff plus jitter.

OWL does not copy the upstream Presence grace model because its vendor Tunnel exposes structured control-plane readiness directly. OWL fails closed when Tunnel reachability is not READY rather than inventing a second transport-capability lease.

Whether the vendor Tunnel's own internal control-plane reconnect is jittered remains a vendor responsibility; OWL's supervisor-level restart schedule is independently desynchronized.

Status: outer recovery jitter implemented; no provider-specific Presence grace port required.

---

## Cross-commit conclusions

### 1. Most "network bugs" are state-model bugs

The recurring upstream failure was not simply missing retry. It was an invalid equivalence:
- socket OPEN == alive;
- channel joined == reachable;
- MCP handshake == executable;
- presence ACK == durable capability;
- process running == ready.

OWL must continue splitting these into independent facts.

### 2. Every recovery path needs its own failure model

A watchdog that can itself hang is not a watchdog.
A retry loop without pacing can become a denial of service.
A false-online bug can accidentally become the retry driver; removing it requires a new honest retry driver.

### 3. Durable truth must outlive ephemeral transport

The strongest upstream pattern is:
notification -> durable row -> atomic claim -> execution -> durable result.

OWL already generalizes this with RemoteCommand, Runtime Task, RuntimeEvent and reconciliation.

### 4. Monotonic time is part of correctness

Timeouts, stale windows and convergence budgets must not depend on mutable wall clock.

OWL Phase 2 now applies this to Tunnel stale evidence.

### 5. Ready must be set last and derived from one predicate

Every writer and reader of readiness must agree on the same proven prerequisites.

OWL should preserve its richer multi-fact model rather than create one overloaded "online" bit.

---

## OWL implementation status after Phase 2

Implemented:
- bounded Connection Host RPC;
- bounded Desktop capability bridge RPC;
- abortable waits even when the underlying promise ignores AbortSignal;
- evidence-based Tunnel health;
- half-open/stale recovery;
- single-flight recovery;
- bounded TERM -> KILL;
- independent Connection Host supervision;
- jittered Tunnel restarts;
- truthful Monitor reachability;
- durable process-output wait;
- generation-safe Tunnel health writes;
- fail-closed Tunnel capability advertisement;
- monotonic stale timing.

Still required before declaring OWL LAB 1.1 Reliability complete:
- real live destructive Connection Host restart through a prepared handoff;
- live run using the new Tunnel health-url/watchdog code rather than the currently old resident process;
- P2 Wi-Fi/sleep-wake/stalled-loopback fault injection;
- longer repeated reconnect soak on the packaged Desktop;
- final packaged release gate.
