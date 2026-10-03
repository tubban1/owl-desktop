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

Cloud Durable MCP is connected first and remains the correctness path. When OWL Managed Tunnel is enabled for the account/workspace, Cloud provisions the Tunnel identity and Desktop reuses its existing OS-encrypted OWL device credential to authenticate to the OWL Tunnel proxy. OWL OpenAI Admin/Runtime credentials remain server-side. Normal users never type Tunnel ID, OWL_TUNNEL_API_KEY, MCP port, Tunnel binary path or Runtime endpoint.

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
| READY | Account + Runtime + execution lease + local MCP + Cloud Durable MCP proven; optional Managed Tunnel is secondary | Start working |

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
- **Reconnect ChatGPT** — recover Cloud Durable MCP first; if Managed Tunnel is enabled, re-bootstrap its device binding/proxy path; Custom Tunnel recovery remains an Advanced action.
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
## Allowed folders management

`Allowed folders` is a first-class Desktop product setting, but Runtime remains the canonical policy authority.

Normal UI:

```text
Settings
└─ Files & folders
   ├─ Desktop        Read + Write
   ├─ Documents      Read + Write
   ├─ Downloads      Read + Write
   ├─ + Add folder…
   └─ Remove / change access
```

Use the native macOS folder picker. Users should never edit `ALLOWED_DIRECTORIES` manually.

Policy rules:
- child paths inherit the selected root;
- removing a root takes effect immediately for new work;
- display whether a root is read-only or read/write;
- protected macOS locations may still require OS permission;
- Desktop must project changes through a Runtime policy/admin contract rather than maintaining an independent policy copy.

If Runtime does not yet expose a canonical filesystem-policy mutation contract, create a Runtime contract request instead of duplicating the policy in Desktop.

## Approval experience

Runtime owns canonical approval state. Approval can be presented through more than one UI surface, but there must be only one approval record/state transition.

### ChatGPT inline approval

For an approval caused by the current conversation, ChatGPT should surface the request in context:

```text
OWL wants to delete 3 files from ~/Downloads.
[ Approve ] [ Deny ] [ View details ]
```

Approve/Deny calls Runtime `approvals.approve` / `approvals.deny`. A conversational yes must be explicit and bound to the concrete approval ID; never infer approval from unrelated text.

### Desktop Approval Center

Desktop provides the durable inbox/history for approvals that outlive a chat or were generated by background work:

```text
Work / Needs attention
└─ Approvals
   ├─ Pending
   ├─ Approved
   └─ Denied / expired
```

The same approval can be completed from ChatGPT or Desktop; both update the same Runtime-owned record and the other surface refreshes automatically.

### Local-only approvals

Some device-security changes should require local Desktop/macOS confirmation rather than remote chat approval, for example:
- adding a new broad filesystem root;
- enabling shell/delete globally;
- granting Accessibility, Screen Recording or Full Disk Access;
- rotating device/tunnel identity;
- changing security policy.

Task-scoped operational approvals can normally be approved in ChatGPT. Device-security policy changes should remain local.

## Simplified navigation

Replace the current engineering-oriented primary navigation with a user-oriented structure:

```text
Home
Work
Skills
Connections
Settings
```

Suggested mapping:
- Home: readiness, next action, recent work, pending approvals;
- Work: tasks, sessions, Agent Inbox/needs-attention, approval history;
- Skills: installed/user skills;
- Connections: ChatGPT plus external service accounts;
- Settings: account, files & folders, permissions, launch at login, telemetry;
- Advanced (secondary, hidden by default): Runtime, MCP/Tunnel, Secrets, raw endpoints, Live Logs, diagnostics.

Do not make Runtime, Tunnel, ports, device IDs or raw Secrets primary navigation for normal users.