# OWL Desktop Runtime Permission Center P0

Date 2026-10-14. Branch feat/desktop-permission-center-p0. Status IMPLEMENTED IN ISOLATED WORKTREE; NOT MERGED OR DEPLOYED.

The permission model is capability by capability, not a global permission switch.
Git Push, Shell, file deletion and transaction rollback offer Blocked or Review Each Action. Existing configurations begin in an Inherited display state to avoid a destructive migration. There is deliberately no unrestricted Always Allow.

Review enables a Runtime environment prerequisite only after a controlled restart. It does NOT approve an action. Every side effect must still pass an exact Task/Step/arguments Runtime approval, plus device/Cloud lease, allowed directory and workspace ownership constraints. The current running process privileges remain UNVERIFIED until checked on the actual Runtime endpoint.

Implementation:
- electron/services/runtime-permissions.mjs: whitelist, strict validation, env projection and approval action union including git.push, fs.delete, tx.rollback, shell.exec/start/input/kill.
- electron/store.mjs: generic settings update cannot bypass the dedicated permission policy setter.
- electron/main.mjs and preload: dedicated IPC with native confirmation for changing a capability and separate confirmation to apply via Runtime restart. No automatic restart on save.
- electron/services/local-runtime-bootstrap.mjs: applies policy to packaged managed runtime.env, enforces approval mode.
- src/permissions/RuntimePermissionCenter.tsx: Settings permission panel, read-only saved/live distinction, current access lease reason and expiry, existing pending approval UX.

Verification:
- Full npm test: 82 files, 364/364 tests passed.
- npm run build: TypeScript and Vite production bundle passed.
- Focused permission/bootstrap: 13 tests passed.

Limitations and remaining gates:
- Not installed or deployed; running Desktop/Runtime and remote Git not modified.
- Original owl-desktop main has uncommitted edits to bootstrap/tests and a download cache. Reconcile without overwriting before merging.
- Runtime rc.4 does NOT support live zero-restart temporary capability grants. If a capability is Blocked, one-time operation approval cannot bypass it. Runtime 1.x should add session/task/step-scoped capability tokens for that case.
- Actual dev:full may use a different Runtime than the packaged Desktop. No misleading effective-permission claim from saved file, and no automatic dev restart.
- Packaged macOS manual acceptance needed: correct remote Git effect, denial, lease expiry, workspace lock, multiple sessions, on-demand approval and selected Runtime endpoint.

Do not claim this permission center is already active in the current installed Desktop.
