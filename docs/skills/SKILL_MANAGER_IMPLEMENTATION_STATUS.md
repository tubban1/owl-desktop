# Skill Manager implementation status

Status: **Phase A implemented on Desktop**
Runtime baseline: **1.0.0-rc.4 / API 0.1**

## Implemented

- first-level **Skills** navigation;
- `SkillManagerPort` renderer boundary;
- Desktop main-process Runtime adapter;
- real `skills.catalog` integration;
- real `primitives.catalog` integration;
- real `capabilities.get` integration;
- real `skill.run { dryRun: true }`;
- real `skill.run` execution;
- built-in Skill detail:
  - version;
  - Primitive ABI;
  - required Primitives;
  - execution mode;
  - memory policy;
  - risk;
  - side effects;
  - idempotency;
  - retry policy;
  - verification;
  - resources;
  - input contract;
- Provider status presentation;
- explicit Runtime authority messaging;
- side-effect confirmation before Desktop submits a real Run;
- Runtime Approval/errors pass through unchanged;
- lifecycle buttons are visible but disabled when unsupported;
- Candidates and Library empty states explicitly identify the Runtime 1.x dependency.

## Availability semantics

Runtime 1.0 exposes Skill ABI metadata, Primitive catalog and provider status, but it does not expose a canonical per-Skill availability projection.

Desktop therefore reports:

- `ABI ready` when required Primitive ABI and required Primitive IDs are present;
- `incompatible` for a higher required Primitive ABI;
- `missing_capability` for missing required Primitive IDs.

Provider state is displayed separately.

Desktop does **not** invent a Skill-to-Provider dependency map or claim that ABI readiness proves the Skill is currently runnable.

Canonical availability remains part of CR-DESKTOP-009.

## Runtime 1.x lifecycle boundary

The following remain intentionally unavailable as production actions:

- install;
- enable / disable;
- update;
- rollback;
- uninstall;
- candidate list/detail/test/promotion/dismissal;
- Cloud Library install.

Desktop does not write a local executable Skill Registry.

## Live evidence

Validated against the local Runtime:

- 23 built-in Skills returned by `skills.catalog`;
- Primitive ABI 1;
- 27 Primitive catalog entries;
- provider status returned through `capabilities.get`;
- `runtime.identity` Dry Run returned Runtime's canonical dry-run plan.

## Tests

Desktop unit suite includes `skill-manager-port.test.mjs` covering:

- Runtime catalog → Desktop view-model mapping;
- missing Primitive compatibility;
- higher Primitive ABI incompatibility;
- Dry Run forwarding;
- real Run forwarding;
- lifecycle state remaining non-canonical/unavailable.
