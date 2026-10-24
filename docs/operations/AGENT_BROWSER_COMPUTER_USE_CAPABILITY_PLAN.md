# OWL LAB — Unified Agent Browser + Computer Use capability plan (2026-10-24)

Status: **design only** for file upload / download / OS fallback. No upload tool has been implemented in this change. The current Agent Browser contains `open`, `tabs`, `use`, `snapshot`, `fill`, `click` (safe links only), `screenshot`, `focus_login` and `close_tab`.

## Product outcome

A user describes an outcome once; OWL chooses the **least intrusive, authorized execution channel** and continues without unnecessary per-click approvals. It may operate its own tabs in the user's signed-in Chrome without stealing foreground focus. When a task enters a different permission boundary (filesystem, operating-system window, hardware device, authentication), OWL should request a targeted grant or human takeover and then resume the same task.

The system is not "Browser vs Computer Use". It is a **capability router** shared across Browser/Native Host/Desktop Runtime/Cloud.

```text
ChatGPT / OWL Agent (intent, task-scoped authorization, progress)
    -> Action Planner + Capability Router
        -> Browser DOM / Chrome extension (owned tab, site grant)
        -> Chrome privileged APIs (debugger scoped tab, downloads, etc.)
        -> Native Messaging Host (local files, limited temp storage, hashes)
        -> OS Computer Use (accessibility, screenshots, dialogs, apps)
        -> Human Takeover (login, CAPTCHA, passkeys, sensitive approval)
    -> Unified result/receipt -> independent postcondition verification
```

**Ownership:** Agent tab/page IDs are owner-scoped, but the browser debugging permission itself is powerful. Do not expose raw debugger APIs or arbitrary existing-tab IDs. OS resource permissions are independent and must never be inferred from browser authority.

## Capability matrix

| Scenario | First choice | OS/native permission | User involvement | Fallback |
|---|---|---|---|---|
| Navigate, read, ordinary text input | DOM/content scripts on owned tab | Chrome extension site permission | Initial installation only | Vision/Computer Use |
| Safe same-site link | DOM link click | Chrome site permission | Usually none | Visual click |
| Save, publish, send, purchases | Browser DOM | Web permission; action-scoped policy | Confirm if outside authorized task / sensitive | Human |
| **HTML file input (including hidden input)** | Browser debugger `DOM.setFileInputFiles` on owned tab | Native Host file broker + Chrome debugger | Task-scoped local file grant | File API/DataTransfer |
| HTML file input when debugger unavailable | Native Host reads/chunks bytes to extension, creates local `File` + `DataTransfer`; dispatch change | Only approved local file; extension site permission | Task-scoped grant | OS file picker |
| Drag/drop upload / directory drop | DOM DragEvent / DataTransfer if site accepts | File broker and site grant | None for approved task | OS pointer/drag via Computer Use |
| Browser opens Finder/Windows file picker | Prefer avoid by targeting input directly | macOS Accessibility/Files & Folders, Windows UI Automation | Human only for denied OS permission | OS GUI fallback |
| Download attachment | `chrome.downloads`, or local native download broker | Downloads extension permission; local destination scope | Approve untrusted path/overwrite | OS save dialog |
| Download then upload to another site | Local artifact ticket, hash, download/upload receipts | Download + local file scope + upload destination authorization | Confirm destination if not included in task | Agent handoff |
| Paste images / files | Page-controlled input; clipboard API only if justified | Chrome `clipboardRead/clipboardWrite` or OS clipboard | Grant only when needed | OS keyboard |
| OAuth popup / cross-origin iframes | Browser-owned popup/tab with explicit owner tracking | Site permission for new origin | Human SSO if prompted | Login handoff |
| Passkey, WebAuthn, OTP, CAPTCHA | Human takeover | OS security hardware / system UI | **Always human** | Never bypass |
| Camera/microphone/location/screen share | Chrome + OS origin/device prompts | macOS TCC / Windows privacy, Chrome site grant | User approves browser/system request | No silent grant |
| Print, PDF export, Save As | Browser PDF generation or downloads when possible | Printing/download permissions | Print device/overwrite approval | OS print/save dialog |
| Native app launch, external protocol, drag to Finder | Desktop Computer Use | macOS Accessibility/Automation or Windows UIA | Conditional | Human |
| OS file permissions, UAC, Keychain/security prompts | Human | TCC/UAC/admin boundary | **Always human** | Stop + resume |

Chrome debugger's `DOM.setFileInputFiles` command supports file input node handles and absolute file paths; Chrome's extension `debugger` API is a privileged tab-bound CDP transport. Chrome Native Messaging **native-host -> extension** has a **1 MB per-message cap**, so large file contents must never be encoded as one response; use a file-path protocol or small chunked transfer, not cloud proxying.

## Proposed local file capability

### Secure user-facing tools

```ts
browser_agent_file_inputs({page_id?})
// Only inputs in the invoking Agent's current tab; reports UID, accept, multiple,
// disabled, hidden, current origin, known associated upload button.

local_file_prepare({
  source: {kind: "workspace_path" | "download_artifact" | "user_selected", value: string},
  destination_origin: string,
  purpose: string
})
// Returns short-lived opaque file_ticket plus basename, size, MIME, hash,
// authorized origin and authorization state. Never returns file contents.

browser_agent_upload_file({
  page_id: number,          // owned page only
  input_uid: string,        // current snapshot UID; may be hidden input
  file_tickets: string[],   // opaque, owner/device/task/origin bound
  submit?: boolean          // default false; do not claim server upload merely on selection
})
// Returns {state:"selected"|"transferring"|"complete"|"requires_human"|"failed",
//          page_id, file_names, bytes, method, destination_origin, receipt?}

browser_agent_upload_status({upload_id: string})
// Check DOM/network/user-visible receipt and optional server response; classify uncertainty.
```

P0 convenience `browser_agent_upload_file({page_id, input_uid, file_path})` may be provided only for local, already-approved workspace roots. Internally exchange the raw path for an opaque ticket first. ChatGPT Cloud should not receive arbitrary local file bytes or unrestricted filesystem access.

### Local file broker safeguards

1. **File is on the target device**. Cloud/Agent transmits intent and opaque tickets only; actual bytes are moved locally from Native Host to the user's Chrome/site. Explicit user-selected files may be allowed outside preconfigured project roots; do not treat all of `~/` as allowed.
2. Resolve `realpath`, symlink and hardlink target; require approved project/download roots or a native user-picked file. Block OS secrets, credentials, private key files, identity/keychain material and forbidden paths. Check readable regular file, size caps, MIME/signature, allowed extensions and web form `accept`/multiple flags. Open with constrained file handles and revalidate immutable identity/hash to avoid time-of-check/time-of-use substitution.
3. Produce an **opaque one-time/short TTL ticket** bound to device, stable Agent owner, task, page, origin, full file path identity, hash and size. Ticket is not a bearer grant for other Agent Sessions.
4. Confirm task scope and actual **upload destination**. A DOM input `change` may immediately transmit the file without pressing Submit; consider attaching a file an externally consequential action. Destination redirects/S3 presigned endpoints need verified purpose or new authorization.
5. Choose implementation:
    - Preferred for local paths: tab-scoped Chrome `debugger.attach` + DOM node resolution + `DOM.setFileInputFiles` + `detach` in `finally`; verify input events and site response. This does **not** turn on global TCP 9222 and does not require focusing Chrome.
    - Fallback: local Native Host streams bounded, base64 chunks to extension; content script builds `File` / `DataTransfer`, assigns input files and dispatches `input` and `change`. Never send large base64 blobs through the 1MB Native Messaging host->Chrome message limit. Manage memory and cancel/retry behavior.
    - Special custom drop zones: synthetic DOM drag/drop *only if validated*. Many frameworks require trusted events, so use OS-level drag/drop when genuinely necessary; not guaranteed background-safe.
6. Return **selection result**, then separately verify **server completion** from page receipt, form state or network response. Never report "uploaded" just because `input.files` contains the file.
7. Redact absolute paths, tokens and file content in ChatGPT/tool logs. Return basename, size, SHA-256 prefix and upload receipt/status instead. Discard temporary buffers and tickets.

### State machine

`discovered -> awaiting_file_authorization? -> prepared -> attaching -> selected -> uploading -> verifying -> completed`

Side states: `needs_login`, `needs_browser_permission`, `needs_os_permission`, `needs_human_confirmation`, `retryable_failure`, `cancelled`.

For task-allowed routine file transfers, the Agent should proceed without prompts. Escalate only when selecting files outside a granted workspace, discovering a new recipient/origin, submitting personal/sensitive files, or crossing into OS and authentication permissions.

## Computer Use execution model

Do not make Computer Use the default for HTML file input. It is the **privileged fallback** for UI that DOM/extension/native host cannot reliably automate.

- **Browser lane**: offscreen/owned Chrome tabs, snapshot, navigation, selectors, screen capture, file input, downloads, clipboard API.
- **Local service lane**: filesystem paths/tickets, hashing, file conversion, reading local files with constrained capabilities; cross-device delivery requires separately authorized transfers.
- **OS UI lane**: accessibility tree, coordinate click, keyboard, file dialogs, drag/drop, native app control, system notifications and permission-state diagnostics. On macOS this may require Accessibility, Screen Recording, Automation, and Files & Folders permissions; Windows uses UI Automation/desktop session permissions. Handle security-protected UAC and OS prompts through user takeover.
- **Human lane**: MFA/passkeys/CAPTCHA, hardware authentication, OS permission escalations and sensitive confirmation.

**Non-interference:** True background operation is generally reliable for browser DOM and API-based uploads. Operating-system dialogs and real mouse/keyboard interactions may steal focus; announce this and use a dedicated worker desktop, separate OS user session or isolated VM when nonintrusive native GUI is essential. Never promise macOS GUI clicks are background-safe without observing it.

## Capability resolver proposal

```text
browser_agent_capabilities(page_id) -> {
  dom: true, nativeMessaging: boolean, debuggerTab: boolean,
  uploadFileInput: boolean, dragDrop: boolean, download: boolean,
  clipboard: "none|read|write", osGui: boolean,
  permissionsNeeded: string[], loginRequired: boolean
}
```

Choose the **least privileged working path**, with explicit error codes: `FILE_INPUT_NOT_FOUND`, `LOCAL_FILE_NOT_AUTHORIZED`, `UPLOAD_DESTINATION_NOT_APPROVED`, `NATIVE_FILE_TOO_LARGE`, `CROSS_ORIGIN_PERMISSION_REQUIRED`, `CHROME_DEBUGGER_UNAVAILABLE`, `OS_GUI_REQUIRED`, `OS_PERMISSION_REQUIRED`, `HUMAN_LOGIN_REQUIRED`, `UPLOAD_NOT_CONFIRMED`.

Each tool call must retain the stable OWL Agent owner, device identity, task authorization and time-limited origin scope. Reject arbitrary remote filesystem reads and raw debugger commands.

## Implementation order / release gates

**P0 — standard upload (highest ROI):** file input discovery, local file ticket broker, debugger `DOM.setFileInputFiles` for approved regular file, event dispatch, upload status, audit receipt, 5 focused upload fixtures (visible, hidden, React controlled, multi-file, asynchronous auto-upload); unit + real Chrome testing. Keep browser tab background and demonstrate no leakage to OWL Cloud.

**P1 — complete browser workflow:** downloads, filenames, local artifact registration, download->upload pipeline, cross-origin iframe/popup routing, navigation postconditions, cancel/retry/idempotency, screenshot/trace evidence, upload progress.

**P2 — advanced page interaction:** DataTransfer upload fallback, drag/drop, rich editors, clipboard/file paste, shadow DOM/iframes, advanced keyboard actions and browser permission controls.

**P3 — mature Computer Use:** native file chooser, Finder/Explorer window tree, OS drag/drop, native apps, Print/Save As, permission detection and user takeover/resume, macOS/Windows original installers and real-device matrix.

### Required acceptance scenarios

- User works in foreground Chrome while Agent background-uploads known project image to allowed test origin. Foreground tab/window must remain unchanged.
- Profile 4 existing login persists. Two Agents' tabs/files cannot cross, and human tab is untouched.
- Selecting an upload field does not report completion until remote site visibly confirms.
- Hidden input behind custom button; React state update; multiple files; oversize rejection; revoked file grant; user deletes source; symlink escape; test user credential path prohibited.
- OAuth/CAPTCHA needs human handoff without forcing headless browser reconfiguration.
- Remote-device upload reads the **remote machine's approved file**, never incorrectly a file with same path on controller Mac.
- Crash/restart/messaging disconnect mid-upload yields truthful resumable or failed status, not phantom success.
- On platforms with OS file-picker fallback, Chrome foreground disturbance is declared; GUI session isolation verified.
