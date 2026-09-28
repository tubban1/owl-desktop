# OWL Platform Integration Gates v1

Status: **Normative release coordination**.

This document defines how independently developed OWL repositories become one supported platform combination.

No single repository owns all semantics. Integration succeeds only when each authority passes its own conformance and the product boundary passes cross-repo E2E.

## Gate 0 — Contract Freeze

Required artifacts:

- Runtime Provider Contract v1 — owl-runtime
- Runtime Consumer Contract v1 — owl-desktop
- Cloud Control Contract v1 — owl-cloud
- Cloud Bridge Contract v1 — owl-desktop
- Platform Identity Contract v1 — owl-cloud
- Event Envelope v1 — owl-cloud
- Worker Consumer Contract v1 — owl-worker
- Cross-Repo Development Protocol v1 — owl-desktop

No production integration begins with an undefined lifecycle or ID.

## Gate 1 — Provider Conformance

### OWL Runtime

Must prove its own public execution contract:

- RuntimeClient/API
- Task/Process/Schedule
- ownership/cancellation
- Observation/Verifier
- Approval
- Health/Diagnostics
- ExecutionTarget

Owner: **owl-runtime**.

### OWL Cloud

Must prove:

- login/session
- Account/Organization
- Device registration
- DeviceGrant
- RemoteCommand
- idempotent command delivery
- Event Envelope
- projection ingestion

Owner: **owl-cloud**.

## Gate 2 — Consumer Compatibility

### OWL Desktop ↔ Runtime

Desktop tests against the minimum and preferred Runtime API versions.

Must not import Runtime source or state.

Owner: **owl-desktop**.

### OWL Desktop ↔ Cloud

Cloud Bridge tests authentication, reconnect, command dedupe, acceptance/rejection, and projection sync.

Owner: **owl-desktop** with Cloud conformance fixtures from **owl-cloud**.

### OWL Worker ↔ Cloud

Worker tests shared login, Device/Grant visibility, RunProjection, ApprovalDecision, and product entitlements.

Owner: **owl-worker**.

Worker is not required for Local E2E.

## Gate 3 — Local E2E

Canonical path:

```text
ChatGPT
→ OWL MCP
→ OWL Desktop
→ RuntimeClient
→ OWL Runtime
→ Provider
```

Minimum acceptance scenario:

1. ChatGPT requests a deterministic local action.
2. OWL MCP maps it to public Runtime semantics.
3. Runtime executes it.
4. Runtime verifies the postcondition.
5. result is returned through Desktop/MCP.
6. no duplicate side effect occurs on transport retry.
7. Runtime Task/Process/Lease state is clean afterward.

Integration owner: **owl-desktop**.

Execution truth owner: **owl-runtime**.

## Gate 4 — Cloud E2E

Worker UI is **not required**.

Canonical test path:

```text
Cloud test client
→ OWL Cloud RemoteCommand
→ OWL Desktop Cloud Bridge
→ RuntimeClient
→ OWL Runtime
→ execution result
→ Cloud projection
```

Acceptance:

1. authenticated principal has a valid DeviceGrant;
2. command is persisted by Cloud;
3. device receives command;
4. duplicate delivery of the same commandId does not duplicate execution;
5. Desktop accepts/rejects explicitly;
6. accepted command maps to Runtime execution identity;
7. Runtime result is projected back to Cloud;
8. Cloud projection matches Runtime terminal truth;
9. device disconnect/reconnect does not fabricate failure.

Joint integration owners:

- **owl-cloud** — control plane
- **owl-desktop** — bridge/local acceptance
- **owl-runtime** — execution

## Gate 5 — Approval E2E

Canonical path:

```text
Runtime detects approval requirement
→ Desktop/Cloud projects request
→ Control or Worker records ApprovalDecision
→ Runtime validates exact action/args
→ Runtime issues/consumes Approval Receipt
→ action executes once
```

Acceptance:

- ApprovalDecision alone cannot bypass Runtime policy;
- receipt is scoped, expiring, and consumed correctly;
- duplicate Cloud/UI approval delivery does not duplicate the action;
- denied/expired approval never executes.

Runtime owns enforcement.

Cloud owns principal/decision provenance.

Desktop/Worker own UI.

## Gate 6 — Offline / Reconnect

Acceptance:

- device can be offline while command remains queued;
- reconnect restores device identity;
- pending commands are delivered at least once;
- commandId dedupe prevents duplicate execution;
- existing Runtime work is not lost because Cloud transport disappeared;
- projections reconcile after reconnect.

## Gate 7 — Compatibility Matrix

OWL Desktop publishes the tested release combination.

Required fields:

| Component | Required value |
| --- | --- |
| OWL Desktop | exact version/SHA |
| OWL Runtime | API major/minor + tested version/SHA |
| OWL Cloud | API contract version + deployment revision |
| OWL Tunnel | protocol version |
| OWL Helper | native version / bundle identity |
| Runtime Host | native version / bundle identity |
| Worker | optional tested version |

A combination not in the matrix is not claimed as supported production.

## Gate 8 — Dogfood / Soak / Production

After E2E:

```text
dogfood
→ reconnect/fault injection
→ soak
→ installer/update/rollback
→ production promotion
```

Runtime soak does not substitute for Desktop/Cloud E2E.

Desktop E2E does not substitute for Runtime conformance.

## Failure ownership

When integration fails, fix the canonical owner:

- execution lifecycle bug → owl-runtime
- MCP mapping/package/local UI bug → owl-desktop
- identity/device/command bug → owl-cloud
- Worker UX/product bug → owl-worker

Do not patch around an owner bug in another repo.

## Final integration answer

**OWL Runtime does not unify the platform.**

The production system is integrated through contracts:

```text
OWL Cloud        = control authority
OWL Desktop      = local integration host
OWL Runtime      = execution authority
OWL Worker       = optional product UX
```

OWL Desktop owns the final local compatibility assembly; the platform release gate is cross-repo and contract-driven.
