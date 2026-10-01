# OWL LAB Desktop — Installation, Onboarding and Recovery V1

Status: **target flow for the next friend-beta build**

## Product goal

A new user should not need to know what MCP, a tunnel, a Runtime port, a device credential, a launchd label or an API key is.

Target first-run flow:

```text
Download DMG
→ Install OWL LAB Desktop
→ Open
→ Sign in / Create OWL LAB account
→ Desktop installs and verifies local execution stack
→ Device enrolls automatically
→ Runtime receives execution lease automatically
→ Cloud provisions remote transport automatically
→ User connects ChatGPT once
→ macOS asks only for permissions required by the first requested capability
→ Ready
```

Target: a non-technical user reaches “ChatGPT can work on this Mac” without opening Terminal or manually copying identifiers/secrets.

## First-run UI

### 1. Welcome

```text
Welcome to OWL LAB
Let ChatGPT securely work on this Mac.

[ Sign in to OWL LAB ]
[ Create account ]
```

Do not show the normal control-plane dashboard before identity/setup state is known.

### 2. Preparing this Mac

```text
✓ Desktop installed
✓ Local Runtime installed
✓ Device registered
✓ Execution access granted
○ Connect ChatGPT
○ Optional macOS permissions
```

Each failed step gets one primary repair action and expandable technical details.

### 3. Connect ChatGPT

Normal user action:

```text
[ Connect ChatGPT ]
```

Cloud provisions tunnel identity and a rotating credential. Desktop owns tunnel lifecycle. Normal users never type Tunnel ID, OWL_TUNNEL_API_KEY, MCP port, Tunnel binary path or Runtime endpoint.

### 4. Permissions

- Desktop/Documents/Downloads are available within Runtime policy.
- Accessibility is requested only when clicks/typing are first needed.
- Screen Recording is requested only when visual perception is first needed.
- Full Disk Access is never requested by default.

### 5. Ready

```text
OWL LAB is ready
ChatGPT can securely work on this Mac.
```

## Product readiness model

| State | Meaning | Primary action |
| --- | --- | --- |
| SETUP_REQUIRED | Account/device setup incomplete | Continue setup |
| LOCAL_RECOVERY | Runtime/Helper installation unhealthy | Repair Runtime |
| AUTHORIZATION_REQUIRED | Signed in but execution lease missing/expired | Reauthorize |
| CHATGPT_CONNECTION_REQUIRED | Local execution ready but remote MCP transport absent | Connect ChatGPT |
| PERMISSION_REQUIRED | Requested capability needs macOS permission | Grant permission |
| DEGRADED | Core work available but recoverable support/Cloud issue exists | View issue |
| READY | Account + Runtime + execution lease + MCP/tunnel ready | Start working |

Overview should show one aggregate product state and one next action. Component badges remain secondary diagnostics.

## Startup lifecycle

```text
1. Load secure Desktop state.
2. Inspect Runtime Host installation and launchd service.
3. Verify packaged release identity.
4. If service is healthy and current, do not restart it.
5. If repair/restart is necessary:
   - request graceful stop
   - wait for launchd teardown
   - bootstrap with bounded retry/backoff
   - start service
6. Probe Runtime with token.
7. Verify API version, Runtime version, production mode, state root and exact release identity.
8. Resume Cloud account.
9. Fetch effective device access.
10. Project/renew Runtime execution lease.
11. Start MCP.
12. Start managed tunnel after credentials exist.
13. Start Cloud Bridge only after contract compatibility passes.
14. Publish aggregate product readiness.
```

A stale process on the Runtime port must never count as successful bootstrap merely because it returns API 0.1.

## Runtime reconnect

Runtime restart must not require sign-out/sign-in:

```text
Runtime unreachable → healthy
→ verify exact Runtime identity
→ refresh Cloud effective device access
→ canRun=true: access.authorize / renew lease
→ otherwise: access.lock
→ refresh dependent bridges
→ publish readiness
```

Use idempotency keys for repeated reconnects.

## launchd lifecycle

Do not unconditionally `bootout + bootstrap` on every Desktop launch.

```text
service exists + plist current + process healthy
→ leave running

service exists + process unhealthy
→ kickstart/restart

service/plist changed
→ controlled bootout
→ wait for absence
→ bootstrap with bounded retry
→ kickstart
```

Never tell normal users to run `sudo launchctl`.

## Cloud contract behavior

Before Cloud Bridge polling:

```text
GET /health
→ validate Cloud contract/version/capabilities
→ call only routes advertised by that deployment
```

Contract mismatch should produce one actionable message and backoff, not a warning every poll.

## Settings information architecture

Default Settings:

```text
Account
Launch at login
Allowed folders
Permissions
Connect / disconnect ChatGPT
Telemetry preference
```

Advanced Settings only:

```text
Runtime endpoint
MCP port
Tunnel binary
Tunnel ID
Cloud API endpoint
Device ID
poll intervals
raw transport diagnostics
```

## Recovery actions

- **Repair Runtime** — validate release, native apps, plist, launchd and health.
- **Reauthorize Runtime** — refresh Cloud effective access and project a new lease.
- **Reconnect ChatGPT** — rotate/re-provision tunnel credential and restart tunnel.
- **Test connection** — run a harmless read/write/verification in a temporary file.
- **Export diagnostics** — create one redacted support bundle with versions, readiness, launchd status, Runtime logs and recent Desktop events.

## Distribution layout

```text
friend-beta-<build>/
  OWL-LAB-Desktop-<version>-arm64.dmg
  OWL-LAB-Desktop-<version>-x64.dmg
  SHA256SUMS.txt
  FRIEND_BETA_TESTING.md
  BUILD_MANIFEST.json
```

Do not give testers unpacked `mac/`, `mac-arm64/`, blockmaps or intermediate build artifacts.