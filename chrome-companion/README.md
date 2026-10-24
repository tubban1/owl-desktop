# OWL LAB Chrome Companion — local opt-in computer use

OWL Chrome Companion uses your normal Chrome login session but only accesses user-approved sites. It never copies cookies or automatically attaches to your unrelated tabs. The Agent can create its own background tabs on an explicitly approved website.

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
- Chrome permissions: activeTab, scripting, storage, alarms, tabCapture, offscreen, and localhost host permission. **Optional** host patterns support per-site Chrome permission prompts only when the user presses the Agent site-authorize button. No debugger or cookies API; no automatic wildcard website access.
- Form fills reject password, hidden, and sensitive auto-complete controls. Clicking requires an additional per-action human confirmation; some obviously destructive labels are blocked, but this is not a complete policy engine for arbitrary websites.
- Screenshot requires user-initiated tab capture. It is not an automatic capture of all Chrome tabs. Video-only, bounded JPEG width.
- Chromium 145 headless extension load and local pairing are verified. Live attachment + tabCapture and real Reddit saving require a human-operated Chrome acceptance check; do not call this production-equivalent to Codex yet.
- No Chrome Web Store published extension or automatic end-user rollout yet.

## Development verification

- npm test
- npm run build
- node scripts/verify-chrome-companion-live.mjs (Playwright Chromium 145, disposable profile)

## Agent-owned background tabs in your existing Chrome

This is the new opt-in flow for longer browser work, separate from the earlier two-minute single-tab read grant:

1. Sign in to a website normally in Chrome (Reddit, for example). Your existing Chrome session/cookies are reused by **new tabs from the same Chrome profile**; OWL never exports or reads cookies.
2. After pairing Chrome Companion with OWL MCP, open that website and click **允许 Agent 操作此网站** in the extension. Chrome will request host permission for **this website** (not all websites). The working grant lasts up to 30 minutes; the connection itself still expires after 15 minutes unless re-paired.
3. The agent may call `browser_companion_open({url})`, `browser_companion_agent_tabs`, `browser_companion_use_agent_tab({tab_id})` or `browser_companion_close_agent_tab({tab_id})`. It can open up to ten **new** background tabs on the approved origin without selecting the human's foreground tab. It cannot select or close existing human tabs.
4. Subsequent `browser_companion_snapshot`, `browser_companion_fill` and `browser_companion_click` act on the agent's selected tab. Filling normal text fields is allowed by the site grant; each click/save remains subject to an explicit user confirmation in the extension (pending request ID), followed by verification of the saved result.
5. If a page redirects to a different origin (e.g. SSO login), OWL stops injecting scripts and reports that human login is required. Click **接管登录 Agent 标签页** in Companion **when you choose** to bring the agent's tab forward, authenticate, then switch back to your own tab. When the page returns to the approved origin, OWL can resume on the **same tab**. No browser passwords or OTPs are extracted.
6. On an agent-created tab, Chrome's `tabCapture` screenshot still requires the user to bring that tab forward once and explicitly activate capture. After capture starts, screenshots can continue while the human uses other tabs. For automatic screenshots with no capture gesture, use OWL's separate managed Playwright browser, which already supports background screenshots.
7. Click **撤销 Agent 网站权限** to remove the site's Chrome host permission and drop OWL's agent tab ownership, without closing human tabs. Other sites are never implicitly authorized.

Security: `optional_host_permissions` allows Chrome to ask for one website when the user clicks, rather than silently granting every website. The extension does not gain debugger/cookies privileges, cannot read a new tab at an unapproved origin and refuses account-destructive click labels. Page text/screenshots explicitly requested by OWL still return to the invoking ChatGPT conversation.

### Activation

The new tools are in both Desktop and Runtime MCP source. Deploy the updated source/build for **both** services, then restart the relevant MCP/Connection Host services only when no other Session is performing work. Reload the unpacked Chrome extension from `chrome://extensions`, then re-pair if the old extension link expires. Restarting macOS or the Chrome browser application is not necessary.
