# OWL LAB Chrome Companion — experimental opt-in tab pilot

This prototype is intentionally **not a production bridge to OWL Runtime**. Do not distribute or install it as an automatic update. It is a permission and non-interference milestone only.

## How the pilot works

1. Manually load the `chrome-companion/` directory as an unpacked extension on a test Chrome profile.
2. Open a permitted HTTP(S) website, click the OWL LAB Chrome Companion toolbar icon, then choose **Attach this tab**. The `activeTab` permission applies only following this explicit user gesture.
3. The extension grants temporary access to exactly that tab for up to 2 minutes, and can **Inspect** the tab's limited text/control inventory even if the user moves to another tab. It does not bring the tab to the foreground.
4. Choose **Disconnect** to revoke. Leaving the authorized origin, closing the tab, or expiration also invalidates access.

## Privacy limits

- The extension has **no host_permissions, cookies, debugger, tabs, or network permissions**, and performs **no fetch/WebSocket/remote upload**. It does not automatically submit forms, post messages, read form values or export cookies.
- Its local popup displays only bounded page text and control labels (5,000 characters and up to 50 controls), and does not include input values. Do not inspect sensitive pages during manual tests.
- The prototype **does not yet support screenshots or website edits**. Chrome's `debugger` API cannot be requested as an optional permission in current Chrome, and using it would require a broad install-time warning. Any future background screenshot feature must have a separately reviewed, explicitly consented capture design.
- No existing personal Chrome profile, browser data or logged-in site is accessed by OWL automatically. It requires a click in that Chrome window.

## Before real OWL integration

Implement a local-only authenticated companion transport, an explicit Desktop per-site/tab consent surface with visible revoke and audit, Runtime-approved action routing rather than raw remote evaluation, and screenshot verification without disrupting human browsing. Test against authenticated sites in a consenting test account only. External effects should remain behind standard OWL Runtime approvals.

`npm test` includes the companion policy tests with mocked Chrome APIs. A real Chrome extension installation/screenshot regression is a separate release gate.
