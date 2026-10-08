# OWL LAB F9 — Sleep/wake equivalent fault acceptance (2026-10-08)

**Isolated integration: PASS. Real macOS sleep/wake: NOT YET TESTED.**

## Implementation

Permanent Connectivity Host subscribes to Electron `powerMonitor.resume`,
then uses one single-flight wake recovery coordinator. The authenticated
`POST /connectivity/wake-recheck` asks the background Host to invalidate
prior reachability evidence and actively re-probe:

- Cloud Durable MCP queue polling and local executor readiness, using a
  wake epoch so any pre-wake in-flight successful poll cannot falsely re-enable Ready.
- Tunnel health / upstream reachability, using bounded existing probes.
- Configuration reconciliation happens after transport revalidation.
- Repeated resume notifications are coalesced; failed checks do not assert Ready.

The work does not restart production Runtime or require the Desktop window open.

## Evidence

`npm test -- --run` on five wake/Cloud/Tunnel test files: **29/29 PASS**.

`node scripts/verify-sleep-wake-f9.mjs`: **exit 0 / PASS**.
A separate loopback Cloud HTTP child was SIGSTOP-ed, then SIGCONT-ed:

- Test child PID **94913**, random port **61092**.
- Frozen Cloud: **ready=false**, `CLOUD_TIMEOUT` within **307 ms**.
- Independent local Tunnel-health fixture remained healthy.
- After resume: fresh Cloud poll **ready=true**; forced executor proof occurred.
- No consequential test calls executed, and no production Tunnel action.

Production listener PIDs before and after were unchanged:

| Component | Before | After |
| --- | ---: | ---: |
| Runtime 8788 | 22677 | 22677 |
| MCP 8790 | 30562 | 30562 |
| Host 8791 | 30562 | 30562 |

Raw local evidence:
`release/acceptance/sleep-wake-f9/sleep-wake-f9.json`

Raw evidence SHA256:
`f228dd71783622983c5f4553243e861dbf74e9dc55b2ae8c647a5d2a62d6ae9d`

Harness SHA256:
`e38a6846a3d79beee3455e32c815285f6442fad751aaddedfa347096602dd3e4`

Full Desktop `npm run verify:dev`: **68/68 files, 305/305 tests,
TypeScript/Vite build, diff-check, and durable-submit PASS**. This complete
gate included other uncommitted F10/device-credential and Runtime bootstrap
code; it does not certify those separate features.

## Open stop lines

This does not claim a real macOS sleep/wake PASS, Wi-Fi loss/recovery
hardware proof, signed/notarized packaged-host resume PASS, or combined
sleep+Host-crash+lease/ACK-loss PASS. Those require separate evidence.
Accepted packaged 100-cycle Host restart soak remains valid, not repeated.
