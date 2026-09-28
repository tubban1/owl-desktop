# Runtime Consumer Contract v1

Status: **Normative consumer contract**.

Canonical provider: **owl-runtime**.

OWL Desktop consumes OWL Runtime only through its public RuntimeClient / HTTP contract.

## Allowed dependencies

- published `owl-runtime` public package exports
- Runtime HTTP API
- documented diagnostics/health surfaces
- versioned public contracts

## Forbidden dependencies

- `owl-runtime/src/**`
- direct reads/writes of Runtime state files
- direct mutation of Task/Process/Schedule stores
- copying Runtime Scheduler/Verifier/Approval/Lease logic into Desktop
- silent fallback to a legacy execution backend after uncertain side effects

## Canonical Runtime-owned entities

Desktop treats these as opaque Runtime truth:

- taskId
- processId
- scheduleId
- approvalId
- execution target
- verification result
- execution health
- diagnostics support package

Desktop may cache/display these values but cannot redefine their state machines.

## Stable logical identity

Desktop must provide a stable logical session identity to Runtime. MCP/WebSocket/Tunnel transport session IDs are not durable ownership identities.

## Cancellation

Transport interruption should be mapped to Runtime request cancellation when the user request itself is no longer active.

Cancellation does not prove an external side effect was rolled back.

## Compatibility

Desktop must declare:

- minimum supported Runtime API
- maximum tested Runtime API
- preferred Runtime version

Breaking Runtime changes require a major contract version.
