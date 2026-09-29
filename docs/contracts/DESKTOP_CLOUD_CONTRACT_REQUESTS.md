# Desktop -> OWL Cloud contract requests

Status: **Active integration backlog**.

These requests belong to the Cloud control-plane provider. Desktop must not patch around them by inventing Cloud semantics.

## CR-CLOUD-001 — Versioned RemoteCommand kind registry

**Need:** Cloud currently models `RemoteCommand.kind` as an open string. Desktop needs a frozen mapping from Cloud command kinds to versioned payload schemas before enabling additional Runtime adapters.

Requested contract:

- stable command kind identifier;
- command payload version;
- JSON schema or equivalent machine-readable payload contract;
- required Cloud effective access for creation;
- intended Runtime public API mapping;
- whether the command is consequential;
- expiry/cancellation semantics;
- compatibility/deprecation metadata.

Example candidate:

```text
kind: runtime.task.create
version: 1
requiredCloudAccess: canRun
runtimeMapping: tasks.create
```

Desktop must reject unknown or unsupported kinds. It must never treat an arbitrary `kind` string as a Runtime RPC method name.

Acceptance:

1. Cloud conformance fixtures publish supported kind/version payloads.
2. Desktop compatibility tests consume those fixtures.
3. Unsupported kind/version is rejected without touching Runtime.
4. Payload evolution does not silently change the meaning of an existing kind/version.

## CR-CLOUD-002 — Device enrollment handoff for Desktop

**Need:** Desktop needs a product-safe Cognito sign-in/bootstrap/device-registration handoff without handling provider secrets manually.

Requested semantics:

- user signs in through the supported OWL account flow;
- Desktop receives a short-lived authenticated account session;
- Desktop calls bootstrap;
- Desktop registers the local installation;
- one-time device credential is returned;
- Desktop persists it only in the OS credential store;
- deviceId is persisted as non-secret configuration;
- credential rotate/revoke UX is defined;
- logout does not silently revoke an enrolled device unless explicitly requested.

Acceptance:

1. Fresh Desktop can enroll without shell/AWS/manual database steps.
2. Renderer never receives the stored device credential after enrollment.
3. Old credential stops authenticating after rotate/revoke.
4. Local-only mode remains usable without Cloud enrollment.

## CR-CLOUD-003 — Terminal command replay horizon

**Need:** Desktop must retain `commandId -> Runtime identity` mappings long enough to prevent duplicate consequential execution, but an unbounded local journal is not a production retention policy.

Cloud should define:

- whether a command in `accepted`, `rejected`, `expired`, or `cancelled_before_accept` can ever be delivered again;
- the maximum replay/redelivery horizon after a terminal acknowledgement;
- whether device re-enrollment can cause historical commands to be replayed;
- whether command IDs are globally unique forever or unique only within a bounded retention window;
- the minimum dedupe retention Desktop must preserve.

Until this is frozen, Desktop keeps terminal mappings rather than pruning them automatically.

Acceptance:

1. Cloud publishes a normative terminal replay horizon.
2. Desktop journal retention is at least that horizon plus a safety margin.
3. A command replayed inside the horizon never creates a second Runtime action.
4. Journal compaction never deletes `uncertain` records automatically.
