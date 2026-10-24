# OWL LAB Chrome Companion — local opt-in computer use

This is the initial, manually installed Chrome Companion integration for OWL Desktop / Connection Host. It never copies cookies or automatically attaches to everyday Chrome tabs.

## How to enable

1. Update OWL Desktop / Connection Host to a build containing this code. The original Host must restart once to load the new local broker and MCP tool registry. Do this after other live MCP sessions finish; it briefly disconnects them. OWL Runtime itself does not need restarting.
2. In regular Chrome, open chrome://extensions; enable Developer mode and choose Load unpacked; select the owl-desktop/chrome-companion directory. There is no need to restart Chrome or log out of Reddit.
3. In ChatGPT with the connected OWL LAB MCP, request the browser_companion_pair tool; it returns a 16-character, single-use code valid for 15 minutes.
4. In the signed-in Reddit/website tab, click the OWL Chrome Companion icon, type the code and click 连接 OWL LAB, then 授权此标签页（2 分钟）. The agent can now call browser_companion_status or browser_companion_snapshot.
5. To fill a normal non-password field, you must also click 允许填写表单. Then the agent uses browser_companion_fill with a CSS selector. This operation does not submit.
6. To save, the agent calls browser_companion_click, which immediately returns a pending request ID. The extension displays a badge (!); YOU MUST reopen it, review the origin, actual button label and selector, then click 我确认，执行点击. The agent checks browser_companion_action_result with that ID; only a done=true, ok=true result is a successful click. Then re-read the page to confirm it actually saved.
7. For agent screenshots of this same tab in the background, while this authorized tab is selected, explicitly click 开启此标签页后台截图. This starts tabCapture video in an offscreen extension document; you may then browse other tabs. The agent calls browser_companion_screenshot to receive a compressed JPEG. Stop the stream by clicking 停止截图 or 撤销网站授权.
8. Re-authorize when the 2-minute site grant expires, or after navigating to a different site. The pairing lasts up to 15 minutes; use 断开配对 to revoke it immediately.

## What needs restarting

- OWL Connection Host: YES, once after the new code is deployed. Plan a controlled restart because active ChatGPT/Cloud MCP sessions disconnect momentarily.
- OWL Runtime: NO, it has no dependency on new Runtime code from this integration.
- OWL Desktop UI: not inherently necessary if the Host is restarted independently; a new packaged install normally requires reopening Desktop.
- Google Chrome: NO. Load the extension in chrome://extensions; after later extension code changes, click its Reload control.
- ChatGPT: may need to reconnect OWL LAB or create a new chat to refresh available MCP tool names.

## Security and limitations

- The extension pairs locally with the broker bound to 127.0.0.1:8794; an extension origin and one-time pairing code are required. The extension does not copy cookies or export credentials. **When an OWL agent calls snapshot or screenshot tools, selected page text/images are returned through the OWL MCP connection to the invoking ChatGPT conversation (which may use the Cloud/Tunnel).** Do not authorize tabs containing secrets or data you do not want shared with that agent.
- Chrome permissions: activeTab, scripting, storage, alarms, tabCapture, offscreen, and localhost host permission only. No debugger, cookies, or wildcard website access.
- Form fills reject password, hidden, and sensitive auto-complete controls. Clicking requires an additional per-action human confirmation; some obviously destructive labels are blocked, but this is not a complete policy engine for arbitrary websites.
- Screenshot requires user-initiated tab capture. It is not an automatic capture of all Chrome tabs. Video-only, bounded JPEG width.
- Chromium 145 headless extension load and local pairing are verified. Live attachment + tabCapture and real Reddit saving require a human-operated Chrome acceptance check; do not call this production-equivalent to Codex yet.
- No Chrome Web Store published extension or automatic end-user rollout yet.

## Development verification

- npm test
- npm run build
- node scripts/verify-chrome-companion-live.mjs (Playwright Chromium 145, disposable profile)
