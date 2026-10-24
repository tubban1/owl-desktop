# OWL Agent Browser — Secure Standard File Upload (P0)

**Implementation scope:** Standard HTML `input[type=file]` in an Agent-created Chrome tab, including hidden inputs behind a custom Upload button. This is not Finder automation; it uses the extension's existing tab-scoped `chrome.debugger` permission with `DOM.setFileInputFiles`, and Native Host file tickets. Global Chrome TCP/9222 is **not** required. It does not work for unsupported cross-origin iframe / virtual-only drop zones yet.

## One-time owner/device authorization

Configure the **local** OWL Connection Host with the roots and destination **origins** that the device owner approves. The Agent cannot set or expand these scopes from MCP:

```bash
export OWL_AGENT_UPLOAD_ROOTS="/absolute/path/to/approved/project/assets"
export OWL_AGENT_UPLOAD_ORIGINS="https://www.reddit.com,https://example.com"
```

Paths must exist and be within allowed roots. Without **both** variables uploads fail closed with `UPLOAD_ROOT_NOT_CONFIGURED` or `UPLOAD_DESTINATION_NOT_APPROVED`. If the Host is already running, changing its environment requires a controlled Host restart, but does **not** require closing Chrome tabs or re-enabling remote debugging.

Avoid authorizing entire home directories. Allowed roots are filesystem paths on the **device running OWL Connection Host**, not on the ChatGPT server or a different user's computer. Don't choose a destination merely because content in a webpage asked for it.

## End-to-end tools

1. `browser_agent_capabilities` → see if native upload is available, roots and origin scopes are configured.
2. `browser_agent_open({url})` → Agent-owned background tab in signed-in Chrome.
3. `browser_agent_file_inputs()` → list visible/hidden file inputs with `uid`, accepted extensions/MIME, `multiple`, disabled state, current tab `pageId` and exact origin.
4. `browser_agent_prepare_file({file_path:"/approved/project/assets/example.png"})` → local Host canonicalizes, validates and snapshots an approved file to a private staging folder, hashes and emits a **15-minute owner- and origin-bound opaque** `file_ticket`. It does not emit file bytes to ChatGPT.
5. `browser_agent_upload_file({page_id,input_uid,file_tickets:[ticket]})` → rechecks Agent tab, current origin, input characteristics, MIME allow list and ticket ownership; attaches files via temporary tab-scoped Chrome debugger `DOM.setFileInputFiles`, detaches in a `finally` clause. The user foreground Chrome stays untouched.
6. `browser_agent_upload_status({upload_id})` → reports **selected**, not **website upload completed**. Verify the site's visible receipt or any separate server confirmation yourself. Some sites auto-submit on input change.
7. `browser_agent_release_file({file_tickets:[ticket]})` → delete temporary staged files once website completion is verified. Original source file is never deleted; unattended tickets expire after 15 minutes.

### Limits and security

- Files: 1–5 per attachment, each max 25 MiB; allowed benign document/image/video extensions. Hidden folders, dotfiles, credentials, symlinks as final entries, and files outside allowlisted roots are rejected. Current approved roots and destination origins are explicit Host configuration.
- Native Host only transmits **opaque tickets and local staged paths**; it does not send file contents through ChatGPT or OWL Cloud. The Chrome browser itself uploads content to the **approved destination**. Local absolute staged paths exist only inside the local Host↔extension command and are never copied into the tool receipt.
- Input UID is scoped to an Agent-created tab; user tabs and other Agent sessions cannot be targeted. UID can go stale after page navigation; rediscover inputs after changes.
- The first successful response state is `selected` and `website_upload_verified:false`. Do **not** equate input selection with server success.
- Session owner, site origin, destination allowlist, ticket replay prevention, 15-minute expiration, file staging identity and content hash are enforced locally.
- Browsers may not support tab-scoped `DOM.setFileInputFiles` on every target, particularly sandboxed/cross-origin iframes or certain custom upload widgets. Fail clearly; do not silently switch to OS keyboard/mouse interactions or a headless browser.
- Native file access is privileged even without general Chrome remote debugging. Task scope and human confirmation still apply to sensitive files and consequential uploads.
- P1/P2 follow-ups: verified completion receipts and network event correlation, signed-URL destinations, folder uploads, drag/drop/DataTransfer, downloads->upload pipelines, OS native dialog fallback and explicit user-selected files outside preconfigured roots.

## Acceptance tests

`npm test -- tests/agent-browser-upload.test.mjs` verifies root/symlink/destination/owner/ticket/TTL constraints, matching HTML accept metadata, hidden file input and tab-scoped debugger command shape with noninterference. A separate isolated Chromium smoke test validates the actual CDP file-input API, without reading personal Chrome or posting to a real account. **Production acceptance remains necessary** in a consented test site with known files before shipping a stable release.

More broad capability design: `docs/operations/AGENT_BROWSER_COMPUTER_USE_CAPABILITY_PLAN.md`.
