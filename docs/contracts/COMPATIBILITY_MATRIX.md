# OWL Compatibility Matrix

Status: **Integration closure / exact tested baselines**.

This file is the canonical local compatibility record published by OWL Desktop.

## Current tested development baseline

| Component | Current role | Tested baseline |
| --- | --- | --- |
| OWL Desktop | local integration host | consumer code SHA `dc43a07e48b4013a87a3ca922726bbcf29e78b65`; 0.1.0 development line; arm64+x64 packaging smoke |
| OWL MCP | Desktop-owned ChatGPT/MCP adapter | Desktop SHA `dc43a07e48b4013a87a3ca922726bbcf29e78b65`; Streamable HTTP; Local E2E Gate 3 complete |
| OWL Runtime | execution authority | API 0.1; 1.x integration provider SHA `852fdb4eb7595800eb1c3e64e822b15cf5528ef6`; implementation currently reports `1.0.0-rc.4` |
| Runtime User Skill extension | Candidate / Registry / Discovery | contained in provider SHA `852fdb4eb7595800eb1c3e64e822b15cf5528ef6`; User Skill + Workflow Discovery live accepted |
| Runtime Public Event + AgentRequest extension | durable coordination producer | contained in provider SHA `852fdb4eb7595800eb1c3e64e822b15cf5528ef6`; `events.list` + explicit retention-gap reconciliation live accepted |
| Runtime detached Task extension | long-task execution / truthful progress | contained in provider SHA `852fdb4eb7595800eb1c3e64e822b15cf5528ef6`; `tasks.start` + Task progress projection; Desktop MCP `task_start/task_status` live accepted |
| Runtime consequential replay | duplicate side-effect protection | contained in provider SHA `852fdb4eb7595800eb1c3e64e822b15cf5528ef6`; Desktop stable replay-key handoff live fault-injection accepted |
| OWL Cloud | control authority | HTTP API v1 / Account Access v1; Desktop M1 bridge exists; I3 login/device-access integration is next |
| OWL Tunnel | transport | compatibility binary 0.0.15 arm64; formal x64/protocol artifact pending |
| OWL Helper | macOS native capability | stable identity required |
| Runtime Host | macOS production host | bundle `fan.fde.owl.runtime` / 1.0.0; current dev artifact x64 ad-hoc; signed universal artifact pending |
| OWL Worker | hosted Worker UX | migration source; long-term product surface moves under OWL Cloud; not required for I2/I3 |

## I2 acceptance evidence

Exact tested pair:

~~~text
Desktop consumer code:
dc43a07e48b4013a87a3ca922726bbcf29e78b65

Runtime provider:
852fdb4eb7595800eb1c3e64e822b15cf5528ef6
~~~

Passed:

- Desktop 74/74 unit/integration tests;
- Desktop production build;
- Desktop-owned MCP read-only Local E2E;
- stable logical owner reconnect;
- live detached 2.2-second Task with 43 ms start acceptance and monotonic progress;
- consequential response-loss fault injection;
- exact same-transport replay returned canonical prior response;
- fresh MCP transports receive fresh default replay scope, preventing stale replay under reused JSON-RPC IDs;
- explicit client idempotency keys remain stable across transports when intentional;
- non-idempotent append side effect executed exactly once.

## Compatibility rule

Compatibility is defined by exact tested component revisions, not by a claim of supporting "latest".

The Runtime currently retains `runtimeVersion=1.0.0-rc.4` while 1.x integration work is carried on top of the frozen rc.4 execution baseline. Until Runtime 1.1 version metadata is promoted, consumers must use the exact provider SHA above to distinguish the 1.x integration surface from the frozen 1.0 baseline.

## Production rule

Before OWL LAB Product 1.0 production, every shipped combination must record:

- exact product/component version;
- Git SHA / deployment revision;
- contract/API version;
- minimum supported dependency;
- maximum tested dependency;
- preferred dependency;
- native artifact fingerprint/signing identity where applicable.

A combination not recorded here (or in the release replacement for this matrix) is not claimed as a supported production combination.
