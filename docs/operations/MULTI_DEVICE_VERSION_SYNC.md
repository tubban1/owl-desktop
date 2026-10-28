# OWL Desktop multi-device version synchronization

## Canonical source / topology

Both macOS and Windows synchronize independently from the same reviewed GitHub main commit at https://github.com/tubban1/owl-desktop. Wi-Fi/LAN is irrelevant, so no filesystem sharing or peer trust is required. Desktop and Runtime are separate components; the actual Runtime version, Desktop version and MCP loaded source must each be checked. Source Git revisions are not equivalent to running process versions.

## Safety guarantees

- The user's Git working trees (including dirty/behind Mac main) are not pulled, reset, stashed or checked out by the version stager.
- The private per-user sync folder is ~/.owl-lab/version-sync/desktop. Each GitHub main SHA is cloned into a temporary directory and only admitted under its immutable SHA after npm ci, focused version-sync/document/MCP smoke tests, npm run build and Git status checks. Full test/build validation runs in mandatory GitHub CI before merging to main; the local stage does not falsely claim to rerun every test. Failed stages cannot replace a current runtime.
- Source is pinned to tubban1/owl-desktop over HTTPS with noninteractive Git; every fetched checkout must match the exact main commit read from origin. If GitHub is unreachable, the previously staged revision is kept.
- Scheduled staging runs every 30 minutes under the logged-in user via macOS LaunchAgent or Windows Task Scheduler. The scheduler never stops/starts the Desktop, Runtime, Tunnel or the fallback Computer MCP.
- The actual MCP startup snapshot appears in runtime_info.mcpSource and a fresh remote check is exposed by device_sync_status. This avoids assuming that the Desktop package version or local main HEAD means a running server is current.

## Commands (once from a fully tested checkout)

npm run sync:status
npm run sync:stage
npm run sync:install

Use OWL_SYNC_SOURCE_ROOT to specify the actual long-running user development checkout during installation, rather than a temporary worktree. For example on Mac, point it at /Users/wahaha/Documents/Me/Project/cursor/owl-desktop. The installer copies its version stager to a stable private user folder; neither source checkout nor staged revision is overwritten. On Windows, run from the real production/dev checkout and install in the interactive user session.

## Activation boundary / remaining work

Sync staging is **not activation**. A single live OWL Cloud Tunnel and direct MCP transport must not restart during a remote ChatGPT session without an independently verified guardian/recovery path. Only an authenticated host supervisor should switch the running release after packaged component attestation, a health gate, and a verified rollback path. Do not equate GitHub merge, staged build or source SHA with a live update. A fully unattended signed production OTA also needs code-signing and authenticated artifact distribution for both OSes; those credentials are not provisioned by this source stager.

## Rollback / troubleshooting

Last known good source snapshots are kept under the SHA path. The stager does not prune or replace them. Check ~/.owl-lab/version-sync/desktop/stager.err.log, last-staged.json and the output of sync:status. A dirty developer checkout is reported, not modified. If an earlier stage lock was left by a failed process, investigate it before removing; never force-reset user modifications.

## E2E evidence

Tests cover source SHA and version evidence, dirty untracked file protection, unknown repository state, and Windows/macOS parity through CI. Actual scheduled task installation and process activation are separate deployment verifications.
