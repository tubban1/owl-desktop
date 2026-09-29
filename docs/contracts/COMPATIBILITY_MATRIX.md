# OWL Compatibility Matrix

Status: **Initial / pre-2.0**.

This file is the canonical local compatibility record published by OWL Desktop.

## Current development baseline

| Component | Current role | Supported baseline |
| --- | --- | --- |
| OWL Desktop | local integration host | 0.1.0 development line; arm64+x64 packaging smoke |
| OWL MCP | Desktop-owned ChatGPT/MCP adapter | 0.1.0 / Streamable HTTP / Local E2E verified |
| OWL Runtime | execution authority | API 0.1; core tested 1.0.0-rc.4 / SHA 001414f584be |
| Runtime User Skill extension | Candidate/Registry/Discovery | API 0.1 candidate extension; Desktop live accepted SHA 9e36d0dc4ce6b10e792abea8cf8263de2baa4b20 |
| Runtime Public Event + AgentRequest extension | durable coordination producer | API 0.1 candidate extension; Desktop live accepted SHA a44c5d26636c71faf8a8c146ef43e2af71332b11; events.list + explicit retention-gap reconciliation |
| Runtime Consequential Replay extension | mutation replay authority | API 0.1 1.x Integration Closure; Desktop live accepted SHA f00ba4f7f5c3fbddc18cf7c04fc0cfccdbb786bd for Cloud mutation replay and AgentRequest Skill repair |
| OWL Cloud | control authority | HTTP API v1 / Account Access v1; Desktop M1 polling bridge implemented against Frankfurt dev health endpoint |
| OWL Tunnel | transport | compatibility binary 0.0.15 arm64; formal x64/protocol artifact pending |
| OWL Helper | macOS native capability | stable identity required |
| Runtime Host | macOS production host | bundle fan.fde.owl.runtime / 1.0.0; current dev artifact x64 ad-hoc; signed universal artifact pending |
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
