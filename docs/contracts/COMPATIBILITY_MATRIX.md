# OWL Compatibility Matrix

Status: **I7 CLOSED — exact tested development set**.

This file is the canonical compatibility record published by OWL Desktop. Compatibility is defined by exact tested contracts and revisions, not by "latest".

## Tested set — 2026-09-30

| Component | Product / contract identity | Minimum supported | Maximum tested | Preferred / exact tested baseline |
| --- | --- | --- | --- | --- |
| OWL Desktop | 0.1.0 development line | 0.1.0 | 0.1.0 | main `6c7e714` |
| OWL MCP | Desktop-owned Streamable HTTP adapter | MCP Streamable HTTP v1 | MCP Streamable HTTP v1 | Desktop `6c7e714` |
| OWL Runtime | public Runtime HTTP/RPC API | API `0.1` | API `0.1` | integration SHA `b841815`; implementation reports `1.0.0-rc.4` |
| Runtime access | local execution lease | access contract v1 | access contract v1 | `LOCKED / READY / REVOKED` on `b841815` |
| Runtime detached Task | durable long-task execution | `tasks.start` + progress v1 | same | `b841815` |
| Runtime consequential replay | side-effect dedupe | idempotency v1 | same | `b841815` |
| OWL Cloud | HTTP API v1 / Account Access v1 | API v1 | API v1 | source head `1d556aa`; Frankfurt dev live |
| RemoteCommand | versioned command registry | `runtime.task.create@1` | `runtime.task.create-and-start@1` tested | both @1 |
| ApprovalDecision | authenticated human decision delivery | v1 | v1 | Cloud `1d556aa` + Desktop `6c7e714` + Runtime `b841815` |
| OWL Tunnel | `owl-tunnel-consumer-v1` / Streamable HTTP v1 | vendor 0.0.15 | vendor 0.0.15 | vendor git `a390c168ff1b2d14e73a95991c186c6aba3ff5a0` |
| OWL Tunnel arm64 | runtime binary | 0.0.15 | 0.0.15 | SHA256 `fcc8e40de0606b8909c7ee44a0816d33d616949389ff37938e2657c7a2333025` |
| OWL Tunnel x64 | runtime binary | 0.0.15 | 0.0.15 | SHA256 `e17ffc98dce25a31c22714875267eeb309abdb35bea450c5801272317559f033` |
| OWL LAB Helper | macOS native capability | bundle `fan.fde.owl.helper` / 1.0.0 | 1.0.0 | Runtime `b841815`; legacy Computer MCP Helper path is compatibility-only fallback |
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

## Evidence

I2–I6 integration evidence is recorded in `docs/integration/LOCAL_E2E_STATUS.md`.

Current closure evidence includes:

- Desktop release-component rebuild from an empty local Tunnel vendor directory;
- official pinned Tunnel arm64+x64 artifacts reconstructed and SHA-verified;
- Desktop 87/87 full tests before I7, plus I7 compatibility/CloudBridge targeted 20/20;
- Desktop production build;
- Cloud typecheck;
- Cloud 52/52 tests under native arm64 Node 22;
- Cloud schema verification: 10 tables plus access-control/command/approval/observability constraints/indexes;
- I4 Cloud → Desktop → Runtime terminal projection;
- I5 approve/deny exact Runtime receipt semantics;
- I6 actual Cloud transport outage and reconnect with Runtime completing offline.

## Production rule

Before OWL LAB Product 1.0 promotion, a shipped combination must preserve this exact information in release evidence:

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
