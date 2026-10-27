# Local Document Access audit — Mac + Windows (2026-10-27)

## Principle: three independent permission boundaries

1. OS file permissions (Mac TCC or Windows ACL, plus app-native Accessibility/Screen Recording/Automation).
2. OWL Runtime authority: allowed roots, per-operation READ/WRITE/DELETE/SHELL flags, Agent Browser host file tickets and per-origin grants.
3. Destination API authority: Gmail/Google Drive/ChatGPT plugin or browser upload must independently authenticate and support the chosen attachment representation. ChatGPT Gmail cannot dereference a Mac /Users/... path: it needs a genuine ChatGPT sandbox file, while OWL native SMTP reads local files but needs separately connected Gmail authentication.

Granting Full Disk Access does not fix a missing plugin file-reference protocol. Do not give whole-disk access merely to work around a file-transport bug.

## Diagnostic, safe and repeatable

In the owl-desktop checkout run:

    node scripts/audit-local-document-access.mjs
    node scripts/audit-local-document-access.mjs --verify-writes
    node scripts/audit-local-document-access.mjs --file=/absolute/path/to/file.pdf

The default does not write anything or enumerate the names of user documents. The optional --verify-writes uses one uniquely named, short-lived test file under each present default root (Downloads/Documents/Desktop), checks the bytes, and removes it; it never deletes other user files. The --file option checks only metadata and a candidate type/size, not external uploading.

## Current results

Mac: filesystem provider available; write/delete/Shell/Git push enabled. Runtime filesystem roots include /Users/wahaha (too broad) as well as Documents/Desktop/Downloads. Native Helper reports Accessibility and Screen Recording granted. PDF metadata for Downloads/sd/Mietvertrag.pdf confirmed; test-file roundtrips passed in Downloads and Documents, and Desktop passed creation/deletion with one transient read transport failure. Protected Library/Mail not available to process; native browser isolated provider currently not connected.

Windows: filesystem allowed only under C:\Users\i95i\mcp-workspace; it can list files. Write/delete/Shell/Git push disabled; native input disabled, while Windows UIA reads and screenshot are available. Do not enable these globally without explicit scoped need.

## Product risks and fixes

- Mac Runtime root /Users/wahaha is overly broad. Move toward user-selected project and document roots, Runtime-owned staging, explicitly approved external destinations; preserve existing workflows during migration and audit before shrinking.
- Text read_file is not a general binary document importer. PDF/DOCX/XLSX/PPTX parsing/editing must route to binary-aware processors with explicit file selection.
- Browser upload requires file ticket + approved root + page origin; selecting input is not proof of upload completion.
- ChatGPT Gmail plugin's attachment_files accepts a registered ChatGPT file, not Mac local paths or pre-signed S3 links. A registered-file bridge needs explicit host platform support.
- OWL native Gmail (PR #56) is a separate local SMTP provider; does not inherit the OAuth login of Gmail plugin. Native app password authorization and an on-device send confirmation remain required.
- Allow no silent data export, credential paths, symlink escapes, blanket user-home deletion, or repeated retries of uncertain external sends.

## Acceptance criteria to certify fully operational document automation

1. A requested local file's real bytes are read and fingerprinted without leaving the device until an authorized destination action.
2. Destination receives original bytes, MIME type, filename, length and matching digest.
3. User can inspect proposed destination and action before first consequential transfer.
4. macOS TCC, Windows ACL, Runtime flags and app OAuth are treated independently.
5. Denied paths fail safely with a direct explanation; originals are not modified.
6. Private staging and probes clean up after use; no unapproved cloud copies remain.
7. Supported actions are tested on Mac and Windows separately.
