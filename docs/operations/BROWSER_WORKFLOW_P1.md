# OWL LAB Agent Browser P1 — downloads, handoff and UI receipts

This is the follow-up to P0 secure upload. All actions run only on OWL Agent-owned background tabs inside the user's already-running Chrome profile. The implementation does **not** need global Chrome remote debugging port 9222.

## Chrome installation

The unpacked OWL Agent Browser extension requires the new `downloads` permission. The user needs to review the added Chrome permission and reload the unpacked extension once. Do not silently grant new browser permissions. No per-tab Companion pairing is needed.

## Tool sequence

1. `browser_agent_open({url})`, then `browser_agent_snapshot()` on the file source website (logged-in session reused).
2. `browser_agent_download_file({link_uid,request_id})`, using a previously observed **safe same-origin** link UID and a stable UUID idempotency key. Chrome saves under its ordinary downloads directory in the `OWL LAB/` subdirectory without focusing a file picker.
3. `browser_agent_download_status({download_id})` or `browser_agent_download_list()`. Each download ID is associated with the initiating owner. A repeated request_id returns the original download, not a second transfer. Interrupted downloads remain in their actual state. `browser_agent_download_cancel` cancels only an unfinished owned download.
4. Open another background Agent tab at the approved upload destination and select it with `browser_agent_use_tab({page_id})`.
5. `browser_agent_prepare_download({download_id})` gives a short-lived opaque file ticket. The local Host checks that the Chrome download really completed and that its real path is inside `OWL_AGENT_UPLOAD_ROOTS`; the selected destination origin must be in `OWL_AGENT_UPLOAD_ORIGINS`. Default is **deny** if not configured. Neither absolute path nor file bytes are disclosed to ChatGPT.
6. `browser_agent_file_inputs()` and `browser_agent_upload_file({page_id,input_uid,file_tickets})` attach the file using temporary tab-scoped Chrome debugger. The P0 result is `selected`, not site upload verified.
7. `browser_agent_verify_receipt({expected_text})` checks current destination webpage visible text. The only positive result is `ui_observed`: an observed UI phrase, **not** proof the site's server accepted or persisted the file. For sensitive uploads, inspect a distinct server receipt or use a confirmation API before declaring success.

## Boundaries

- `chrome.downloads.download` only accepts the URL from a link UID captured on the Agent's current tab. Same-origin and safe file extension are mandatory. Dangerous action paths are rejected. This is not a general fetch-any-URL API.
- The native download tracking lives in `chrome.storage.session`, making it resilient to Manifest V3 service-worker suspension but not necessarily full browser restarts. Agent ownership and request UUIDs are checked for every operation. The list excludes existing human/other-Agent Chrome downloads.
- Downloaded artifacts are not automatically trusted local files. The Host checks the exact source path and allowed destination; moving to another site never carries authorization automatically.
- The Chrome download folder may be customized by the user. To permit a download→upload pipeline, approve the actual resolved `OWL LAB/` download directory with `OWL_AGENT_UPLOAD_ROOTS` and the destination website with `OWL_AGENT_UPLOAD_ORIGINS`. Avoid approving the entire home folder.
- P1 webpage evidence intentionally uses `ui_observed` rather than a false `completed` server receipt. A future version may add signed server receipts or site-specific integration when supported.
- Standard input[type=file] and hidden inputs are supported by P0. Custom drag/drop, iframes, native Finder/Explorer dialogs, clipboard, OS automation and richer Computer Use are separate P2/P3 capabilities.
- macOS background browser DOM/API actions do not alter the foreground tab. A browser permission prompt for `downloads` may still require one human action.
- New permission `downloads` is not a reason to re-enable Chrome global Remote Debugging.

## Release verification

Unit tests cover retry deduplication, own-download listing, cancel, actual download state, private artifact handling and UI receipt classification. Chrome real-world acceptance requires a consented download→upload fixture, as user login, download settings, redirects and site-specific auto-submit behavior vary.

Relevant code: `chrome-agent-native/download-workflow.mjs`, `chrome-agent-native/agent-executor.mjs`, `connection-host/native-user-chrome-bridge.mjs`, `mcp/browser-workflow-tools.mjs`.
