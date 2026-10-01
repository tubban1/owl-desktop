# OWL LAB Desktop — Friend Beta Testing

Status: **internal dogfood / HOLD for friend distribution until current P0/P1 findings are closed**.

See:
- `FRIEND_BETA_FINDINGS_2026-10-01.md` — real-install findings and blockers.
- `ONBOARDING_AND_RECOVERY_V1.md` — target install/start/recovery UX.
- `FRIEND_BETA_TEST_PLAN_V1.md` — automated, owner and clean-Mac test matrix.

This remains a **private unsigned beta** build line.

This track is intentionally used **before** purchasing/configuring an Apple Developer ID. It is suitable for a small number of trusted testers who understand that macOS will show Gatekeeper warnings for an unsigned/unnotarized app.

Do not use this build for broad public distribution.

## Which file to send

- Apple Silicon Mac (M1/M2/M3/M4/M5 and later): `OWL LAB Desktop-0.1.0-arm64.dmg`
- Intel Mac: `OWL LAB Desktop-0.1.0-x64.dmg`

Prefer the DMG for normal testing. ZIP files are retained as a fallback/debug distribution.

Before opening, compare the downloaded file with `SHA256SUMS.txt`.

## Install

1. Open the DMG.
2. Drag **OWL LAB Desktop** to `/Applications`.
3. Because this beta is not Developer-ID signed yet, macOS may block the first launch.
4. First try **Control-click / right-click → Open → Open**.
5. If macOS still blocks it, open **System Settings → Privacy & Security**, find the OWL LAB Desktop warning and choose **Open Anyway**.

Do **not** disable Gatekeeper globally.

If a trusted tester has verified the SHA256 and macOS still reports the beta as “damaged” only because of quarantine, the narrow fallback is:

~~~bash
xattr -dr com.apple.quarantine "/Applications/OWL LAB Desktop.app"
~~~

Do not run broad `xattr` or Gatekeeper-disable commands against the whole system.

## What first launch now does automatically

A clean Mac does not need Node.js, npm, the Runtime repository, or a manual Runtime installer.

Packaged Desktop now:

1. opens the Desktop UI;
2. installs the stable native **OWL Runtime.app** into `~/Applications`;
3. installs **OWL LAB Helper.app** into `~/Applications`;
4. verifies and extracts the bundled immutable Runtime release;
5. creates `~/.owl/current` and the local Runtime environment;
6. generates a local Runtime API token and stores the Desktop copy in OS-backed secure storage;
7. installs/reloads `com.owl.runtime` as a per-user LaunchAgent;
8. waits for Runtime API `0.1` health before continuing Cloud/MCP integration.

The private-beta safe defaults are:

~~~text
Allowed filesystem roots:
~/Desktop
~/Documents
~/Downloads

Write:
enabled

Delete:
disabled

Shell:
disabled

GUI provider:
enabled, but macOS permissions are still required
~~~

Runtime execution access itself remains fail-closed until the OWL Cloud account/device grant allows `canRun`.

## macOS permissions

To test desktop control, grant the permission-bearing native apps only the permissions needed for the test:

**OWL LAB Helper**
- Accessibility — required for clicks/typing.
- Screen Recording — required for screenshots/visual perception.

**OWL Runtime**
- Full Disk Access only if the test genuinely requires files that macOS privacy controls would otherwise block.

After changing a privacy permission, quit/reopen OWL LAB Desktop if the capability does not refresh immediately.

## First test checklist

1. Start OWL LAB Desktop.
2. Confirm Runtime becomes online and reports API `0.1`.
3. Sign in to the OWL LAB account through the system browser.
4. Confirm the device reaches a runnable/READY state.
5. Create/read a harmless test file under Desktop/Documents/Downloads.
6. Confirm delete remains blocked by default.
7. Grant Accessibility/Screen Recording to OWL LAB Helper and test one harmless GUI action.
8. Quit/reopen Desktop and confirm Runtime reconnects without reinstalling the permission-bearing apps.
9. Disconnect/reconnect network and confirm local Runtime stays alive.
10. Report any issue together with the visible Desktop activity log and the two Runtime log files below.

## Logs

Runtime logs:

~~~text
~/.owl/logs/runtime.stdout.log
~/.owl/logs/runtime.stderr.log
~~~

Desktop also exposes readable product/activity logs in its UI. Prefer those over raw internal traces when reporting an issue.

## Known beta limitation

This build is deliberately unsigned/unnotarized. Gatekeeper friction is expected.

The production release will add:

- Developer ID Application signing;
- signing of Desktop, Runtime Host and Helper under the same reviewed release chain;
- Apple notarization;
- signed clean-install dogfood;
- signed update/rollback rehearsal.

Those steps are intentionally deferred until the small friend beta proves product behavior.

## Uninstall / reset

Quit OWL LAB Desktop first.

To stop the local Runtime:

~~~bash
launchctl bootout "gui/$UID/com.owl.runtime" 2>/dev/null || true
~~~

Remove product apps/services:

~~~bash
rm -f "$HOME/Library/LaunchAgents/com.owl.runtime.plist"
rm -rf "$HOME/Applications/OWL Runtime.app"
rm -rf "$HOME/Applications/OWL LAB Helper.app"
~~~

Remove Runtime installation metadata/logs:

~~~bash
rm -rf "$HOME/.owl"
~~~

`~/.owl-runtime` contains durable Runtime state. Delete it **only** when the tester explicitly wants a full state reset:

~~~bash
rm -rf "$HOME/.owl-runtime"
~~~

Finally remove `/Applications/OWL LAB Desktop.app`.

## Release identities for this beta line

Canonical provider set:

~~~text
OWL Runtime main
d6320d29941fe0d4e94e28cf94c5eb9f1d1ab681

Runtime API
0.1

Runtime Host
fan.fde.owl.runtime @ 1.0.0

OWL LAB Helper
fan.fde.owl.helper @ 1.0.0

OWL Tunnel
0.0.15
vendor git a390c168ff1b2d14e73a95991c186c6aba3ff5a0
~~~

The exact Desktop commit and artifact SHA256 values are written into the generated friend-beta manifest for each private build.
