# OWL LAB Agent Browser — Native Messaging (macOS and Linux pilot)

Default **browser_agent_*** tools now control background tabs created by OWL in your existing signed-in Google Chrome through the **OWL LAB Agent Browser** extension and a Chrome Native Messaging host. Chrome's `Allow remote debugging` switch and TCP/9222 **are not required**. The old Chrome DevTools connection is available only when `OWL_CHROME_BACKEND=devtools` is set explicitly, while `browser_open` remains a separate isolated browser.

## First-time setup (requires user to install/authorize extension)

1. Start OWL LAB Connection Host with the new code (listening on 8790 and a token-protected local Native Messaging broker on 8795).
2. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the project's `chrome-agent-native/` folder. For a packaged release the same folder is under `OWL LAB Desktop.app/Contents/Resources/chrome-agent-native/`. **Review the one-time install permission prompt:** the extension requests site access, Native Messaging, scripting, tabs, and debugger (used only for screenshotting OWL-owned tabs). Chrome Web Store distribution and stable extension ID are a future packaging step.
3. Copy the 32-character extension ID displayed on `chrome://extensions`. Run from `owl-desktop` project root:
   `node scripts/install-chrome-native-host.mjs --extension-id <extension-id>`
   If working from a packaged app, invoke the copied installer under `Contents/Resources/native-messaging/` and pass `--node` and `--host-script` pointing to the installed Node binary and `Contents/Resources/native-messaging/native-messaging-host.mjs`. The installer only registers the exact chosen extension ID in Chrome NativeMessagingHosts; it does not change Chrome's global settings.
4. Reload the extension, click its toolbar icon and confirm **Connected to OWL Desktop**. If the connection is down, click Reconnect. The broker token stays in the current user's private OWL Desktop directory (chmod 0600); it rotates on Connection Host restart. Extension/native host reconnect automatically. There is no per-ChatGPT-session pairing code.
5. Turn off `chrome://inspect/#remote-debugging` if you no longer use the separate DevTools backend. It is not needed for Native Messaging.

## Agent interaction

- `browser_agent_open(url)` creates a **background** tab in the user's current Chrome profile, reusing Chrome's existing login state without extracting cookies.
- `browser_agent_tabs` and `browser_agent_use_tab(page_id)` enumerate and select only tabs owned by this OWL Agent Session. Existing human tabs and tabs owned by other Agents are excluded.
- `browser_agent_snapshot` returns visible text and element UIDs; `browser_agent_fill(uid,value)` fills ordinary text inputs only; `browser_agent_click(uid)` auto-clicks safe same-site navigation links. Account-security, destructive and payment actions and ambiguous button submissions stay manual in this pilot.
- `browser_agent_screenshot` uses `chrome.debugger` on that owned tab for a short JPEG capture, then immediately detaches. This does not require a global CDP port or foreground tab activation but Chrome may show a brief debugging banner.
- `browser_agent_focus_login` explicitly brings **only the Agent-created tab** forward when Reddit or an SSO login needs user CAPTCHA/2FA. The user signs in directly in Chrome, then the Agent continues in the same tab. No Agent may close another Agent's or the user's tabs.

**Security:** Native Messaging is not an authorization bypass. Chrome requires a local native host manifest with exact extension ID and approved extension permissions. The extension requests wide web host permissions because you asked for fully autonomous Agent-created tabs; users can revoke or restrict site access in Chrome at any time. Native host messages are length-framed and the loopback broker requires a private random bearer token. Site content and screenshots explicitly retrieved by an Agent may be returned to the invoking ChatGPT session. Never expose sensitive passwords or one-time codes to the Agent. The default installer on this branch supports macOS and Linux only; Windows installation is not implemented yet.

## Tests

`npx vitest run tests/native-messaging-bridge.test.mjs` tests message framing, private bearer authentication, strict owner and tab validation, screenshots, lifecycle and isolation. It does **not** replace acceptance testing with an installed extension in your actual Chrome. Do not claim production readiness before that acceptance has been completed.

## Tab reuse and foreground actions (2026-10-25)

- browser_agent_open(url) reuses an existing **inactive**, non-pinned, non-incognito tab only if its **complete URL matches**, including path, query and fragment. It does not take over tabs owned by another Agent Session. Otherwise it creates a new background tab. Reopening an already-owned target reuses that Session tab.
- A tab that the Agent selected and owns may be operated after the user brings it to the **foreground**. Safe virtual-cursor clicks no longer require tab.active=false. They do not activate/focus tabs or move the shared OS pointer. Sensitive actions remain subject to the same restrictions in either state.
- An already-open user tab adopted by exact URL is **released, not closed**, on browser_agent_close_tab. A new Agent-created tab is closed. Navigating an adopted tab to a different origin blocks subsequent Agent actions until release.
- Reload the installed Chrome extension after updating extension source. Unit tests are not an assertion of production acceptance.


## Scoped browser form submission (2026-10-25)

- \`browser_agent_form_controls\` inspects non-credential fields, including checkbox/radio labels and values.
- \`browser_agent_form_set\` selects a previously observed radio, checkbox or number field. Radio selection requires an exact \`expectedValue\`. This step does not submit.
- \`browser_agent_form_review\` checks the exact current application URL, required data, consent, optional retention and uploaded CV in the existing page.
- \`browser_agent_form_submit\` **requires a separately user-approved, single-use local OS grant** named \`OWL_AGENT_FORM_SUBMISSION_GRANT\`, readable by the trusted Connection Host. Grant JSON must contain \`pageUrl\`, \`salary\`, \`notice\`, \`referralValue\`, \`requiredConsent:true\`, \`optionalRetention:false\`, \`approvedByUser:true\`, and an \`expiresAt\` no more than one hour in the future. The first attempt consumes the grant in process, even if it fails. No automatic retries.
- The initial implementation deliberately supports only \`https://careers.axpo.com/jobs/*\`. No generic website submission capability or arbitrary credential/financial consent. Expand only with a separately reviewed, origin-scoped policy.
- Calling \`requestSubmit\` respects HTML validation and site submit handlers. A successful dispatch is **NOT** proof that the external server accepted the application; inspect the confirmation page or employer message.
- User-controlled OS configuration must be provisioned by trusted UI/user action outside Agent-authored web content. Review exact terms and do not grant optional personal-data retention without user consent.
- The browser extension and Connection Host must be restarted/reloaded to activate new tool handlers, while keeping unrelated Chrome tabs intact.

### Compatibility with existing MCP clients

While tool discovery is updating, existing `browser_agent_fill` can set an observed No/Yes radio, number or checkbox through the same Host grant checks; `browser_agent_click` on a submit input routes to the same reviewed one-use grant instead of disabling the generic safe-click rule. Ordinary links/fields retain their previous behavior. These compatibility actions require the updated Connection Host AND refreshed Chrome extension.
