# Agent Browser: one Chrome, cross-platform version parity

## Default transport
- `browser_agent_open` and compatibility `browser_open` use **the user's existing Chrome** via Native Messaging, with an Agent-owned background tab. They never use TCP/9222, a second Chromium process, or steal the user's foreground tab. An exact-URL **inactive** human tab may be adopted by the authorized Session; it is released, not closed. Tabs of another Agent/foreground human tabs are not adopted.
- `browser_open({mode:"isolated"})` explicitly starts independent Chromium. `headless:true` is also an explicit isolated request, incompatible with `mode:"chrome"`.
- `browser_list_tabs`, `browser_use_tab`, `browser_close`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_screenshot` use the same owner-scoped mode selected for that Session. Native Chrome controls use observed `owl-agent-N` UIDs, **not arbitrary CSS selectors**. Native mode never submits unreviewed forms, impersonates a human login, or saves a screenshot to a requested local path without saying so.
- If Native Messaging is offline, generic browser operations **fail closed**; they never quietly spawn a second browser. First run `browser_agent_status` / `runtime_info` and fix the connection.

## Source identity
- `npm run verify:agent-browser-parity -- --active-root <verified-active-release>` performs a **read-only** source check against the live user Chrome installation and Native Messaging registration, and checks *18* extension assets, not only the version string.
- There are **two independent fingerprints**: committed extension source assets and MCP `runtime_info.mcpToolSurface.catalog.namesSha256`. Both Mac and Windows must match the same release. ChatGPT's previously published plugin subset can remain stale even if the source tool catalog matches; reconnect/refresh the MCP plugin to republish the tools, then verify a live `browser_agent_status` call.
- Do not overwrite a dirty Chrome extension directory or force its reload while a human has active tabs. Retain the old installed path as rollback; defer extension source migration if dirty.

## Native Host lifecycle
Native Messaging host differs only in bootstrap: macOS uses `owl-native-message-host.sh`, Windows uses `owl-native-message-host.exe`. Their *actual JS host source* is shared. The broker remains localhost-only with private configuration. Native Host child lifecycle belongs to Chrome; never kill Chrome or replace the binary used by a running process during stage/preflight.

**One machine at a time, after verified activation and healthy Runtime/MCP/Tunnel:**

macOS (check by default):
```bash
node scripts/reconcile-mac-native-host.mjs --mode check --active-root "$RELEASE" --expected-sha "$SHA"
node scripts/reconcile-mac-native-host.mjs --mode apply --active-root "$RELEASE" --expected-sha "$SHA"
```
The installer stages the wrapper atomically and saves the previous wrapper for rollback with `--mode rollback`. This updates **only the next Chrome Native Messaging launch**, not the already-running process.

Windows (PowerShell; `Check` is read-only):
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/reconcile-native-host.ps1 -Mode Check -ActiveRoot $Release -ExpectedSha $Sha
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/reconcile-native-host.ps1 -Mode Apply -ActiveRoot $Release -ExpectedSha $Sha
```
The Windows installer stages a **new, version-qualified launcher directory**, tests rejected origins before changing the HKCU NativeMessagingHosts pointer, and retains the old launcher for rollback (`-Mode Rollback`). It never overwrites an in-use EXE.

Do not apply a Native Host source update before the independently verified version cutover. The version-sync coordinator owns scheduling, preflight, single-device activation, rollback and browser extension reload. The release checker is read-only and may return a drift warning before the planned cutover.

## Acceptance
1. Same runtime `sourceCommit` and MCP catalog SHA on both devices.
2. Same extension 18/18 asset checks, version, expected Chrome origin, and current Host JS content hash; Host registration points to the promoted immutable release.
3. `browser_agent_status.connected=true`, `browser_agent_extension_info.version` equals the promoted extension version, no pending in-flight requests.
4. Open `https://example.org` in one background Agent tab; keep existing Chrome PID, window count and foreground tab unchanged. Verify Agent tab isolation and release/close semantics.
5. `browser_open` without `mode` uses Native Chrome; `mode:"isolated"` may create separate Chromium only if explicitly requested.
6. After Chrome extension restart/host rebind, verify one Native Host process per extension worker, healthy broker reconnect, and actual snapshot + harmless click. Never lose the other device's MCP.
