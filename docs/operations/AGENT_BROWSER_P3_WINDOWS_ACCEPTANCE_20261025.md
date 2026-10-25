# Agent Browser — Windows P3 evidence, 2026-10-25

Windows host: Windows 10 x64 build 19045, Node 24.21.0, Chromium for Testing 141, Computer MCP v0.8.0. Windows OWL LAB not previously installed.

## Verified on this Windows computer
- Cloned a separate checkout in the Computer MCP allowlisted workspace without disconnecting legacy Computer MCP.
- npm ci and npm run build completed successfully.
- Installed Electron 38.8.6 binary and launched a responsive OWL LAB Desktop developer-preview window with Vite HTTP 200.
- Real isolated Windows Chromium Manifest V3 agent workflow passed: owner-scoped background tabs, trusted tab-local virtual cursor click, foreground human control yielding, blocked consequential buttons, native file chooser interception, file download, secret-protected and owner/origin-bound staging, hidden file upload, cross-site file drop, and independent fixture backend receipt.
- Corrected Windows path and ACL semantics: Windows staging root restricts SID-based DACL entries to current user, SYSTEM, Administrators, rejects inherited/unexpected ACEs. Never treat POSIX chmod as proof of Windows privacy.
- Scoped Windows browser/upload unit suites passed 10/10. Symlink escape cannot be exercised by a non-admin Windows account if symbolic-link creation is denied.

## Outstanding Windows product gates
- Baseline complete Windows unit suite: 456 passed, 26 failed, 1 skipped (macOS-specific processes, ACL/permissions, tunnel, launchd and filesystem test assumptions). Do not present as green.
- Windows Desktop currently runs only as developer preview, not signed installer; vendor owl-runtime, runtime-host and native helper components were absent from this source checkout.
- Windows Computer MCP shell/filesystem works, but Windows GUI desktop provider is unavailable. Native Windows Explorer picker and human takeover/resume were NOT proven via an OWL Windows Helper.
- Windows Chrome Native Messaging installer/launcher, packaged Runtime/Tunnel and Windows Helper are not complete; tests used isolated Chromium, not the personal Windows Chrome profile.
- Windows Cloud registration / stable OWL Tunnel not configured by the source preview.

Remaining acceptance: produce Windows-native signed Runtime/Helper and installer, establish user-authorized Cloud enrollment, test native Explorer picker and takeover/resume, then verify release packaging. Keep Windows Computer MCP connected until OWL Windows reaches parity.
