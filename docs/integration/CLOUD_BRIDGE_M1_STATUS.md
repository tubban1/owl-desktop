# OWL Cloud Bridge M1 implementation status

Status: **Desktop M1 transport + product enrollment implemented; Frankfurt live product E2E pending**  
Provider baseline: **OWL Cloud HTTP API v1 / Frankfurt dev**

## Implemented in OWL Desktop

Desktop owns the local device-side Cloud Bridge transport:

```text
OWL Cloud
  → device credential HTTP API
OWL Desktop Cloud Bridge
  → versioned command adapter / durable local bridge journal
RuntimeClient
  → OWL Runtime
```

Implemented surfaces:

- Cognito Authorization Code + PKCE S256 account login;
- `owl-desktop://auth/callback` deep-link handling;
- account bootstrap;
- device registration;
- OS-encrypted device credential storage;
- OS-encrypted account refresh-token storage;
- account logout that preserves explicit device enrollment;
- device presence heartbeat;
- at-least-once RemoteCommand polling;
- `kind + kindVersion` compatibility enforcement;
- durable commandId dedupe journal;
- command payload/version digest conflict detection;
- explicit Cloud accept/reject;
- Runtime execution identity mapping;
- 7-day terminal journal compaction;
- `uncertain` records never age-pruned;
- durable Desktop integration-event outbox;
- durable privacy-bounded telemetry outbox;
- reconnect/retry with stable event IDs;
- local bridge health/status projection;
- Settings/Runtime/Overview UX.

The Cloud event transport exists, but Desktop must not fabricate Runtime execution events. Runtime-origin execution truth remains Runtime-owned.

## Product enrollment

The normal product path is now implemented in Desktop PR #13:

```text
GET /auth/config
→ generate state + PKCE verifier/challenge
→ open system browser
→ Cognito Managed Login
→ owl-desktop://auth/callback
→ verify state
→ exchange code + verifier in Electron main process
→ POST /v1/bootstrap
→ POST /v1/devices
→ OS Vault stores one-time device credential
→ cloudDeviceId stored as non-secret config
→ Cloud Bridge starts
```

Renderer receives only sanitized enrollment status and canonical account/device identifiers.

It never receives:

- PKCE verifier;
- id/access/refresh tokens;
- device credential.

## Current command adapter

Cloud provider registry:

```text
GET /contracts/remote-command-kinds/v1
```

Desktop currently supports exactly:

```text
runtime.task.create@1
  → Runtime public tasks.create
```

Unknown or unsupported kind/version is rejected before Runtime.

## Idempotency and uncertainty

Cloud delivery is at least once while non-terminal.

Before a new command crosses into Runtime, Desktop durably records:

- commandId;
- deviceId;
- kind;
- kindVersion;
- SHA-256 command digest;
- processing state.

The raw command payload is not copied into the journal.

After Runtime returns a canonical task identity, Desktop persists:

```text
commandId → runtimeTaskId
```

before acknowledging Cloud.

Repeated delivery replays only the same Cloud acknowledgement; Runtime is not executed twice.

If Desktop restarts during a Runtime request, the mapping becomes `uncertain` and is never automatically re-executed.

Cloud now guarantees terminal commands are not redelivered after terminal commit. Desktop retains accepted/rejected mappings for at least seven days and may compact them after that safety window. `uncertain` mappings are never compacted merely because of age.

## Outbox and telemetry

Desktop maintains a durable bridge outbox for:

- Desktop-owned Event Envelope v1 integration messages;
- Provider Observability v1 telemetry.

Retries preserve event identity. Cloud performs idempotent ingest.

Telemetry is bounded operational metadata only and must not contain command payloads, user prompts/content, credentials, secret values or raw files/messages.

## Verification

Automated PR #13 gates:

- unit tests: PASS;
- Electron main/preload/service syntax: PASS;
- TypeScript + renderer build: PASS;
- existing Runtime 1.x Skill integration: PASS.

The existing local live verifier remains:

```bash
npm run verify:cloud-bridge-live
```

It proves one real Runtime task mapping and duplicate-delivery idempotency against a local Runtime.

## Remaining product E2E

Do not mark the Cloud product loop fully closed until the actual Mac runs:

```text
Cognito login
→ bootstrap
→ Desktop enrollment
→ OS Vault
→ Frankfurt RemoteCommand
→ Desktop
→ real Runtime task
→ Cloud accept
→ event/telemetry
→ disconnect
→ reconnect
→ reconciliation
```

Once this evidence passes, Desktop ↔ Cloud M1 is product-level closed.
