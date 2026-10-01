# OWL LAB State & Evidence UX

Status: product requirement discovered during friend-beta dogfood.

## Dogfood rule

The default development/test path for OWL LAB must be OWL LAB itself:

```text
ChatGPT
→ OWL Tunnel
→ OWL MCP
→ packaged OWL Runtime RC
→ repository mutation / tests / tasks
```

Desktop Commander is a recovery-sidecar only. Use it when OWL LAB itself is unavailable
or when inspecting process state outside current Runtime policy roots. Do not make it the
normal execution path, otherwise friend-beta does not test the real product.

## Current state fragmentation

Legacy Computer MCP persisted most operational state below `~/.computer-mcp`,
including tasks, staging, processes/logs, episodes, semantic state, schedules,
skill candidates, transactions, workspace leases, loops, user skills, browser state,
credentials, secrets, logs, onboarding and WeChat sessions.

OWL LAB currently distributes state across:

- `~/.owl-runtime` — canonical Runtime state
- `~/Library/Application Support/OWL LAB/staging` — Runtime task staging/artifacts
- `~/.owl/logs` — packaged Runtime service logs
- `~/.owl/releases` — immutable packaged Runtime releases
- `~/Library/Application Support/@owl-platform/desktop` — Desktop/Electron state

This is technically valid but not product-visible enough.

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

The new product must distinguish:

- canonical durable state — retained until user deletes it;
- task evidence/artifacts — retained by configurable TTL;
- logs — rotate by size/age;
- cache/browser profiles — bounded and reclaimable;
- request replay/idempotency — bounded retention;
- releases — keep current + rollback versions;
- diagnostics exports — explicit user action.

Desktop should show storage usage and cleanup controls rather than allowing hidden state
folders to grow indefinitely.
