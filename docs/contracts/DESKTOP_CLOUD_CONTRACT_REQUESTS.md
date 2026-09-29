# Desktop -> OWL Cloud contract requests

Status: **Cloud provider contracts ready; Desktop consumer integration backlog**.

These requests belong to the Cloud control-plane provider. Desktop must not patch around them by inventing Cloud semantics.

## CR-CLOUD-001 — Versioned RemoteCommand kind registry

**Provider status: READY — Desktop consumer integration pending.**

Cloud now publishes:

- live registry: `GET /contracts/remote-command-kinds/v1`;
- repository fixture: `owl-cloud/docs/contracts/remote-command-kinds-v1.json`;
- normative contract: `owl-cloud/docs/contracts/REMOTE_COMMAND_PROTOCOL_V1.md`.

Cloud no longer treats `RemoteCommand.kind` as an arbitrary Runtime RPC mapping. Commands carry `kind + kindVersion`, and unsupported contracts are rejected before queueing.

Current frozen mapping:

```text
runtime.task.create@1
requiredCloudAccess: run
runtimeMapping: tasks.create
```

**Desktop remaining work:** pin/consume v1 in compatibility tests, validate `kindVersion` before touching Runtime, and reject unsupported versions without execution.

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

**Provider status: READY — highest-priority Desktop implementation.**

Frankfurt Cloud now exposes:

- `GET /auth/config`;
- Cognito Authorization Code flow;
- PKCE S256;
- public app client with no client secret;
- callback `owl-desktop://auth/callback`;
- logout callback `owl-desktop://auth/logout`;
- `POST /v1/bootstrap`;
- `POST /v1/devices`;
- credential rotate/revoke APIs.

Normative provider contract: `owl-cloud/docs/contracts/DESKTOP_ENROLLMENT_V1.md`.

**Desktop remaining work:**

```text
/auth/config
→ generate state + PKCE verifier/challenge
→ system browser
→ deep-link callback
→ exchange code + verifier
→ bootstrap
→ register device
→ persist deviceId as non-secret config
→ atomically store one-time device credential in OS Vault
```

Renderer must never receive the persisted device credential after enrollment. Account logout must not implicitly revoke the enrolled device.

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

**Provider status: READY — Desktop journal compaction may now be implemented.**

Cloud v1 freezes:

- at-least-once redelivery only while a command is non-terminal;
- after `accepted/rejected/expired/cancelled_before_accept` is committed, subsequent Cloud pulls never return that command;
- `commandId` is globally unique and never reused;
- re-enrollment creates a new deviceId and never retargets historical commands;
- minimum Desktop terminal mapping retention = **604800 seconds / 7 days**;
- `uncertain` mappings must never be automatically pruned solely because of age.

The live machine-readable policy is returned by `GET /contracts/remote-command-kinds/v1`.

**Desktop remaining work:** compact terminal mappings only after the 7-day minimum plus any chosen local safety margin; preserve uncertain records until reconciled/resolved.

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
