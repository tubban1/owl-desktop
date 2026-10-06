# Provider Telemetry Bridge v1

Status: **Normative consumer/transport contract for OWL Desktop 1.0**.

Canonical provider contract: `owl-cloud/docs/contracts/PROVIDER_OBSERVABILITY_V1.md`.

Desktop is the authenticated device-side bridge between local OWL components and Cloud observability.

## Desktop-owned telemetry

Desktop/Tunnel should emit operational events for:

- Runtime process started/stopped/crashed/restarted;
- Tunnel connected/disconnected/reconnect failed;
- Cloud transport failure/recovery;
- device health transitions;
- OS permission/capability problems;
- command delivery/dedupe/reconciliation failures.

Runtime execution telemetry remains Runtime-owned semantically. Desktop is the transporter/adapter.

For Runtime 1.0, Desktop should derive the initial Runtime-origin telemetry from existing public Runtime surfaces such as diagnostics, health, Task/Process/Workspace summaries, provider status, privacy-aware audit summaries, Runtime version and lifecycle state. This avoids adding a new Runtime 1.0 protocol solely for Cloud telemetry.

This adapter is snapshot-oriented. Absence of a telemetry event is not proof that no execution occurred, and Desktop must not pretend these snapshots form a canonical real-time Runtime event stream.

## Delivery

Desktop is the Cloud HTTP sender for both Desktop-origin and Runtime-origin telemetry.

Desktop batches 1–100 sanitized events and sends them with the device credential to:

`POST /device/v1/telemetry`

Delivery is at-least-once. Retries reuse stable eventId. Telemetry delivery failure must not block local Runtime work.

Recommended local behavior:

- bounded disk-backed queue;
- retry with backoff;
- retain important failures/critical events preferentially;
- drop/sample high-volume success telemetry before exhausting local storage.

## Privacy

Desktop must redact before enqueueing.

Never send passwords, tokens, cookies, authorization headers, prompts/chat bodies, clipboard contents, screenshots, file contents, form contents, or raw message/email contents.

Do not upload raw stack traces by default. Emit symbolic errorCode/errorFingerprint plus safe metadata.

## Correlation

Preserve correlationId/taskId/runId supplied by Runtime/Cloud where available so Provider can trace:

Cloud command → Desktop → Runtime task/run → failure/recovery.

## Authority

Telemetry is diagnostic evidence only. Desktop must never fabricate Runtime task/run success from telemetry or Cloud state.
