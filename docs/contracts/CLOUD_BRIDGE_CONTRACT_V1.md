# Cloud Bridge Contract v1

Status: **Normative consumer contract**.

Canonical provider: **owl-cloud**.

Account/role/device authorization consumption is defined in [Cloud Access Consumer Contract v1](CLOUD_ACCESS_CONSUMER_V1.md).

OWL Cloud Bridge connects the local device to OWL Cloud's control plane. It never turns Cloud state into a second Runtime state machine.

## Control-plane entities

Cloud owns:

- userId
- organizationId
- deviceId
- grantId
- commandId
- cloud schedule-intent ID
- account/session identity
- device presence
- cloud audit records

## Local execution mapping

A remote command is not a Runtime Task.

```text
Cloud Command
   ↓ dispatched
Desktop Cloud Bridge
   ↓ accepted/rejected
RuntimeClient
   ↓
Runtime Task / Run / Process
```

When accepted, Desktop records the mapping:

```text
commandId → Runtime run/task identity
```

Execution truth remains in Runtime.

## Delivery semantics

Cloud transport is **at-least-once**.

Desktop processing must be idempotent by `commandId`.

Repeated delivery of the same command must not create duplicate consequential execution.

## Offline behavior

A device may be offline for hours or days.

Cloud queues control-plane intent. Desktop reconnects, authenticates, receives commands, performs idempotency checks, then accepts/rejects.

Cloud cannot mutate local Runtime state files while the device is offline.

## No silent fallback

If Runtime returns `uncertain`, Desktop must surface it. It must never silently execute the same command through a legacy backend.

## Desktop M1 transport profile

The first implemented Desktop transport is HTTP polling against the Cloud v1 device API:

```text
POST /device/v1/presence
GET  /device/v1/commands
POST /device/v1/commands/{commandId}/accept|reject
POST /device/v1/events
POST /device/v1/telemetry
```

Desktop persists a local bridge journal containing only command identity/digest/status and Runtime mapping. It does not persist another copy of the RemoteCommand payload.

Before invoking Runtime for a new command, Desktop marks the command `processing`. A restart while that state is present converts it to `uncertain`; Desktop does not automatically re-execute it.

Once Runtime returns a canonical identity, Desktop persists the mapping before Cloud acknowledgement. A later duplicate delivery replays only the same acknowledgement.

Runtime/Desktop events and bounded provider telemetry use a durable outbox with stable event IDs.

## Command adapter rule

`RemoteCommand.kind` is not a generic Runtime RPC escape hatch. Desktop enables only explicitly versioned/compatible adapters.

Current M1 implementation supports only:

```text
runtime.task.create -> Runtime tasks.create
```

Unknown kinds are rejected before Runtime is touched. A versioned Cloud command-kind registry is tracked in `DESKTOP_CLOUD_CONTRACT_REQUESTS.md`.

## Credential boundary

Device credentials are consumed only in the Electron main process from OS-backed secret storage. They are never returned to the renderer or written into the bridge journal/logs.
