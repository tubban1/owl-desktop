# OWL Compatibility Matrix

Status: **Initial / pre-2.0**.

This file is the canonical local compatibility record published by OWL Desktop.

## Current development baseline

| Component | Current role | Supported baseline |
| --- | --- | --- |
| OWL Desktop | local integration host | 0.1.0 development line |
| OWL MCP | Desktop-owned ChatGPT/MCP adapter | 0.1.0 / Streamable HTTP / Local E2E verified |
| OWL Runtime | execution authority | API 0.1 tested against 1.0.0-rc.4 |
| OWL Cloud | control authority | Cloud Contract v1 draft/frozen for parallel development |
| OWL Tunnel | transport | legacy Computer MCP transport until versioned OWL Tunnel contract is frozen |
| OWL Helper | macOS native capability | stable identity required |
| Runtime Host | macOS production host | stable identity required |
| OWL Worker | optional SaaS UX | not required for local/cloud E2E |

## Production rule

Before OWL Desktop 2.0 production, replace descriptive entries above with exact:

- version
- Git SHA / deployment revision
- contract/API version
- minimum supported dependency
- maximum tested dependency
- preferred dependency

No component may claim general compatibility with "latest".
