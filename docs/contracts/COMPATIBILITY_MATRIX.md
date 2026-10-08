# OWL Compatibility Matrix

Status: **I7 CLOSED — exact tested development set**.

This file is the canonical compatibility record published by OWL Desktop. Compatibility is defined by exact tested contracts and revisions, not by "latest".

## Current local 1.1 baseline — 2026-10-07

This is the active local release-integration baseline after Reliability P0.2.
It supersedes the 2026-10-01 Runtime component pin for new local release
assembly, while the older tested set remains below as historical RC evidence.

| Component | Current local baseline | Evidence status |
| --- | --- | --- |
| OWL Desktop | code baseline `940622f6b6fb985495f3bba825347035e7168442` | P0.3 first-run readiness onboarding + P0.2 reliability closure; local main ahead of origin |
| OWL Runtime | release component `45749cfb72223915e86f8f1ed30604cd1c386d84`, version `1.0.0-rc.4`, API `0.1` | P0.2 lifecycle/error/resource fixes, managed-process admission fail-fast, encrypted replay-retention compaction, bounded managed-browser profile storage and process-output argument clamping |
| OWL Cloud | main `9cd8f291e3dc5183e2e4504bd4a2bd5050c32b4b` | source head recorded; Cloud release compatibility must be re-verified before 1.1 RC |
| OWL Tunnel | vendor `0.0.15`, git `a390c168ff1b2d14e73a95991c186c6aba3ff5a0` | existing signed component contract unchanged |
| Runtime Host | bundle `fan.fde.owl.runtime@1.0.0` | rebuilt from the active Runtime component pin |
| OWL LAB Helper | bundle `fan.fde.owl.helper@1.0.0` | rebuilt from the active Runtime component pin |

Important publication boundary:

- the active Runtime component pin is `45749cfb72223915e86f8f1ed30604cd1c386d84`;
- that Runtime commit is currently local-only because Git push remains disabled;
- local Desktop release assembly may use the exact sibling Runtime checkout;
- clean-machine/CI reproducibility remains blocked until that exact Runtime Git object is published to the canonical repository;
- do not fall back to the older `4e24c19` pin merely because it is remotely fetchable.

## Historical tested set — 2026-10-01

| Component | Product / contract identity | Minimum supported | Maximum tested | Preferred / exact tested baseline |
| --- | --- | --- | --- | --- |
| OWL Desktop | 0.1.0 release-candidate line | 0.1.0 | 0.1.0 | release assembly `27f6c3e` |
| OWL MCP | Desktop-owned Streamable HTTP adapter | MCP Streamable HTTP v1 | MCP Streamable HTTP v1 | Desktop `27f6c3e` |
| OWL Runtime | public Runtime HTTP/RPC API | API `0.1` | API `0.1` | main `4e24c19`; implementation reports `1.0.0-rc.4` |
| Runtime access | local execution lease | access contract v1 | access contract v1 | `LOCKED / READY / REVOKED` on `4e24c19` |
| Runtime detached Task | durable long-task execution | `tasks.start` + progress v1 | same | `4e24c19` |
| Runtime consequential replay | side-effect dedupe | idempotency v1 | same | `4e24c19` |
| OWL Cloud | HTTP API v1 / Account Access v1 | API v1 | API v1 | source head `1d556aa`; Frankfurt dev live |
| RemoteCommand | versioned command registry | `runtime.task.create@1` | `runtime.task.create-and-start@1` tested | both @1 |
| ApprovalDecision | authenticated human decision delivery | v1 | v1 | Cloud `1d556aa` + Desktop `27f6c3e` + Runtime `4e24c19` |
| OWL Tunnel | `owl-tunnel-consumer-v1` / Streamable HTTP v1 | vendor 0.0.15 | vendor 0.0.15 | vendor git `a390c168ff1b2d14e73a95991c186c6aba3ff5a0` |
| OWL Tunnel arm64 | runtime binary | 0.0.15 | 0.0.15 | SHA256 `fcc8e40de0606b8909c7ee44a0816d33d616949389ff37938e2657c7a2333025` |
| OWL Tunnel x64 | runtime binary | 0.0.15 | 0.0.15 | SHA256 `e17ffc98dce25a31c22714875267eeb309abdb35bea450c5801272317559f033` |
| OWL LAB Helper | macOS native capability | bundle `fan.fde.owl.helper` / 1.0.0 | 1.0.0 | Runtime main `4e24c19`; legacy Computer MCP Helper path is compatibility-only fallback |
| Runtime Host | macOS host | bundle `fan.fde.owl.runtime` / 1.0.0 | 1.0.0 | 1.0.0 |
| OWL Worker | hosted Worker UX | not required for I2–I7 | not claimed | migration surface; product ownership moves under OWL Cloud |

## Frankfurt dev identity

Live provider checks on 2026-09-30:

~~~text
AWS region:
eu-central-1

CloudFormation stack:
OwlCloudDevStack

Lambda:
owl-dev-api

Runtime:
nodejs22.x / arm64

Lambda CodeSha256:
/Ejj+tqILWKna66q2PbYvYkxRXdWFAfvNVEFQH2mXq8=

LastModified:
2026-09-30T16:23:41.000+0000
~~~

Live HTTP read-back also confirmed:

- Cognito Authorization Code + PKCE S256 discovery;
- callback `owl-desktop://auth/callback`;
- `runtime.task.create@1`;
- `runtime.task.create-and-start@1`;
- ApprovalDecision device route is deployed and authentication-protected.

## Fail-closed compatibility behavior

Unsupported combinations are rejected before consequential Runtime work begins:

1. Desktop Cloud Bridge calls Runtime `info` before command polling and requires exact public API `0.1`.
2. A Runtime API mismatch returns `RUNTIME_API_INCOMPATIBLE` and Cloud Bridge remains stopped.
3. RemoteCommand kinds and versions are checked against `OWL_COMPATIBILITY_V1`; an unsupported kind/version is rejected without calling Runtime.
4. Runtime remains the idempotency/approval/execution authority after compatibility acceptance.
5. Skill Manager independently rejects higher unsupported Primitive ABI requirements.
6. Tunnel release preparation verifies protocol identity, architecture, version, vendor git SHA and executable SHA256 before packaging.
7. Runtime, Runtime Host and OWL LAB Helper release assembly is pinned to the exact SHA in `OWL_RUNTIME_COMPONENT_V1.json`. The active local 1.1 pin is `45749cfb72223915e86f8f1ed30604cd1c386d84`; a clean checkout may fetch only that exact Git object and must fail closed while it remains unpublished.
8. Signed release configuration is verified for the canonical `OWL LAB Desktop` name, Helper inclusion and mandatory notarization.

## Evidence

I2–I6 integration evidence is recorded in `docs/integration/LOCAL_E2E_STATUS.md`.

Current closure evidence includes:

- Desktop release-component rebuild from an empty local Tunnel vendor directory;
- official pinned Tunnel arm64+x64 artifacts reconstructed and SHA-verified;
- canonical Runtime, Runtime Host and Helper rebuilt successfully from pinned Git SHA without relying on a sibling Runtime checkout;
- unsigned arm64+x64 Desktop smoke packages verified with universal Runtime Host and universal OWL LAB Helper embedded;
- Desktop current source gate 23/23 test files and 116/116 tests, plus TypeScript/Vite production build and durable-submit verification;
- Desktop production build;
- Cloud typecheck;
- Cloud 52/52 tests under native arm64 Node 22;
- Cloud schema verification: 10 tables plus access-control/command/approval/observability constraints/indexes;
- I4 Cloud → Desktop → Runtime terminal projection;
- I5 approve/deny exact Runtime receipt semantics;
- I6 actual Cloud transport outage and reconnect with Runtime completing offline;
- historical 0.1.0 RC Runtime pin `4e24c19fef12704eb5fe97c1283a3d8c32a4df4c` remains preserved in its release evidence; Reliability P0.2 closed at `893a5a98f159ce98212dd728afabd8889630d26e`; managed-start self-dogfood fix landed at `125c8faf1bbc0fc9e7489af2e376836fba8db3f6`; encrypted replay-retention compaction landed at `edad5221302d098238b332aa15b44e240c6d8375`; current 1.1 local release staging enforces `45749cfb72223915e86f8f1ed30604cd1c386d84`;
- reproducible OWL macOS icon generation and packaged `icon.icns`;
- universal Runtime Host `fan.fde.owl.runtime@1.0.0` built as arm64+x86_64;
- unsigned arm64 and x64 `.app` smoke packages verified with `npm run verify:packaged-smoke`;
- arm64 and x64 DMG/ZIP/blockmap installer artifacts generated;
- `hdiutil verify` reports both DMG checksums VALID.

## Production rule

Before OWL LAB Product 1.1 promotion, a shipped combination must preserve this exact information in release evidence:

- product/component version;
- Git SHA or deployment revision;
- contract/API version;
- minimum supported dependency;
- maximum tested dependency;
- preferred dependency;
- native artifact SHA/signing identity;
- signed/notarized artifact result;
- clean-install dogfood and soak evidence.

A combination not present in this matrix or its release successor is **not** a supported production combination.
