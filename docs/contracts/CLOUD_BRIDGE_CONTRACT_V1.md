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
