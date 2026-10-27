# Windows Desktop saved folders versus Runtime effective access (2026-10-27)

## Observed discrepancy
OWL Desktop Settings showed four requested paths: C:\Users\i95i\Desktop, C:\Users\i95i\Documents, C:\Users\i95i\Downloads, and C:\ (entire volume).
The persisted Settings JSON in APPDATA\OWL LAB\desktop\settings.json matched all four paths and recorded shell, delete, Git push and rollback as enabled.
The live OWL Runtime provider showed only C:\Users\i95i\mcp-workspace and reported shell, write and delete disabled. Runtime list_directory calls for all four saved paths failed with outside ALLOWED_DIRECTORIES; only the workspace was readable.
An older computer-mcp connector reported a DIFFERENT root and permissions; its configuration is independent, not evidence of OWL Runtime authority.

## Root cause
The Windows Desktop is an unpackaged Electron DEV build from mcp-workspace. electron/services/windows-dev-runtime.mjs hard-coded the Runtime ALLOWED_DIRECTORIES to the parent of its pinned Runtime checkout, ignoring Desktop settings. The DEV launcher separately forces shell/delete off. Settings persisted the requested folders but did not apply them at the running Runtime; the UI transiently announced dev restart and misleadingly labeled the requested list as actual access.

## Remediation
New projectWindowsDevDocumentRoots projects existing, canonicalized narrow saved folders into the read-only Windows DEV Runtime on its next controlled restart, while retaining the existing workspace. Drive roots, profile-wide, protected system/credentials, network UNC and unresolved paths fail closed. If the special Windows DEV workspace write-opt-in is enabled, do not broaden its existing workspace-only filesystem scope: per-root read/write capability separation must be implemented before enabling such mixed grants.
The UI now calls them requested folders, with a persistent description of DEV restrictions. Shell, Delete and unrestricted write are not enabled just because a saved toggle requests them.

## Acceptance and limitations
Build passed and 134 test files / 618 automated tests passed on Mac. A Windows live Runtime restart and provider_status/read of all narrow roots is STILL required before claiming Windows fixed in production.
A safe product feature should show requested and effective grants separately with last applied timestamp, source and denial reason. Do not equate the legacy Computer MCP provider grants with OWL Runtime permissions.
