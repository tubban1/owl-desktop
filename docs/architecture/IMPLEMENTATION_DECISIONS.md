# OWL Desktop Implementation Decisions

Status: **Active engineering baseline**.

## Desktop shell

Phase 1 uses **Electron + React + TypeScript**.

Reason: the current macOS development machine already has the Node toolchain while Rust/Cargo are not installed. Electron lets us begin product integration immediately without coupling OWL Runtime to the UI framework.

The shell is replaceable. Runtime, Cloud and MCP boundaries remain protocol-driven so a future Tauri/native shell does not require execution-layer rewrites.

## Security boundary

Renderer:
- has no Node.js integration
- cannot read Runtime tokens or stored secret values
- receives only explicit IPC projections

Electron main:
- owns Runtime HTTP connectivity
- owns local settings
- owns OS-encrypted secret persistence
- owns app lifecycle and future Helper/Tunnel supervision

Secret storage fails closed when Electron safeStorage is unavailable. There is no plaintext fallback.

## Runtime boundary

Desktop talks to Runtime through the public HTTP RuntimeClient contract at loopback.

Default development endpoint:

```text
http://127.0.0.1:8788
```

Stable logical session identity is persisted by Desktop and reused across reconnects.

Desktop does not import `owl-runtime/src/**` and does not read Runtime state files.

## Current UI slices

- Overview / usage summary
- Sessions
- Live Logs
- Runtime health + compatibility
- Secret Vault
- Settings

Where Runtime lacks a canonical projection, the UI says so and the missing surface is tracked in `DESKTOP_RUNTIME_CONTRACT_REQUESTS.md`.

## Side-by-side migration

During migration, legacy Computer MCP / AgentOS production may remain on port 8787 while OWL Runtime development uses 8788.

Desktop never probes an alternate backend after an error. The configured endpoint is explicit and a failed connection remains visible as Offline.

Before OWL Desktop production packaging, the Runtime Host contract must define endpoint discovery/allocation so Desktop does not depend on a hard-coded production port.
