# OWL LAB Windows status — 2026-10-25

## Verified on Windows 10 x64 via the existing Computer MCP

- OWL Desktop source build passed and Electron developer window opened; isolated Chrome P1/P2/P3 including trusted tab-local cursor and backend-confirmed file upload passed.
- Pinned OWL Runtime 1.0.0-rc.4 (SHA 45749cfb72223915e86f8f1ed30604cd1c386d84) built and ran on 127.0.0.1:8788 in production mode with writing, shell, GUI, delete, and browser permissions disabled.
- Authenticated Runtime RPC (info) succeeded with a protected test token; OS-encrypted OWL Desktop secret record was created without storing plaintext.
- Windows Chrome Native Messaging EXE built from C# and tested with real binary-framed stdio, exact extension origin rejection, a valid manifest, and user-restricted ACL, in isolated SkipRegistration mode with no browser registry changes.
- Windows 10 scoped upload/install tests: 10/10 passed. Baseline complete Windows test suite previously: 456 passed, 26 failed, 1 skipped.

## Release commands

- npm run verify:windows:native-host — isolated fixture that compiles Windows EXE and verifies message framing, without registering a Chrome host.
- npm run verify:windows:release — fail-closed preflight checking for the Windows runtime, runtime node, runtime host, GUI helper and Tunnel files. Passing this presence check is NOT a signature or full release guarantee.
- scripts/windows/install-chrome-native-host.ps1 — opt-in per-user HKCU installer. Actual registration requires a valid live Connection Host broker config and approved exact extension ID; do not install it against dummy broker configs. Production needs reviewed/signed packaging. No Chrome DevTools remote debugging or 9222 is needed.

## Blocking full Windows release

1. Desktop-to-Runtime secret retrieval remains defective in the Windows Electron developer preview: the Runtime authenticated RPC passes, yet Desktop requests still report HTTP 401. Do not bypass authentication.
2. Bundle pinned native Windows Runtime Node, Runtime Host, GUI Helper and Tunnel. Configure signed installer, auto-start, supervision, restart recovery, upgrade and rollback. A running developer preview is not a production install.
3. Windows Explorer native file picker and GUI automation require the actual Windows Helper and human takeover/resume testing. Isolated Chromium tests only cover browser-level control.
4. Fix remaining Windows full-suite failures, add Windows CI, and validate Cloud account/device enrollment and durable MCP.
5. Preserve the old Windows Computer MCP until Windows OWL LAB passes all gates.
