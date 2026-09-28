# OWL MCP Bridge Contract v1

Status: **Candidate Desktop-owned contract**.

OWL MCP is a compatibility and transport adapter inside OWL Desktop. It is not an execution runtime.

## Canonical path

```text
ChatGPT / MCP Client
  ↓ Streamable HTTP
OWL MCP
  ↓ public RuntimeClient HTTP
OWL Runtime
  ↓
Provider / local environment
```

OWL MCP may translate tool names and request shapes. It must not reproduce Runtime policy, task/process state, scheduler, verification, approval enforcement, workspace ownership, recovery or retry truth.

## Endpoint

Development default:

```text
http://127.0.0.1:8790/mcp
```

The listener binds to loopback. Future OWL Tunnel is responsible for remote transport.

## Logical owner identity

Trusted ingress may send:

```text
x-owl-owner-id: <durable client/conversation identity>
```

OWL MCP hashes this value before using it as the Runtime logical session ID. Raw owner values are not persisted by the adapter.

During migration, `x-computer-mcp-owner-id` is accepted as a compatibility alias.

Without an explicit owner signal, OWL MCP uses the MCP transport session ID and marks the identity non-stable. It must not infer identity from IP address, User-Agent, request timing, or UI state.

## Cancellation

If the MCP HTTP request is aborted or its response closes before completion, OWL MCP aborts the downstream Runtime HTTP request.

Runtime remains responsible for capability-specific cancellation semantics and for distinguishing cancellation from rollback.

## Tool policy

Two public generic adapters exist:

- `primitive_call`
- `skill_run`

Compatibility tools such as `git_status`, `read_file`, or `list_directory` are thin mappings to canonical Runtime Primitives.

A compatibility tool may unwrap the Primitive envelope for legacy ergonomics, but execution always occurs in Runtime.

## Security

Renderer code never receives Runtime or MCP bearer tokens.

OWL Desktop main process decrypts secrets and injects them into the embedded MCP bridge in memory.

If `OWL_MCP_API_TOKEN` is configured, the MCP endpoint requires the matching bearer token.

There is no silent legacy backend fallback.

## Retry boundary

Read-only/idempotent calls may be retried according to their Runtime contract.

Consequential transport replay is not considered production-safe until CR-DESKTOP-005 is satisfied by Runtime. Desktop must not implement a second execution dedupe database to hide this gap.
