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
