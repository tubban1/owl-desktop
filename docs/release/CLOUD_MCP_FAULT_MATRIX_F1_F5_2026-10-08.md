# Isolated Cloud MCP Fault Matrix F1–F5 — 2026-10-08

Status: **PASS for isolated real-integration fault lanes F1–F5.**

This does **not** close the entire packaged fault matrix. It validates Cloud MCP
durability and replay semantics with real Desktop MCP components, a real
isolated OWL Runtime, real process death, local HTTP fault injection, temporary
state roots and temporary filesystem side effects. The active production
Runtime, MCP, Connectivity Host and Tunnel were not modified.

## Provenance

Desktop:
- branch: `main`
- HEAD: `9fe7c883c4dc0a9ee8e72484de0ee3237c92428a`
- harness SHA256: `27001bef01a0752515a21f1cecf0b97ebce94dedea91a70067e0e3d52e5c8491`
- child worker SHA256: `489e8a4521e954e8f4af2efde005347c7abbfce3face5625c8169baaceb92d8c`

Runtime:
- HEAD: `45749cfb72223915e86f8f1ed30604cd1c386d84`
- launched on an isolated random port
- temporary `OWL_STATE_ROOT`
- temporary Runtime token
- `ALLOWED_DIRECTORIES` restricted to the temporary test root
- shell/browser/GUI disabled
- access + approval set to compatibility mode only for this isolated Runtime

Raw evidence:
- `release/acceptance/cloud-mcp-fault-matrix-f1-f5/fault-matrix-f1-f5.json`
- SHA256: `812181fc4c931cc9d7665a220a06e698c3685b7db4174c8326cc567c0abf21bd`

Command:
```bash
node scripts/verify-cloud-mcp-fault-matrix-f1-f5.mjs
```

Final exit code: **0**.

## Isolation proof

| Listener | Before PID | After PID |
| --- | ---: | ---: |
| Runtime 8788 | 22677 | 22677 |
| Local MCP 8790 | 30562 | 30562 |
| Connectivity Host 8791 | 30562 | 30562 |

The production Tunnel was not stopped, killed or reconfigured.

## F1 — Cloud unavailable → recovery

- consumer initially targeted an unused loopback endpoint
- state became `degraded`
- error: `CLOUD_NETWORK_ERROR`
- no local execution occurred
- fake Cloud then started on the same endpoint
- scheduled retry recovered to `ready`
- observed recovery: **262 ms**

**PASS**

## F2 — HTTP 503 + bounded timeout → recovery

Sequence:
1. Cloud returned 503 / `TEMPORARY_UNAVAILABLE`
2. next request intentionally hung
3. bounded client timeout produced `CLOUD_TIMEOUT`
4. Cloud returned 200

Observed peak failure count: **2**. Recovery cleared failure count and restored
`ready`.

**PASS**

## F3 — duplicate durable delivery

The same durable call was delivered twice with the same callId, owner, request
digest, tool and arguments.

Observed:
- Desktop local execution attempts: **2**
- Cloud completion attempts: **2**
- consequential append side effects: **1**

The stable `cloud-mcp-call:<callId>` identity was mapped through OWL MCP to
the same Runtime replay identity. Runtime returned the canonical prior result
instead of executing the append again.

**PASS — duplicate side effects: 0**

## F4 — completion ACK loss

Sequence:
1. Runtime completed the append
2. Desktop persisted the local completion journal
3. injected Cloud completion failed with `CLOUD_NETWORK_ERROR`

After loss:
- local execution count: **1**
- side-effect count: **1**
- pending journal entries: **1**

Recovery with a fresh worker:
- local MCP executions: **0**
- journal replayed the persisted completion
- pending journal entries after ACK: **0**
- side-effect count remained **1**

**PASS**

This validates the Desktop journal boundary for:
`local result known → Cloud ACK uncertain`.

## F5 — SIGKILL after Runtime terminal receipt, before Desktop journal

Injected exact window:
1. Runtime executes the consequential append
2. Runtime commits its durable terminal replay receipt
3. result returns to the Host-like child
4. Desktop completion journal is still empty
5. parent sends **SIGKILL**

Before kill:
- side-effect count: **1**
- Desktop completion journal entries: **0**

Recovery:
- fresh worker receives the same durable call
- it re-enters local MCP once because no Desktop journal exists
- Runtime durable replay returns the prior terminal result
- append is **not** repeated
- Desktop completes Cloud persistence
- pending completion journal after recovery: **0**

**PASS**

This proves the two-layer model:

```text
Runtime durable replay receipt
  protects post-side-effect / pre-Desktop-journal crash

Desktop completion journal
  protects post-local-result / pre-Cloud-ACK uncertainty
```

## Acceptance summary

```text
lost durable calls            0
duplicate side effects        0
false Ready observed          0
production Runtime task loss  0
```

All F1–F5 lanes passed in one final run.

## Still open

This closes only the **isolated Cloud MCP F1–F5 integration lanes**.

Still separate:
- packaged-executable variants of these fault lanes
- Tunnel process exit/reconnect
- Tunnel half-open / false-green health
- OS/network loss + recovery
- sleep/wake
- credential rotation/revocation
- combined multi-fault scenarios
- signed/notarized install/update/rollback

The existing 100-cycle packaged Connectivity Host restart soak remains valid
and was not repeated.
