# OWL Desktop Provider Telemetry Transport v1

Status: **OWL 1.0 transport contract**.

Canonical Cloud contract: `owl-cloud/docs/contracts/PROVIDER_OBSERVABILITY_V1.md`.

Desktop is the Cloud transport boundary for Runtime/Desktop/Tunnel operational telemetry.

## Responsibilities

Desktop:

1. receives privacy-safe telemetry from Runtime through a local interface;
2. emits its own Desktop/Tunnel operational events;
3. batches 1–100 events;
4. authenticates to Cloud with the device credential;
5. POSTs to `/device/v1/telemetry`;
6. retries at-least-once using the same `eventId`;
7. never blocks local execution because Cloud telemetry is unavailable.

Runtime must not receive the Cloud device credential.

## Desktop/Tunnel events

Always preserve:

- Desktop runtime host start/crash/restart;
- Runtime host compatibility failure;
- tunnel connected/disconnected;
- reconnect attempts/failures;
- Cloud bridge authentication failures;
- RemoteCommand delivery/dedupe/reconciliation failures;
- local queue saturation/drop;
- OS permission failures that prevent OWL operation.

## Buffering

v1 should use a bounded local queue.

Priority order when pressure requires dropping data:

1. never intentionally drop `critical`;
2. preserve `error`;
3. preserve state transitions / reconnect failures;
4. drop sampled/high-volume `info` first.

Retries reuse the same event ID so Cloud can deduplicate.

## Privacy boundary

Desktop must redact before queueing/uploading.

Never upload:

- device credential;
- login/session secrets;
- clipboard contents;
- screen/screenshot/image contents;
- raw prompts/chat/message text;
- file contents;
- form/input values;
- cookies/tokens/API keys.

Cloud performs additional schema/key validation, but Desktop redaction is the primary boundary.

## Discovery vs telemetry

Cloud account/device discovery is unrelated to telemetry authority. Seeing a device or having owner/admin organization rights does not expose provider telemetry through customer APIs.

Provider-wide observability remains an operator/AWS boundary in 1.0.

## Offline behavior

Cloud loss does not imply Runtime failure. Desktop records connectivity transitions locally, reconnects independently, and uploads retained telemetry after connectivity resumes.
