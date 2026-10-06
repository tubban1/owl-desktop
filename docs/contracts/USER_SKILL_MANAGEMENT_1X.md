# User Skill Management Boundary — 1.x

Status: **Future 1.x Desktop boundary only. No OWL Desktop 1.0 implementation is required.**

Upstream execution lifecycle: `owl-runtime/docs/skills/USER_SKILL_LIFECYCLE_V1.md`.

## Desktop role

Desktop is the management and transport surface around User Skills. Runtime remains the authority for what is installed and executable.

Desktop may eventually provide UX for:

- inspect Skill package;
- show required Primitives, risk, side effects and verification;
- request install;
- list installed versions;
- enable/disable;
- request update;
- pin/rollback;
- show provenance and evidence for auto-distilled Skill Candidates;
- download/sync immutable packages from an optional Cloud Skill Library.

## Desktop must not

- edit Runtime Skill Registry files directly;
- mark a Skill installed before Runtime confirms it;
- bypass Runtime ABI/Primitive/risk/verification checks;
- grant permissions because a Skill package requests them;
- silently activate an automatically generated Skill Candidate;
- execute a User Skill outside Runtime governance;
- treat native/code plugins as normal declarative User Skills.

## Candidate flow

A future auto-distilled Skill Candidate may be surfaced by Desktop:

```text
Runtime evidence / procedure candidate
        ↓
Skill Candidate
        ↓
Desktop review UI
        ↓
user confirms
        ↓
Runtime inspect/install
        ↓
Runtime Registry
```

Desktop may explain the evidence and requested capabilities, but installation authority remains Runtime-side.

## Cloud interaction

If Cloud Skill Library exists later:

```text
Cloud immutable package
        ↓
Desktop fetch/cache
        ↓
Runtime inspect
        ↓
Runtime install
```

Cloud package availability never implies local compatibility or permission.

## 1.0 stop line

Do not add Skill Registry APIs, package installation, candidate activation, or Skill sync to OWL Desktop 1.0 solely because the 1.x lifecycle is documented.

The first implementation should wait for a frozen Runtime 1.x declarative Skill Package / Registry contract.
