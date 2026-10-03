# OWL LAB Remote Connectivity Modes v1

Status: normative product/reliability decision.

## Decision

OWL LAB production correctness is owned by the **OWL Cloud Durable MCP** path.

```text
ChatGPT / remote MCP client
  -> OWL Cloud MCP Gateway
  -> durable McpCall
  -> enrolled device
  -> background Connectivity Host
  -> local OWL MCP
  -> OWL Runtime
```

A request is durable before it depends on a user's Mac being continuously online.
The local Runtime remains the execution authority.

OpenAI Secure MCP Tunnel is a transport accelerator / compatibility path, not
the source of truth for production task existence.

## Modes

### `cloud_durable` — default

For normal users.

- Requires OWL LAB account login and Device Enrollment.
- Requires the background Connectivity Host.
- Requires successful Cloud durable queue reachability.
- Requires a real local MCP executor proof.
- Does **not** require a Tunnel ID or OpenAI Runtime API key.
- A Tunnel outage must not make an already accepted Cloud call disappear.

This is the default for fresh installations.

### `managed_tunnel` — OWL-managed acceleration

For users who want Tunnel convenience without handling OpenAI credentials.

- Cloud provisions and persists the device's OpenAI Tunnel identity.
- Desktop uses its existing OWL device credential only.
- The vendored `tunnel-client` points to the OWL Cloud Tunnel proxy.
- OWL Cloud validates `deviceId <-> tunnelId` and substitutes a server-side
  OpenAI Runtime credential upstream.
- OWL OpenAI Admin/Runtime credentials never leave Cloud.
- If provisioning or the managed Tunnel path is unavailable, Cloud Durable MCP
  remains the production correctness path.

This mode is implemented but must remain disabled in an environment until an
OWL-owned OpenAI Tunnel Admin credential, Runtime credential and intended
ChatGPT workspace ID(s) are configured and dogfooded.

### `custom_tunnel` — advanced / self-managed

For developers, enterprise operators or users who intentionally manage their
own OpenAI Secure MCP Tunnel.

The user owns:

- OpenAI Platform tunnel identity;
- Runtime API key restricted to Tunnels Read + Use;
- associated OpenAI organization/workspace configuration.

Desktop stores the runtime key only in OS-backed encrypted secret storage.
It never writes the key into settings, logs or LaunchAgent plist.

Existing installations that already have an enabled Tunnel ID migrate to this
mode so the cutover does not silently break a working connection.

## Managed OWL Tunnel implementation

The server-side proxy design is now implemented.

```text
Desktop tunnel-client
  api-key = OWL device credential
  base-url = OWL Cloud /tunnel
        ↓
OWL Cloud
  authenticate device
  verify bound tunnelId
  replace Authorization
        ↓
OpenAI Tunnel control plane
  server-side OWL Runtime credential
```

Tunnel creation uses a separate server-side OWL OpenAI Admin credential and
explicit ChatGPT workspace ID(s). No shared or per-device OpenAI API key is
distributed to Desktop.

The detailed Cloud contract is
`owl-cloud/docs/architecture/MANAGED_TUNNEL_V1.md`.

Managed Tunnel is still not a release dependency because `cloud_durable`
already supplies the production correctness path.

## Readiness

`cloud_durable` is READY only when all of the following are true:

```text
account authenticated
AND device enrolled
AND Runtime execution authorized
AND Connectivity Host reachable
AND local MCP listener reachable
AND local MCP executor proven
AND Cloud durable MCP poll proven
```

`process alive`, `listener exists`, or `Tunnel running` alone are never
sufficient readiness proofs.

`managed_tunnel` keeps product readiness anchored to Cloud Durable MCP; managed
Tunnel reachability is an additional acceleration fact. `custom_tunnel` uses
Tunnel end-to-end reachability as its remote transport readiness predicate.

## Secret boundaries

| Secret / identity | Cloud | Desktop |
| --- | --- | --- |
| OWL account identity | canonical | session/cache |
| OWL device ID | canonical | cached |
| OWL device credential | verifier / revocation state | OS-encrypted secret |
| Managed Tunnel ID/binding | canonical | runtime projection/cache only |
| Managed Tunnel proxy auth | validates device credential | existing OWL device credential |
| Custom Tunnel ID | optional metadata only | local config |
| Custom OpenAI Runtime API key | never | OS-encrypted secret |
| OWL OpenAI Admin/Runtime credentials | server-side secret manager only | never |

## Product UX

Normal setup:

```text
Install OWL LAB
-> Sign in
-> Device Enrollment
-> Connectivity Host starts
-> Cloud durable MCP proves local executor
-> Ready
```

No Tunnel ID, API key, Runtime port or MCP port is required from a normal user.

Advanced Settings may expose `Custom OpenAI Tunnel` explicitly. The UI must not
imply that OWL LAB can safely auto-distribute a shared official OpenAI runtime
key.
