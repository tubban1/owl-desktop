# OWL Desktop Ownership

Status: **Normative**.

OWL Desktop is the **local product and integration boundary**. It is not the execution kernel and not the cloud control plane.

## OWL Desktop owns

- MCP compatibility and server naming
- local Control Panel
- local settings UX
- local logs/session visualization
- Skill Manager UX: catalog, detail, test-run, install/review, candidates, versions and rollback presentation
- local Identity & Session Vault for external services
- login challenge UX for QR/OTP/passkey/authenticator flows
- stable macOS packaging and installation
- OWL Helper / Runtime Host lifecycle UX
- OWL Tunnel client packaging and lifecycle
- OWL Cloud Bridge client
- canonical local Agent Inbox coordination state: persistence, dedupe, claim leases and completion status
- MCP AgentRequest discovery/claim UX for ChatGPT/AI consumers
- backend selection and compatibility presentation
- local product update UX
- local integration tests across MCP → Runtime
- local compatibility matrix

## OWL Desktop does not own

- Task state machine
- Process ownership
- Scheduler / Loop semantics
- Workspace leases / concurrency
- Observation / Verifier semantics
- execution Approval receipts
- Runtime retry/recovery semantics
- Runtime canonical issue/task/candidate truth that may produce AgentRequest proposals
- LLM semantic repair/reasoning itself
- Account / Organization truth
- Cloud RBAC/effective-access evaluation
- Device grants
- third-party service authentication policy
- billing/subscription
- cloud command persistence
- Worker product state

Those belong to OWL Runtime, OWL Cloud, or OWL Worker.

## Product identity

The installed product is **OWL Desktop**.

```text
OWL Desktop
├─ OWL MCP
├─ OWL Control
├─ OWL Tunnel
├─ OWL Cloud Bridge
├─ OWL Helper
└─ bundled/connected OWL Runtime
```

The legacy `computer-mcp` server/package name may remain as a compatibility alias during migration.

## Integration principle

OWL Desktop is the local integration host, but it is **not the source of execution truth**.

It may coordinate processes and display state, but canonical execution state comes only from RuntimeClient.
