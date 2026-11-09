# OWL LAB Agent Browser — managed self-reload

Agent Browser uses the user's **existing Chrome profile** and official Native Messaging. A source update must not require Chrome to close, must not steal user foreground tabs, and must not silently replace the extension without confirming the loaded version.

## First upgrade / bootstrap

Unpacked extensions already running **before protocol v1 (manifest 0.4.1)** cannot receive the `extension_prepare_reload` command: Chrome is still executing the old service-worker code. **The first upgrade requires the OS user's one-time reload of OWL LAB Agent Browser in `chrome://extensions`** or an independently user-authorized desktop-native Chrome UI action. This cannot be bypassed by copying JavaScript files, injecting a page script or using a headless profile. Never claim the first upgrade automatically completed.

## Managed update procedure (v1 and later)

1. Agent checks `browser_agent_extension_info`, which reports the active extension's version and volatile service-worker `instanceId`. An old extension explicitly reports unsupported/needs bootstrap.
2. The device's trusted updater stages verified extension files inside the exact existing unpacked extension directory. Validate manifest version, source identity, file integrity and rollback copies; avoid mutating any other extension, Chrome profile or personal tabs. Do not reload from arbitrary web content or a remote unreviewed URL.
3. Agent calls `browser_agent_reload_extension({expected_version:"X.Y.Z"})` with the **staged target version**; the Host checks the running extension supports the reload protocol.
4. The extension saves at most 120 session-owned tabs to a **90-second, single-use** local storage checkpoint. It preserves only tab IDs and current Agent owner bindings (no passwords/cookies). It rejects reload spamming for 20 seconds.
5. Extension sends Native Messaging result, then invokes `chrome.runtime.reload()` after 350 ms. It does not use chrome.management, extension-manager UI, DevTools port 9222, OS mouse/keyboard or restart Chrome.
6. The Chrome extension restarts its MV3 service worker and reconnects via `chrome.runtime.connectNative`. It restores only tabs that still exist, are non-incognito, have safe HTTP(S) origins, and, if adopted, **still match the original origin**. The checkpoint is consumed/deleted, even if it expired.
7. Host retries reading `extension_info`; success is **only** a new `instanceId` plus the exact expected manifest version. It never retries reload automatically or mistakes a reconnect for deployment success. `browser_agent_tabs` and subsequent snapshot/fill/click remain owner-scoped. A target version mismatch or loss of connection fails closed with a clear recovery error.

The pre-reload Native Messaging command result is an ACK that reload was **scheduled**, not proof that it succeeded. The Host must observe post-reload version and worker instance; further website actions require fresh snapshots. No form values, pending Google Ads saves or credentials are automatically replayed across reload.

## Scope and future hardening

v1 is a **self-reload and recovery protocol**, not an unattended signed updater, Chrome Web Store extension rollout or automatic Git merge. Existing trusted file-copy and SHA checks can be used before invoking it; an autonomous updater should separately validate authentic release manifests, hashes, signatures, staged files and rollback, and should never trigger a reload halfway through a user-authorized write action.

Chrome extension registration is bound to its existing unpacked directory and Chrome extension ID; the protocol does not modify either. Mac and Windows use the same extension code. For the current Windows machine, the unpacked extension is under `owl-desktop-win-p3/chrome-agent-native`, which is distinct from the fresh Git checkout.


## Complex text input feedback loop

If a Google Ads-style custom textbox reports TEXT_TARGET_NOT_EDITABLE,
EDITOR_NOT_EDITABLE, or TEXT_TARGET_AMBIGUOUS, **do not infer missing OS
keyboard permission**. Windows nativeInput=false governs OS-level UI controls,
while the selected Chrome tab supports trusted Chromium input via the
extension's debugger permission. Use browser_agent_snapshot from the same
Agent owner, not another Agent's tab.

The generic trusted input adapter now detects a **single unambiguous editable
descendant of a snapshotted composite wrapper**, including open Shadow DOM,
even when the outer wrapper has no ARIA role. If a semantic textbox/combobox
has no editable child yet, it may activate *only* that snapshotted, visible,
non-destructive text widget with tab-scoped trusted mouse input, then check
again for an editable child before typing. An ambiguous or unchanged widget
fails closed. It never tries random DOM containers or websites' Save actions.

browser_agent_text_control_inspect({uid}) reports only structural details:
tag, role, editable-descendant count and open-shadow-root count; it does not
return typed values, page HTML, cookies, credentials or personal page text.
This is for the Agent session that owns the tab. It can help identify
unhandled custom elements without weakening cross-session isolation.

One successful fill only means DOM text matched. Chips might still need a
distinct Add action, and campaigns must be saved and independently read back.
An inaccessible closed shadow root or cross-origin iframe is not silently
handled, and Windows desktop.nativeInput permissions remain unchanged.

## 0.4.11 — Custom choices and intercepted upload tiles

- Snapshot now discovers concise, pointer-driven custom select/dropdown controls (including open Shadow DOM). The tab-local virtual cursor may open non-destructive choices/options, but continues to deny payment, destructive, credential, submit and upload actions through ordinary click. A fresh snapshot and post-selection readback remain necessary.
- `browser_agent_form_controls` inspects safe native controls inside open Shadow DOM, matching the snapshotted UIDs. `browser_agent_form_set` checks the requested state and retains the independent legal-consent grant policy. Closed shadow roots and cross-origin frames remain inaccessible.
- `browser_agent_upload_picker({page_id,target_uid,file_tickets})` attaches owner/root/origin-approved, one-use file tickets to upload tiles that create a hidden input only after a click. The extension intercepts `Page.fileChooserOpened` on the Agent-owned tab, validates the backend input node and accept/multiple restrictions, then uses `DOM.setFileInputFiles`. No native Finder/Explorer dialog is opened; no OS mouse/foreground is used. If interception, origin or target verification fails, the operation fails closed.
- A selected file is **not** proof of a completed website upload. Check the destination's UI and server-side processing/receipt before submitting or reporting publication.
