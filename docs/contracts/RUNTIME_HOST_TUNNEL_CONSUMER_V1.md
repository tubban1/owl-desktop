# Runtime Host + OWL Tunnel Consumer Contract v1

Status: **Desktop-owned lifecycle consumer contract**.

## Runtime Host ownership

The native **OWL Runtime Host** implementation belongs to `owl-runtime`.

Canonical identity:

```text
bundle id: fan.fde.owl.runtime
stable app: ~/Applications/OWL Runtime.app
```

Desktop owns lifecycle UX only:

- inspect installed host identity/version;
- show macOS permission readiness;
- show launchd status;
- request restart/stop;
- orchestrate explicit install/upgrade flows;
- never silently replace the permission-bearing host.

Ordinary Runtime code releases must preserve the installed native host identity.

## Runtime execution boundary

Runtime Host launches Runtime. It does not move execution authority into Desktop.

```text
OWL Desktop
  ↓ lifecycle control
OWL Runtime Host
  ↓ hosts
OWL Runtime
  ↓ policy / approval / execution / verification
```

Desktop must not infer successful execution from process existence.

## OWL Tunnel role

OWL Tunnel is transport only.

```text
Remote client / Cloud ingress
  ↓
OWL Tunnel
  ↓
127.0.0.1:<mcpPort>/mcp
  ↓
OWL MCP
  ↓
RuntimeClient
  ↓
OWL Runtime
```

Tunnel must not implement:

- Cloud RBAC;
- Runtime policy;
- scheduler/task truth;
- approval enforcement;
- duplicate consequential execution semantics.

## Tunnel credentials

At rest, the Tunnel API key belongs in Desktop OS-encrypted storage.

The current compatibility tunnel binary consumes a `file:` credential.

Desktop may materialize that key only as a 0600 ephemeral runtime file and must remove it when the Tunnel stops.

This is transitional. Preferred future Tunnel contract:

- keychain provider, inherited file descriptor, or stdin secret handoff;
- no persistent plaintext secret file.

## Tunnel endpoint

Tunnel may forward only to an explicit loopback MCP endpoint owned by this Desktop instance.

Desktop rejects a non-loopback target in its supervisor.

## Cloud access

Cloud effective access is consumed according to `CLOUD_ACCESS_CONSUMER_V1.md`.

Tunnel transport success does not imply `canRun`.

A RemoteCommand still passes:

```text
Cloud authorization
→ Desktop delivery/dedupe
→ RuntimeClient
→ Runtime policy/approval
```

## Failure semantics

- Tunnel disconnected: transport unavailable; existing Runtime work continues.
- MCP unavailable: Tunnel must not fall back to legacy execution.
- Runtime unavailable: command cannot be accepted for execution.
- Runtime uncertain: surface uncertain; never retry through another backend.
