# OWL LAB State & Evidence UX

Status: product requirement discovered during friend-beta dogfood.

## Dogfood rule

The default development/test path for OWL LAB must be OWL LAB itself:

```text
ChatGPT
→ OWL Tunnel
→ OWL MCP
→ OWL Runtime DEV during implementation
→ repository mutation / tests / tasks
→ packaged OWL Runtime RC only at release checkpoints
```

Desktop Commander is a recovery-sidecar only. Use it when OWL LAB itself is unavailable
or when inspecting process state outside current Runtime policy roots. Do not make it the
normal execution path, otherwise friend-beta does not test the real product.

## Current state fragmentation

Legacy Computer MCP persisted most operational state below `~/.computer-mcp`,
including tasks, staging, processes/logs, episodes, semantic state, schedules,
skill candidates, transactions, workspace leases, loops, user skills, browser state,
credentials, secrets, logs, onboarding and WeChat sessions.

OWL LAB storage layout V1 now gives Desktop one canonical product namespace:

- `~/Library/Application Support/OWL LAB/desktop` — Desktop durable UI/control-plane state
- `~/Library/Application Support/OWL LAB/staging` — Runtime task staging/artifacts
- `~/Library/Application Support/OWL LAB/logs` — product logs, with Desktop under `logs/desktop`
- `~/Library/Application Support/OWL LAB/cache` — reclaimable Desktop/session cache
- `~/Library/Application Support/OWL LAB/diagnostics` — diagnostic/crash export workspace
- `~/.owl-runtime` — canonical production Runtime state; intentionally not migrated in the Desktop V1 change
- `~/.owl-runtime-dev` — isolated Runtime DEV state
- `~/.owl/releases` — immutable packaged Runtime releases and rollback material

The historical Desktop namespace `~/Library/Application Support/@owl-platform/desktop`
is compatibility input only. Desktop copies known owned state into the new
`OWL LAB/desktop` root without deleting the source, never overwrites an existing
destination file, and writes `desktop/migrations/storage-layout-v1.json` as evidence.

## Product requirement: one logical OWL state model

Runtime remains canonical owner of execution state, but Desktop must present a unified view:

```text
Work
├─ Tasks
├─ Runs
├─ Processes
├─ Approvals
├─ Schedules
├─ Loops
└─ Artifacts

History
├─ Events
├─ Errors
├─ Audit
└─ Recoveries

Skills
├─ Installed skills
├─ User skills
└─ Skill candidates

Advanced
├─ Runtime state
├─ Logs
├─ Replay / idempotency
├─ Workspace leases
├─ Storage usage
└─ Export diagnostics
```

Users should not need to know which physical directory stores each record.

## Product-owned storage is not an Allowed Folder

`~/Library/Application Support/OWL LAB` is application-owned internal storage, not a normal user workspace. Do not add the whole product root to the default `ALLOWED_DIRECTORIES` list just so generic agent filesystem tools can inspect it.

Boundaries:

- user work roots such as Desktop/Documents/Downloads and explicit selections → Runtime filesystem policy;
- Runtime-owned task staging → the existing narrow Runtime-owned filesystem exception;
- Desktop state/log/cache/diagnostics → Desktop-owned internal access and dedicated product projections;
- canonical Runtime state → Runtime APIs, never direct Desktop mutation.

This keeps product internals separate from normal agent workspace permissions while still allowing OWL LAB itself to manage and surface its own state.

## Migration rule

Do not delete or overwrite `~/.computer-mcp` until migration is explicit and verified.
The next OWL migration step should:

1. inventory legacy state by type and size;
2. classify each type as migrate / archive / discard / unsupported;
3. import compatible durable tasks, schedules, skills, loops and history where safe;
4. keep legacy evidence read-only until migration completes;
5. expose a Desktop migration report;
6. provide explicit cleanup only after verification.

## Storage lifecycle

The product storage contract distinguishes:

- canonical durable state — retained until user deletes it;
- task evidence/artifacts — retained by configurable TTL;
- logs — rotate by size/age;
- cache/browser profiles — bounded and reclaimable;
- request replay/idempotency — bounded retention;
- releases — keep current + rollback versions;
- diagnostics exports — explicit user action.

Desktop should show storage usage and cleanup controls rather than allowing hidden state
folders to grow indefinitely.
