# OWL Cloud Bridge M1 implementation status

Status: **Desktop M1 polling transport implemented**  
Provider baseline: **OWL Cloud HTTP API v1 / Frankfurt dev**

## Implemented in OWL Desktop

Desktop now owns the local device-side Cloud Bridge transport:

```text
OWL Cloud
  -> device credential HTTP API
OWL Desktop Cloud Bridge
  -> command adapter / durable local bridge journal
RuntimeClient
  -> OWL Runtime
```

Implemented surfaces:

- device presence heartbeat;
- at-least-once RemoteCommand polling;
- durable commandId dedupe journal;
- command payload digest conflict detection;
- explicit Cloud accept/reject;
- Runtime execution identity mapping;
- durable Desktop integration-event outbox;
- durable privacy-bounded telemetry outbox;
- reconnect/retry with stable event IDs;
- local bridge health/status projection;
- OS-encrypted device credential consumption;
- Settings/Runtime/Overview UX.

The Cloud event transport exists, but Desktop currently emits only Desktop-owned integration events. It does not fabricate Runtime execution events while the canonical Runtime event stream is unavailable.

## Current command adapter

Cloud `RemoteCommand.kind` is currently an open string in the provider contract.

Desktop therefore does **not** proxy arbitrary Cloud kinds into Runtime RPC.

The only enabled mapping is:

```text
runtime.task.create
  -> Runtime public tasks.create
```

The payload must match Runtime's public task request shape using public routed actions.

Unknown kinds are rejected explicitly.

## Idempotency and uncertainty

Cloud delivery is at least once.

Before a new command is sent to Runtime, Desktop persists a journal record containing:

- commandId;
- target deviceId;
- kind;
- SHA-256 command digest;
- processing state.

The raw command payload is not copied into the journal.

After Runtime returns a canonical task identity, Desktop persists:

```text
commandId -> runtimeTaskId
```

before acknowledging Cloud.

Repeated delivery of an accepted command replays only the same Cloud accept mapping. It does not execute Runtime again.

If Desktop restarts while a command is still marked `processing`, the command becomes `uncertain` and is never automatically re-executed. This is intentionally fail-closed because the Runtime request may already have crossed the side-effect boundary.

If Runtime returns an explicit structured rejection, Desktop may reject the Cloud command.

## Outbox

Desktop maintains a durable bridge outbox for:

- Desktop-owned Event Envelope v1 integration messages;
- Provider Observability v1 telemetry.

Retries preserve the same event identity. Cloud performs idempotent ingest.

Telemetry contains bounded operational metadata only. It must not contain:

- RemoteCommand payloads;
- user prompts/content;
- credentials;
- secret values;
- raw file/message contents.

## Device credential

Desktop expects:

```text
Secret name: OWL_CLOUD_DEVICE_CREDENTIAL
Scope:       owl-cloud
```

The value is stored using Electron OS-backed `safeStorage`.

It is never returned to the renderer.

## Live provider probe

Frankfurt dev health endpoint was reached successfully during implementation:

```text
service: owl-cloud
contractVersion: v1
```

The Cloud provider already has deployed device-side M1 routes for presence, command pull/acknowledgement, event ingest and telemetry ingest.

## Local live bridge evidence

A repeatable verifier exercises the bridge against the real local Runtime:

```bash
npm run verify:cloud-bridge-live
```

It proves:

- Runtime API/version is reachable;
- `runtime.task.create` becomes one real Runtime task;
- duplicate delivery reuses the same `commandId -> runtimeTaskId` mapping;
- duplicate delivery does not create a second Runtime task;
- the local journal stores digest/mapping metadata rather than the raw command payload;
- the probe task is deleted after verification.

## Still pending

### Product enrollment

Desktop does not yet implement the normal human Cognito sign-in + bootstrap + device registration UX.

The HTTP client already exposes account-authenticated bootstrap and registration methods, but no credentials are fabricated or scraped.

### Runtime event producer

CR-DESKTOP-002 remains relevant. Desktop has a durable Cloud event transport/outbox, but it must not invent Runtime execution events while Runtime lacks the canonical event streaming/subscription surface needed by the bridge.

### RemoteCommand kind registry

Cloud needs a frozen versioned RemoteCommand kind/payload contract. Until then Desktop supports only the one proven adapter above.

### Retention gate

Terminal command mappings are intentionally not auto-pruned yet. Cloud must define the maximum terminal replay horizon before Desktop can compact the dedupe journal safely. This is tracked as CR-CLOUD-003.

### Cloud E2E

Full Gate 4 still requires a real enrolled Desktop credential and a Cloud-created command reaching the real Runtime, followed by event/projection reconciliation and reconnect fault evidence.
