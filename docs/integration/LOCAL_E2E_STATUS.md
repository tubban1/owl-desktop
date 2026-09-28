# OWL Desktop Local E2E Status

Status: **Gate 3A passed; consequential replay gate pending**.

Validated on 2026-09-29 against:

- OWL Desktop 0.1.0 development line
- OWL MCP 0.1.0 embedded in Electron main
- OWL Runtime 1.0.0-rc.4
- Runtime public API 0.1
- macOS host execution target

## Proven path

```text
MCP Client
→ OWL Desktop / embedded OWL MCP :8790
→ RuntimeClient HTTP
→ OWL Runtime :8788
→ git.query(status)
→ owl-desktop repository
```

The legacy Computer MCP / AgentOS production service on port 8787 remained untouched.

## Automated evidence

Run:

```bash
npm test
npm run build
npm run verify:local-e2e
```

Current verification proves:

- MCP tool discovery
- Runtime API/version discovery
- stable logical owner hashing
- same owner across a new MCP transport connection
- no identity inference from User-Agent/IP/timing
- MCP abort propagation into Runtime HTTP AbortSignal
- `git_status` maps to Runtime `git.query(status)`
- MCP Git status exactly matches direct Git status
- deterministic read-only retry
- no direct filesystem/Git execution in Desktop compatibility handlers
- Electron main, not Renderer, owns the MCP listener and Runtime credentials

## Gate 3 boundary

Read-only Local E2E is **green**.

Consequential transport replay is **not yet green**.

Runtime currently owns active request cancellation by request/session identity, but the public contract does not yet guarantee completed-request replay or duplicate suppression after a response is lost.

That missing execution semantic is CR-DESKTOP-005.

Desktop will not create a second dedupe database to mask the gap.

## Remaining Gate 3 work

1. Runtime satisfies CR-DESKTOP-005.
2. Fault-inject response loss after Runtime accepts a consequential request.
3. Retry with the same idempotency/replay identity.
4. Prove one side effect and one canonical Runtime receipt.
5. Add the evidence here and promote Gate 3 from partial to complete.
