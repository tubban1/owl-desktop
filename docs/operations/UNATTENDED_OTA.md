# OWL LAB unattended DEV OTA (macOS + Windows)
 
This is an **independent**, fail-closed operator for development checkouts, not a signed production desktop installer.

## Deployment contract

1. Deploy `workers/owl-ota-coordinator` to Cloudflare Workers with its SQLite Durable Object migration. Configure `DEVICE_PUBLIC_KEYS_JSON` with exactly two Ed25519 *public* PEM keys (`mac`, `windows`). Private keys never leave either local device.
2. On each computer, run `node scripts/auto-version-updater.mjs init` from a source checkout. Exchange the output *public* keys only, then configure both computers with `node scripts/auto-version-updater.mjs configure https://owl-ota-coordinator.<subdomain>.workers.dev`.
3. Run `node scripts/install-auto-ota.mjs` from the verified checkout on each device. This copies the updater and its dependencies to the fixed user-local version-sync agent directory. It does not stop the current Runtime, MCP, Tunnel or Electron process.
4. Confirm `node ~/.owl-lab/version-sync/desktop/agent/scripts/auto-version-updater.mjs heartbeat` (Windows: equivalent user-home path) produces healthy live release on both devices, and `status` reports a fresh healthy peer.
5. A separate existing stager polls GitHub main every 30 minutes, validates the immutable SHA and builds it. The OTA runner also checks **the exact main-branch push CI workflow**. For promotion, it builds the OS release, confirms live local health, remotely validates the peer is healthy within 90s, acquires an exclusive 10-minute cloud lease, and launches the already-verified independent OS cutover mechanism. A failed preflight or offline peer leaves the current working release alone.
6. macOS window: 01:00–03:00 UTC; Windows window: 04:00–06:00 UTC. UTC windows are additional defense against cross-device overlap, not a substitute for the lease.
7. Mac per-release LaunchAgent watchdog remains active after activation. Windows has an independent scheduled post-activation health monitor that can restore the previous checkout and guardian after local MCP/Runtime is unavailable for 150 seconds. Both rollback paths must be physically failure-injected and reverified across devices.

## Important limitations

- Both devices need power, network and a logged-in user session. macOS and Windows interactive-user launch jobs do not guarantee updates after system shutdown or user sign-out.
- If Cloudflare is unreachable, the peer heartbeat is stale, GitHub CI is pending, or the lease is held, **do not activate**. Do not assume the staged SHA equals the live release.
- Only the immutable release checkout is replaced as a running process, never the developer's main checkout.
- `init` only creates local per-device signing keys; only **public** PEM keys belong in Worker settings. Never commit or print private keys.
- Under error, the updater records `ota/last-attempt.json`. The Windows post-activation history is kept as append-only JSONL.
- Failures that leave uncertain process/port ownership require operator inspection instead of killing unknown processes.
- A valid deployment requires real unattended promotion and post-activation rollback drills. Unit tests alone are not acceptance.
