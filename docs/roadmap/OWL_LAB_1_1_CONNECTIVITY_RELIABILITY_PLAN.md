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

### P2 implementation checkpoint — automated lanes

The non-destructive P2 lanes have now been exercised beyond the ordinary unit
gate.

- **stalled loopback / half-open equivalent**
  - Tunnel health fetch has an independent bounded await even when an injected
    fetch implementation completely ignores AbortSignal;
  - stale control-plane evidence while the Tunnel child remains alive is
    recovered through STALE -> RECOVERING rather than process-liveness green.

- **sleep/wake and wall-clock discontinuity**
  - Tunnel watchdog evidence age uses monotonic time;
  - the regression suite moves Date.now six hours backward while monotonic
    evidence continues aging and proves recovery still fires;
  - MCP session idle TTL and owner-supersede grace now use monotonic elapsed
    time while retaining wall-clock timestamps for UI/logging;
  - MCP regression moves wall time +24h and -24h and proves idle reclamation
    follows monotonic time;
  - Runtime bootstrap health wait also uses monotonic elapsed time;
  - Cloud RemoteCommand expiresAt intentionally remains wall-clock based because
    it is an absolute protocol timestamp rather than an elapsed watchdog.

- **network transition telemetry without secrets**
  - Tunnel reachability state changes emit structured from/to/reason evidence;
  - transition metadata includes local readiness, control-plane status,
    consecutive failures and last proof timestamps;
  - regression coverage proves API keys, tunnel IDs, MCP URLs and secret text
    are not included in transition metadata.

- **long MCP reconnect soak**
  - the reconnect soak count is configurable through
    OWL_MCP_RECONNECT_SOAK_CYCLES, bounded to 500;
  - a 100-cycle connect -> runtime_info -> disconnect run passed;
  - session cap, TTL cleanup, stale-owner takeover and live event-stream
    protection remained valid.

- **packaged structural smoke**
  - isolated unsigned arm64 and x64 unpacked Desktop bundles were built;
  - verify:packaged-smoke passed both architectures;
  - both bundles contain the pinned Runtime 1.0.0-rc.4 / API 0.1,
    both Tunnel architectures, Runtime Host 1.0.0 universal, Helper 1.0.0
    universal and the custom icon;
  - signing/notarization is intentionally outside development smoke and remains
    part of the formal distribution gate.

Still pending before Reliability can be declared fully closed:

- a longer packaged-runtime behavioral soak, beyond structural packaging;
- final signed/notarized distribution gate when release credentials are
  available.

The active-ChatGPT destructive Connection Host/Tunnel restart and live
health-url/watchdog acceptance were completed on 2026-10-02; see the live
acceptance evidence below.

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

- **P0.5 Connection Host fault-domain isolation — automated + live gate complete**
  - dev:full now uses a dedicated child supervisor and restarts Connection Host
    independently after process exit or spawn error;
  - fault injection proves a Host exit launches a replacement without sending
    any signal to a healthy Runtime child;
  - spawn error + exit is handled once rather than triggering duplicate recovery;
  - coordinated shutdown cancels queued restarts;
  - a prepared Planner Handoff was consumed before the live destructive test,
    so planner identity was recovered explicitly rather than guessed;
  - the real Host restart preserved the Runtime PID and an active durable managed
    process while replacing both Connection Host and Tunnel.

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

### P1.5 / P1.6 closure — generation-safe state and fail-closed availability

Completed in the dedicated reliability worktree after the initial P1 checkpoint.

- **P1.5 competing status transitions**
  - each Tunnel spawn now has a monotonically increasing local generation;
  - asynchronous health probes capture the child + generation they started against;
  - a probe result from a superseded generation is discarded before it can write
    READY/DEGRADED/STALE evidence;
  - regression coverage holds an old health response open, swaps to a new
    generation, releases the old response, and proves the new generation state is
    not overwritten.

- **P1.6 fast-fail transport capability**
  - Cloud presence no longer projects tunnel availability from process state;
  - availability is fail-closed and requires all of:
    process state running, reachability READY, localReady=true, and
    control-plane status OK;
  - STARTING, DEGRADED, STALE, RECOVERING, UNREACHABLE and legacy/no-evidence
    snapshots are not advertised as available.

Targeted closure gate:

    6 test files, 30/30 tests PASS
    git diff --check: PASS

### Phase 2 Desktop Commander forensics and monotonic watchdog hardening

The seven reliability commits selected from Desktop Commander 0.2.52 have now
been traced from failure mode through implementation and regression evidence.
The detailed study is:

- `docs/architecture/DESKTOP_COMMANDER_RELIABILITY_FORENSICS_V1.md`

The study produced an additional OWL-native correction from upstream commit
`51b36a0`: watchdog elapsed-time decisions must use a monotonic clock rather
than mutable wall clock.

Tunnel Supervisor now records monotonic evidence age for:

- process-generation startup grace;
- last successful local health proof;
- the last observed change in control-plane `last_success` evidence.

Wall-clock timestamps remain available for diagnostics and UI, but moving the
system clock cannot suppress or prematurely trigger the stale watchdog.

The Tunnel health fetch is also wrapped in OWL's abortable await primitive, so
a fetch implementation that ignores AbortSignal cannot permanently pin the
watchdog.

Regression coverage deliberately moves `Date.now()` six hours backward while
monotonic evidence ages beyond the stale threshold and proves recovery still
fires.

### Live destructive acceptance — 2026-10-02

The prepared Planner Handoff
`handoff_murcbj4t_ba7336bac91f` was resumed successfully before the destructive
test. The resumed workstream remained
`owl-owner:7ae5f727b5eedda47220e6a3df64a6d5`; no replacement Runtime Task was
created merely because the MCP transport changed.

The first destructive Host restart exposed one real gap: Connection Host
supervision restarted the host while Runtime survived, but Tunnel desired state
and its API credential existed only in the old Host lifetime. The replacement
Host therefore came back without a Tunnel.

The fix keeps the existing secret boundary intact:

- `dev:full` queues Tunnel recovery after every Connection Host launch;
- recovery runs through the real OWL Desktop Electron application identity in
  `OWL_TUNNEL_RECOVERY_ONLY=true` mode;
- the recovery-only process opens no Desktop window and does not initialize the
  normal Cloud/Runtime/UI bridges;
- the Tunnel API key is decrypted only from the existing OS-backed
  `safeStorage` vault and remains in memory;
- the key is handed only to the loopback Connection Host control RPC;
- the Tunnel child still receives an ephemeral 0600 credential file;
- no plaintext recovery credential or desired-state secret is persisted.

Final live evidence:

    before Host kill:
      Runtime PID:          93674
      Connection Host PID:  93839
      Tunnel PID:           94182
      durable process PID:  97731

    after Host kill:
      Runtime PID:          93674   (unchanged)
      Connection Host PID:  1040    (replaced)
      Tunnel PID:           1046    (replaced automatically)
      durable process PID:  97731   (unchanged)

The replacement Tunnel command contained a fresh `--health.url-file`.
After one watchdog interval its health endpoint reported:

    /readyz:                         HTTP 200
    health.live:                     true
    health.ready:                    true
    control-plane.status:            ok
    control-plane.state:             polling
    control-plane.consecutive_failures: 0
    control-plane.last_success:      2026-10-02T20:02:51.597604Z

The same ChatGPT conversation then reconnected through the replacement Tunnel,
successfully called OWL Runtime again, and read the same durable process record.
That process later exited normally with code 0 and preserved both
`FINAL_SURVIVOR_START` and `FINAL_SURVIVOR_DONE` in persistent stdout.

Post-fix gate:

    full Desktop gate:          52/52 files, 244/244 tests PASS
    Monitor model coverage:     PASS
    Operations graph coverage:  PASS
    Tunnel availability:        PASS
    TypeScript + Vite build:    PASS
    git diff --check:           PASS
    arm64 packaged smoke:       PASS
    packaged recovery module:   present in app.asar

This closes the active-ChatGPT Connection Host/Tunnel destructive restart gate.
The remaining Reliability items are packaged-runtime behavioral soak and the
signed/notarized distribution gate.

### Cloud durable MCP + packaged Connectivity Host acceptance — 2026-10-02

The Desktop Commander comparison exposed a structural reliability gap that
cannot be solved by making the Tunnel reconnect faster: remote request
correctness must not depend on one long-lived transport.

OWL now has a second, durable path:

    ChatGPT / MCP client
      -> Frankfurt Cloud /mcp
      -> durable McpCall
      -> device claim lease
      -> packaged Connectivity Host
      -> local OWL MCP
      -> OWL Runtime
      -> local completion journal
      -> Frankfurt completion

Cloud changes were isolated in \`feature/mcp-durable-ingress\`:

- \`eba7416\` adds durable MCP ingress with stable call identity, request digest,
  at-least-once pull, executor claim leases and idempotent completion;
- \`5614905\` adds a stateless JWT-protected \`/mcp\` gateway whose HTTP connection
  is not the source of truth for execution;
- \`c06c10f\` fixes real Aurora Data API JSONB decoding discovered by the live
  Frankfurt test.

The Cloud gate passed 70/70 tests and the latest Lambda/API Gateway revision
was deployed to \`OwlCloudDevStack\` in \`eu-central-1\`.

The Desktop durable consumer adds:

- claim-before-execute;
- automatic claim-lease refresh during long execution;
- local stable idempotency derived from Cloud \`callId\`;
- 0600 atomic completion journal before Cloud acknowledgement;
- completion replay without local re-execution after Host restart;
- MCP \`isError: true\` mapped to a durable Cloud \`failed\` state rather than a
  false successful completion.

Real Frankfurt acceptance used the existing OS-backed Desktop account/device
credentials without printing them. The gate proved:

    gateway:                   frankfurt
    Runtime API:               0.1
    Runtime version:           1.0.0-rc.4
    successful durable call:   PASS
    local MCP failure -> fail: PASS
    call queued offline:       PASS
    retry same request:        same callId
    consumer recovery:         same callId completed
    secrets printed:           false

The packaged product boundary was then hardened so the Desktop UI is no longer
the owner of the connectivity process lifetime:

- macOS LaunchAgent label: \`ai.owl.desktop.connectivity-host\`;
- \`RunAtLoad + KeepAlive + ProcessType=Background\`;
- the plist contains no Runtime token, MCP token, Tunnel API key or Cloud
  device credential;
- the background process is the same packaged OWL LAB Desktop executable in
  \`OWL_CONNECTIVITY_HOST_ONLY=true\` mode;
- it opens no window and hides its Dock icon;
- it reads secrets directly from the existing Electron \`safeStorage\` boundary;
- normal Desktop startup installs/repairs the LaunchAgent after Runtime is
  ready and then attaches the capability bridge;
- UI quit does not stop MCP/Tunnel when the external background Host is active.

Both unsigned smoke architectures were rebuilt. The packaged smoke gate now
requires \`connection-host/**/*\`, the LaunchAgent service and shared abortable
helpers to exist inside \`app.asar\`.

Destructive packaged evidence:

    packaged architecture:     arm64
    Host PID before kill:      67291
    Host PID after SIGKILL:    71147
    launchd automatic restart: PASS
    Runtime PID before:        69098
    Runtime PID after:         69098
    Runtime survived:          PASS
    Cloud consumer after kill: ready
    Cloud -> Runtime before:   PASS
    Cloud -> Runtime after:    PASS
    secrets printed:           false

Post-change source gate:

    full Desktop gate:          56/56 files, 256/256 tests PASS
    TypeScript + Vite build:    PASS
    release component gate:     PASS
    arm64 packaged smoke:       PASS
    x64 packaged smoke:         PASS
    packaged Connectivity Host: present in app.asar
    git diff --check:           PASS

This closes the UI/Connection-Host fault-domain requirement at the unsigned
development acceptance level. It does not close the signed/notarized
distribution gate or the longer packaged Runtime soak.
