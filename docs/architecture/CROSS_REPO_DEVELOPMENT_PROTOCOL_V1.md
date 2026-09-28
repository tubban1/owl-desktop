# OWL Cross-Repo Development Protocol v1

Status: **Normative**.

This protocol governs parallel development across:

- owl-runtime
- owl-desktop
- owl-cloud
- owl-worker

Research repositories such as owl_lab may propose ideas but do not define production contracts.

## 1. Single Owner

Every canonical domain has exactly one owning repo.

| Domain | Canonical owner |
| --- | --- |
| Runtime Task / Process / Schedule / Verification / execution Approval / Health | owl-runtime |
| MCP compatibility / local Control / Tunnel client / Cloud Bridge / packaging | owl-desktop |
| Account / Organization / Device / Grant / RemoteCommand / Cloud projection | owl-cloud |
| Worker UX / Worker product model / billing UX | owl-worker |

A consumer may cache or project state but may not create a second canonical state machine.

## 2. Contract First

Any cross-repo behavior starts with a versioned contract.

Implementation may proceed in parallel only after the producer and consumer agree on:

- semantics
- IDs
- lifecycle
- errors
- idempotency
- compatibility
- acceptance tests

Mocks are allowed before implementation if they conform to the frozen contract.

## 3. No Source Imports

Cross-repo dependencies use public APIs/SDKs/contracts only.

Forbidden examples:

```text
owl-desktop → owl-runtime/src/**
owl-worker  → owl-cloud/internal/**
owl-cloud   → local Runtime state files
```

## 4. No Duplication

If a canonical owner lacks required generic behavior, create a Contract Request.

Do not temporarily ship a second production implementation of:

- Task engine
- Process ownership
- Scheduler
- Verifier
- Approval enforcement
- Workspace lease management
- Device grant authority
- RemoteCommand persistence

## 5. State Is Owned

Only the owning repo may mutate canonical durable state.

Cloud cannot edit local Runtime stores.

Desktop cannot rewrite Cloud DB rows directly.

Worker cannot fabricate Runtime terminal state.

## 6. API over DB

Cross-component integration uses APIs/events.

No product client receives direct database write access as a substitute for an API contract.

## 7. Stable IDs

Platform IDs are opaque.

Do not infer semantics from string format.

Canonical identifiers and ownership are defined by owl-cloud's Platform Identity Contract and owl-runtime's public contract.

## 8. Delivery and Idempotency

Cloud/event delivery may be at least once.

Consequential consumers must deduplicate by stable command/event/request identity.

A timeout does not prove a side effect did not happen.

## 9. No Silent Fallback

A consumer may support explicit legacy rollback/backends during migration.

It must never silently re-execute an `uncertain` Runtime action through a different backend.

## 10. Semantic Versioning

Within a contract major:

- minor releases may add compatible fields/operations
- consumers ignore unknown additive fields where specified
- existing semantics do not silently change

Breaking behavior requires a new major contract.

## 11. Consumer-Driven Tests

Provider repo owns conformance tests.

Consumer repo owns compatibility tests.

A supported integration requires both.

## 12. Compatibility Matrix

OWL Desktop publishes the tested local combination:

```text
Desktop version
↔ Runtime API
↔ Cloud API
↔ Tunnel protocol
```

OWL Worker publishes its tested Cloud/Runtime projection compatibility separately.

## 13. Contract Request Workflow

A missing cross-repo capability is filed in its canonical owner.

Required information:

- requesting repo
- blocking use case
- missing generic semantics
- requested contract
- acceptance test
- compatibility impact
- desired release window

Do not bypass the owner because another repo can implement something faster.

## 14. Integration Gate

```text
Contract Freeze
→ Provider Conformance
→ Consumer Compatibility
→ Local E2E
→ Cloud E2E
→ Dogfood
→ Soak
→ Production
```

No stage may claim the next stage's evidence.

## 15. Repo / Session Ownership

One development Session should modify one repo by default.

Cross-repo work is allowed only when the task is explicitly coordination/contract work.

When another Session has uncommitted changes:

- use a separate worktree/branch
- do not overwrite the working tree
- do not bundle unrelated changes into a commit

## 16. Integration Authorities

There is no single monolithic integration authority.

- owl-runtime is execution authority
- owl-cloud is identity/control authority
- owl-desktop is local product integration host
- owl-worker is optional product UX

The final shipped local integration is assembled by OWL Desktop, not by making Runtime depend on every product layer.
