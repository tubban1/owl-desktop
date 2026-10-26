# OWL LAB Windows background-host persistence

Status (2026-10-26): **design + safe read-only diagnostic**, not a deployed Windows Service. Never claim actual logoff survival until a real Windows logoff/reboot acceptance test passes.

## The current failure

The Windows DEV launcher starts Electron in the signed-in user's session.
Electron's \`startWindowsDevRuntime\` spawns Runtime on 8788 and
\`startMcp\` binds 8790. The Windows direct Tunnel is started separately by
a PowerShell script with a user-DPAPI encrypted control-plane key, and it
requires the user-session MCP 8790 health before starting.

Consequences: closing Electron or signing out tears down the Runtime/MCP
process tree; the Tunnel can no longer serve a healthy MCP even if its own
process survives. Merely configuring auto-start at user logon does **not**
address sign-out persistence. The existing Chrome Native Messaging host is
spawned by Chrome and always belongs to the interactive session.

## Intended deployment

Separate **non-interactive** processes from interactive capabilities:

| Component | Ownership | Available when signed out? |
| --- | --- | --- |
| \`OWL Background Host\` | Windows SCM service (dedicated least-privilege service identity) | Yes |
| OWL Runtime API / task storage | Background Host, independent child on 127.0.0.1:8788 | Yes |
| OWL MCP HTTP | Background Host, independent child on 127.0.0.1:8790 | Yes |
| Official Tunnel Client | Background Host, independent child / supervised on 127.0.0.1:18081 | Yes |
| OWL Desktop UI | Signed-in user process, attaches to Host via authenticated local IPC | No |
| Agent Browser / Chrome Native Messaging | Signed-in Chrome session, forwarded by Desktop/User Agent | No |
| Mouse, keyboard, interactive file picker | Signed-in, unlocked user session with explicit action permission | No |

Use service recovery with bounded exponential backoff, singleton PID/port
ownership, health polling and Windows Event Log status. Do not use an
interactive window or \`--headless\` Chrome as a substitute for a service.
A durable task should survive transient tunnel disconnection; idempotency
keys prevent duplicate execution after reconnection.

## Critical preconditions before a real service install

1. **Device credentials.** The current Desktop stores the Runtime API token
   in user Electron \`safeStorage\`, and Windows DEV Tunnel decrypts its
   control-plane key using DPAPI **CurrentUser**. A service account must not
   simply read either from another user's profile, copy plaintext credentials
   into environment files, or assume the DPAPI scopes match.
2. Provision a **service-specific** device identity/key or perform an
   explicit one-time, user-authorized migration into an isolated service
   credential store (service SID + restricted ACL, protected storage API).
   Avoid unrestricted LocalSystem for code execution if a dedicated service
   identity can fulfill the role. Token rotation and revocation are required.
3. **Run exactly one MCP 8790 / Runtime 8788 / Tunnel 18081** per device.
   Migrating DEV requires stopping Electron ownership, establishing service
   ownership, and verifying the new local listener; rollback if unhealthy.
   Preserve legacy Computer MCP on 8787 and its distinct tunnel.
4. Keep the background MCP tool surface least-privileged: no browser,
   window manager, clipboard or user-profile filesystem access without
   reattached user agent and independent per-action approval.
5. Windows power plan must permit *computer awake*, not merely display
   switched off. Do not silently disable automatic sleep or hibernation.
   Windows servicing/reboot requires the service to auto-start and recover.

## Acceptance matrix (real Windows hardware)

| Scenario | Background MCP | Interactive operations |
| --- | --- | --- |
| Turn off monitors (computer awake) | MUST stay healthy | UI-dependent may pause |
| Lock workstation for 30 min | MUST stay healthy | Restrict interactive actions |
| Quit Desktop UI (not Host) | MUST stay healthy | Reattach on UI restart |
| Sign out Windows account | MUST remain healthy | Unavailable |
| Sign back in | No duplicate host; user agent attaches | Restored after permission checks |
| Restart Windows without signing in | MUST auto-start + reconnect | Unavailable |
| Kill Host / Runtime / Tunnel | SCM restart and backoff; no duplicate tasks | May transiently disconnect |
| Disconnect Internet, then reconnect | Durable task state preserved; tunnel reconnects | No lost or double tool calls |
| Sleep / hibernate | Execution **paused** while actually asleep | Resume/reconcile after wake |

Pass criteria: 8788 + 8790 healthy and tunnel control-plane ready after
lock, sign-out and reboot; no live interactive session required for core
Runtime/MCP. Record uptime, startup time, process identity and no duplicate
ports. Run browser actions after re-login only.

## First implementation gate

Run \`scripts/windows/check-background-persistence.ps1\`. It is entirely
**read-only** and reports the live listener ownership, user session ID,
Windows services and Task Scheduler registrations without exposing command
lines or credential values. An absent service and an Electron-owned 8790
mean persistence across sign-out has **NOT** been achieved.

Remaining implementation: dedicated service Host binary, protected service
credential provisioning, authenticated Desktop ↔ Host IPC, service control,
health/restart matrix and real hardware sign-out/reboot verification. Do not
mark this feature complete just because a startup task exists.
