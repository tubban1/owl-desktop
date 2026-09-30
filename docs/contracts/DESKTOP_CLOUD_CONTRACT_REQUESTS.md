# Desktop → OWL Cloud contract requests

Status: **CR-CLOUD-001/002/003 provider contracts resolved in Frankfurt. Desktop consumer implementation is in PR #13; live product E2E remains the final gate.**

These requests belong to the Cloud control-plane provider. Desktop must not patch around missing Cloud semantics by inventing its own provider rules.

## CR-CLOUD-001 — Versioned RemoteCommand kind registry

Status: **RESOLVED BY CLOUD / CONSUMED BY DESKTOP**

Cloud publishes:

```text
GET /contracts/remote-command-kinds/v1
```

Current frozen mapping:

```text
runtime.task.create@1
requiredCloudAccess: run
runtimeMapping: tasks.create
```

Cloud rejects unsupported `kind + kindVersion` before queueing.

Desktop PR #13 now:

- includes `kindVersion` in the durable command digest;
- accepts only `runtime.task.create@1`;
- rejects unsupported kind/version before touching Runtime;
- preserves the Cloud → Runtime `commandId → runtimeTaskId` mapping.

The kind string is never interpreted as an arbitrary Runtime RPC method name.

## CR-CLOUD-002 — Device enrollment handoff for Desktop

Status: **RESOLVED BY CLOUD / DESKTOP CONSUMER IMPLEMENTED**

Cloud live provider:

```text
GET /auth/config
Authorization Code + PKCE S256
no client secret
owl-desktop://auth/callback
```

Desktop PR #13 implements:

```text
system browser login
→ deep-link callback
→ PKCE code exchange in Electron main process
→ Cloud bootstrap
→ Cloud device registration
→ device credential stored in OS-backed Vault
→ deviceId stored as non-secret settings
→ Cloud Bridge start
```

Security invariants:

- Renderer never receives PKCE verifier, JWTs, refresh token or device credential;
- refresh token and device credential use OS-backed encrypted storage;
- logout clears the human account session but does not silently revoke the enrolled device;
- normal OWL LAB Desktop/Runtime use requires an authenticated account plus enrolled device;
- before authorization, Desktop exposes only the LOCKED enrollment/recovery shell and Runtime health/version/diagnostics;
- a bounded offline execution lease may preserve previously authorized local work during temporary Cloud loss; this must not become an implicit permanent local-only mode.

Remaining acceptance item: execute the flow on the real Mac against Frankfurt and capture live product evidence.

## CR-CLOUD-003 — Terminal command replay horizon

Status: **RESOLVED BY CLOUD / CONSUMED BY DESKTOP**

Cloud freezes:

- at-least-once delivery while non-terminal;
- no pull redelivery after terminal commit;
- no historical command replay after device re-enrollment;
- `commandId` is never reused;
- Desktop terminal dedupe retention minimum = 604800 seconds (7 days);
- `uncertain` records must not be auto-pruned by age.

Desktop PR #13 now compacts only old `accepted/rejected` mappings after the 7-day safety window.

`uncertain` mappings remain durable until explicitly reconciled.

## Final integration gate

The remaining closure path is product E2E, not another contract request:

```text
Cognito login
→ bootstrap
→ Desktop register device
→ OS Vault
→ Cloud RemoteCommand
→ Desktop
→ real OWL Runtime task
→ runtimeTaskId
→ Cloud accept
→ event / telemetry
→ disconnect
→ reconnect
→ reconciliation
```
