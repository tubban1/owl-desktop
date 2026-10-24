# OWL LAB Agent Browser P2 — execution and acceptance gate

Status: P2 development track opened; not production accepted. P1 live Chrome acceptance is a separate prerequisite for release.

## Safety invariants

- All actions require the existing stable Agent owner and target Agent-owned tab; never interact with arbitrary user Chrome tabs.
- Prefer DOM and local Native Messaging before OS GUI. Do not silently focus Chrome, modify its current human-selected tab, or ask for global TCP debugging (9222).
- New origin, cross-origin iframe, personal data destination, and new OS resource require explicitly scoped authorization. Never infer OS rights from extension installation.
- CAPTCHA, passkey, OTP, Keychain/UAC, security/privacy grants: human takeover, never bypass.
- Never upload raw local file bytes, absolute paths, clipboard contents, login credentials, or OS secrets to OWL Cloud telemetry.
- Verify postconditions separately: dispatching paste/drop/change events does not prove server receipt or persistence.

## Incremental implementations, each with fixtures

1. **P2-A Frame/shadow capability discovery:** recursively discover *open* shadow roots within owner-controlled document; disclose closed roots; inspect same-origin frames only when explicitly permitted. Cross-origin frames report `FRAME_ORIGIN_PERMISSION_REQUIRED` and must not be traversed implicitly. Snapshot stability uses origin/frame identity and stale-element rejection.
2. **P2-B Rich editors and keyboard:** controlled fill/selection/contenteditable with beforeinput/input semantics; common editor fixtures (plain, React, ProseMirror, Quill). Explicitly reject unsafe form submission and shortcuts that activate unrelated applications.
3. **P2-C Clipboard paste:** only after task-scoped clipboard read/write permission; protect previous clipboard contents; reject private data and non-owned tabs. Prefer direct editor APIs without global OS clipboard.
4. **P2-D Drag/drop upload:** use already authorized local file ticket; DOM DataTransfer may fail on untrusted events. Return `OS_GUI_REQUIRED` instead of fabricating success; no paths in receipts.
5. **P2-E Permissions/error router:** typed errors and capability probe, with least-privileged fallback sequence: DOM -> Chrome tab API -> Native Host -> OS Computer Use -> human takeover.

## P1 real-browser release gate (still open)

- Run **latest committed extension and Host**, not dirty local main or the older currently loaded extension.
- On real signed-in Chrome profile, use only Agent-owned background tabs; record original selected foreground tab and window and verify unchanged after each test.
- Exercise visible and hidden HTML input, multiple files, controlled editor, download->upload across allowed test origins, duplicate request, cancellation, status, failure/retry, filename collision, revocation and temporary artifact cleanup.
- Verify actual website/server receipt independently of the extension's selected-file result. Validate Chrome restart/disconnect and owner isolation.
- Never use live personal sites or upload private documents as fixtures.

## P3 dependency gate

OS file dialogs and native apps are deliberately outside P2. Require a per-platform permission matrix, macOS TCC/Accessibility and Windows UI Automation tests, explicit focus-impact warnings, takeover/resume tests and device-specific signed release packages before claiming P3 complete.

## Legacy Computer MCP routing

The legacy ChatGPT Computer MCP plugin remains installed for the **Windows** host. On Mac, do not run its old standalone launch agent or attach a second Computer MCP tunnel. The current OWL LAB tunnel and Mac development Runtime/Helper are separate from this Windows-only plugin and must not be deleted as a side effect.


## Verified 2026-10-25

- Isolated real Chromium Manifest V3 extension run: \`node scripts/verify-native-agent-p1-browser-live.mjs\`.
- Uses temporary profile/extension, local test origins and content-controlled files; does not reuse the personal Chrome profile or access production Tunnel.
- Verified real Chrome downloads, idempotent requests, per-owner isolation, local Host file-ticket staging and origin denial, hidden file input, cross-origin upload, independent fixture server body receipt, and foreground tab preservation.
- Playwright stores controlled downloads under opaque temporary names; test re-materializes the verified downloaded bytes under the original response basename before passing them to the actual Host upload broker. This is a test-environment compatibility step, **not** a general bypass of source-file permissions.
- P1 download link filename regular expression corrected after live test exposed an otherwise missed bug.
- P2 can now query capabilities and edit **plain** contenteditable controls; it refuses framework-managed ProseMirror/Quill/Tiptap/Slate/Lexical editors. Returns DOM confirmation, never a false server-persistence claim. Empty/undefined injected-script results fail closed.
- Full desktop automated suite: 107 files / 483 tests passed; TypeScript and production Vite build passed.
- **Not yet proven:** the user's already running signed-in Chrome with the updated unpacked extension and Native Messaging, cross-browser restart/disconnect recovery, OS dialogs, macOS/Windows P3, and third-party production sites. Do not report those as passed.

- P2 open Shadow DOM: browser snapshot recursively discovers visible controls in open roots (bounded depth 8 and 120 controls), with owner-scoped fill/edit. Isolated Chromium verifies both actions, excludes closed roots and never traverses cross-origin iframe content. Framework-managed editor mutations remain gated.
