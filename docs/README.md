# OWL LAB Desktop Documentation

This directory is the canonical product and integration documentation for OWL LAB Desktop.

## Start here

### Current friend-beta / dogfood

- [Friend Beta Findings](operations/FRIEND_BETA_FINDINGS_2026-10-01.md) — real-install problems, release blockers and optimization order.
- [Friend Beta Test Plan](operations/FRIEND_BETA_TEST_PLAN_V1.md) — automated, owner-assisted and clean-Mac test matrix.
- [Installation, Onboarding and Recovery V1](operations/ONBOARDING_AND_RECOVERY_V1.md) — target zero-config installation and recovery UX.
- [Friend Beta Testing](operations/FRIEND_BETA_TESTING.md) — current beta status and tester instructions.

### Architecture and integration

- `architecture/` — Desktop-owned architecture.
- `integration/` — cross-repo integration and contract work.
- `contracts/` — Desktop consumer contracts and requests.
- `platform/` — product/platform-wide decisions visible from Desktop.

### Product areas

- [Conversation Continuity V1](product/CONVERSATION_CONTINUITY_V1.md) — cross-Chat Planner Handoff, Resume Capsule and authority boundaries.
- [OWL LAB 1.1 Continuity Plan](roadmap/OWL_LAB_1_1_CONTINUITY_PLAN.md) — serialized implementation order and 1.1 release gate.
- `skills/` — Skill Manager and User Skill product behavior.
- `release/` — packaging/release evidence.
- `roadmap/` — Desktop roadmap.
- `operations/` — install, recovery, testing and support operations.

## Legacy Computer MCP documentation

The old Computer MCP / AgentOS documentation has **not been deleted**.

It remains at:

```text
../computer-mcp/docs
```

OWL LAB split the old monolith into several repositories, so legacy documents must now be assigned to their canonical owner instead of copied wholesale.

See:

- [Legacy Computer MCP Documentation Migration](platform/LEGACY_COMPUTER_MCP_DOCUMENT_MIGRATION.md)

That index records whether each old document belongs to Desktop, Runtime, Cloud, platform/archive, and which concepts are being carried forward.

## Documentation ownership rule

```text
OWL Desktop
= product UX
= local control plane
= onboarding / settings / diagnostics
= ChatGPT/Tunnel consumer lifecycle
= permission and local-secret UX

OWL Runtime
= execution authority
= task/scheduler/staging
= Primitive / Skill ABI
= policy / approval truth
= verification / durable state / concurrency

OWL Cloud
= identity / organization / device
= remote command and approval relay
= remote control plane / fleet

computer-mcp
= frozen legacy reference during migration
```

Do not duplicate a canonical Runtime or Cloud capability in Desktop just to make documentation convenient. Link to the owning contract instead.

## Development and dogfood rule

Use the installed friend-beta RC as the real black-box product while using OWL LAB itself to modify the source repository.

```text
installed RC → observe real behavior
source repo  → implement fix
tests        → verify fix in source
next RC      → prove fix in packaged product
```

Desktop Commander or another external control path is only a rescue channel when OWL itself is unavailable. It is not the normal development path.
