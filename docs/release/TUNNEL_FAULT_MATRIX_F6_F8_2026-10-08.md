# Isolated Tunnel Fault Matrix F6–F8 — 2026-10-08

Status: **PASS for isolated real process-level Tunnel fault lanes F6–F8.**

This evidence validates OWL Desktop Tunnel supervision and readiness behavior
with real child processes, real SIGKILL, real loopback HTTP health endpoints and
real half-open response bodies. It does **not** use the production Tunnel, its
Tunnel ID or its API key.

## Provenance

Desktop:
- branch: `main`
- HEAD exercised: `9eb8f47cd6b288ef004dd328d2c231c76e0ad5a1`
- harness: `scripts/verify-tunnel-fault-matrix-f6-f8.mjs`
- harness SHA256:
  `0bc17d62985290b626649dbffa928121d41e59b2e47a92aa4022ae321fa2938d`

Raw evidence:
- `release/acceptance/tunnel-fault-matrix-f6-f8/fault-matrix-f6-f8.json`
- SHA256:
  `208c29238c5b8b51d47bc6d90e087cbab9951bbad1e0315188b9ddbeea7e0d23`

Command:

```bash
node scripts/verify-tunnel-fault-matrix-f6-f8.mjs
```

Final exit code: **0**.

## Independent acceptance rerun on committed HEAD

After commit `6317660` was created, the same harness was rerun independently against the committed Desktop HEAD rather than relying only on the pre-commit acceptance run.

Rerun provenance:

- Desktop HEAD: `631766053cbf0dacc1a5d9aa820ea4e200e18442`
- harness SHA256: `0bc17d62985290b626649dbffa928121d41e59b2e47a92aa4022ae321fa2938d`
- rerun raw evidence SHA256: `f86c0947d2e42a0e018d1662f02644309db99dbd01cced7635271082c5cac1a4`
- rerun exit code: **0**
- F6/F7/F8: **PASS / PASS / PASS**
- production listener PIDs before/after: unchanged
- production Tunnel touched: **false**
- production Tunnel credentials used: **false**

Post-rerun regression gates:

- Tunnel/Connectivity Host targeted regression: **6/6 files, 26/26 tests PASS**
- Desktop full gate: **64/64 files, 291/291 tests PASS**
- TypeScript/Vite build: **PASS**
- `git diff --check`: **PASS**
- durable-submit verification: **PASS**

## Isolation proof

The harness assigns its own scratch `TMPDIR`, so Tunnel owner metadata,
temporary API-key files and health-url artifacts live in an isolated namespace.

| Listener | Before PID | After PID |
| --- | ---: | ---: |
| Runtime 8788 | 22677 | 22677 |
| Local MCP 8790 | 30562 | 30562 |
| Connectivity Host 8791 | 30562 | 30562 |

Additional guarantees:

- production Tunnel was not killed, restarted or reconfigured;
- production Tunnel credentials were not used;
- only fake fault-only Tunnel IDs/API keys were supplied;
- the fake Tunnel executable existed only in a temporary scratch root;
- production listener PIDs were unchanged.

## F6 — Tunnel process crash / reconnect

Fault:

- start a real supervised child process that exposes the Tunnel health contract;
- prove reachability `ready`;
- send **SIGKILL** to that exact child PID.

Observed:

- killed PID: **64017**
- replacement PID: **64251**
- Tunnel generation: **1 → 2**
- launch count: **2**
- final reachability: **ready**

Supervisor emitted restart scheduling evidence and automatically launched a new
generation.

Result: **PASS**.

## F7 — half-open health endpoint / false-green prevention

Fault:

- start and prove a healthy Tunnel;
- change the real loopback health server so `/health?details=true` sends HTTP
  200 headers plus a partial JSON body and never completes the body.

Observed:

- health probe terminated through the shared response deadline;
- error code: `TUNNEL_HEALTH_TIMEOUT`;
- half-open state was **not** reported as Ready;
- recovery reason: `health_probe_stale`;
- initial PID: **64368**
- replacement PID: **64562**
- generation: **1 → 2**
- final reachability: **ready**

Result: **PASS**.

## F8 — control-plane network loss while local Tunnel remains ready

Fault:

- start and prove a healthy Tunnel;
- keep the local health server alive;
- keep `/readyz` returning HTTP 200;
- freeze prior successful control-plane evidence while reporting the
  control-plane component as degraded/backoff/network.

Observed at stale detection:

- local readiness: **true**
- control-plane status: **degraded**
- error: `TUNNEL_CONTROL_PLANE_STALE`
- overall reachability was **not** Ready
- recovery reason: `control_plane_stale`
- initial PID: **64691**
- replacement PID: **64801**
- generation: **1 → 2**
- final reachability: **ready**

Result: **PASS**.

This validates:

```text
process alive
!= local endpoint healthy
!= upstream control-plane reachable
!= Tunnel Ready
```

Local `/readyz` success alone cannot keep the Tunnel green when upstream
control-plane evidence is stale.

## Acceptance summary

```text
false Ready observed          0
production Runtime task loss  0
production listener changes   0
```

## Scope still open

F6–F8 close isolated Tunnel crash, half-open and control-plane network-loss
lanes.

Still separate:

- actual macOS sleep/wake behavior;
- device credential rotation/revocation;
- Runtime token rotation/revocation;
- real Custom Tunnel credential rotation;
- combined multi-fault scenarios;
- packaged executable variants where source-level supervision evidence is not
  sufficient;
- final readiness closure;
- Managed Tunnel activation / OAuth cutover;
- signed/notarized install/update/rollback.

The accepted 100-cycle packaged Connectivity Host restart soak and the isolated
Cloud MCP F1–F5 evidence remain separate gates and are not replaced by this
record.
