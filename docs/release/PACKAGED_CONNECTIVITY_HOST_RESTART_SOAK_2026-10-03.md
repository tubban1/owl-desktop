# Packaged Connectivity Host 100-cycle restart soak — 2026-10-03

Status: **PASS for the isolated Host restart soak only.**

This record does **not** close the full packaged fault matrix, credential
lifecycle, final ChatGPT OAuth cutover, embedded Runtime acceptance, or the
signed/notarized release gate.

## Exact acceptance combination

Desktop integration source:

- branch: `feature/connectivity-stability-parity`;
- HEAD: `913b373677e4b1f85a18d82626a119c98c38411b`;
- tracked dirty diff SHA256:
  `cc6032c5e722c9471b4d2877c2ee88a39249e9a8c48781a16d32af4360f836d1`;
- soak harness SHA256:
  `c2e062a1b92b01cc59e1b9b4b23b374b8bb6001eeb34a4f43d7680a44713e3e3`.

The arm64 unpacked Desktop was rebuilt from that source state after the
`21e0520` and `913b373` stability fixes were reconciled.

Packaged app:

- path: `release/mac-arm64/OWL LAB Desktop.app`;
- unsigned development artifact;
- file-manifest entries: 535 total / 521 regular files;
- canonical sorted file-manifest SHA256:
  `8b60cb566776074a2a8174893ad6327f4d77a63d53dfb8f241fb802e673e878c`.

The package contains the tracked release Runtime component:

- Runtime version: `1.0.0-rc.4`;
- Runtime API: `0.1`;
- embedded Runtime git SHA:
  `4e24c19fef12704eb5fe97c1283a3d8c32a4df4c`;
- component fingerprint:
  `701499f6dd35f619d3ae05c859d3bdfc45bef66a7f35be0c93315ea29d78579a`.

Important boundary: the restart soak intentionally reused the already-running
Runtime on port 8788 so repeated Connectivity Host crashes could be isolated
from Runtime lifecycle. The exercised resident Runtime was:

- PID: `69098`;
- Runtime Host PID: `68910`;
- installed component SHA:
  `d6320d29941fe0d4e94e28cf94c5eb9f1d1ab681`;
- Runtime version: `1.0.0-rc.4`;
- Runtime API: `0.1`;
- Node: `~/.agentos/node/v24.21.0-arm64/bin/node`.

Therefore this gate is **not** evidence that the embedded
`4e24c19...` Runtime itself survived 100 restarts. It proves the packaged
Connectivity Host is an independent failure domain while a resident durable
Runtime remains alive.

The active Runtime integration checkout remains
`bf7f8e0cd8fba74a611b2753f313e83bb419bd41` with pre-existing browser dirty
work. That checkout was not the actual PID 69098 binary and must not be
attributed to this soak.

Cloud context at the time of acceptance:

- source: `7c12adebcfccc10828a9f4770f72b25613d33e3f`;
- Frankfurt stack: `OwlCloudDevStack`;
- stack status: `UPDATE_COMPLETE`;
- last update: `2026-10-02T23:04:23.715000+00:00`;
- API/MCP resource:
  `https://yh9cjtolx6.execute-api.eu-central-1.amazonaws.com`.

Cloud was not part of this isolated Host restart lane; Cloud outage/delivery
semantics remain part of the full packaged fault matrix.

Environment:

- macOS: `26.5.2`;
- Apple-silicon hardware capability present;
- invoking shell was translated under Rosetta (`uname -m = x86_64`);
- package executable: arm64;
- validation Node: `v22.23.3 arm64`.

## Isolation design

The test did not kill or replace the active OWL LAB connectivity stack.

Isolated acceptance resources:

- launchd label: `ai.owl.desktop.connectivity-host.soak`;
- local MCP port: `8890`;
- control port: `8891`;
- separate temporary Desktop store;
- separate temporary Host data/completion root;
- separate LaunchAgent logs;
- LaunchAgent environment restricted to an explicit non-secret allowlist.

The LaunchAgent contained no Runtime token, MCP token, Tunnel API key, Cloud
device credential or bearer credential.

Production continuity controls were:

- Runtime listener: `8788`;
- production MCP listener: `8790`;
- production Connectivity Host control listener: `8791`.

## Canary

The first 3-cycle run exposed a cleanup race after the behavior itself passed:
recursive temp-tree removal could race with final Host shutdown and raise
`ENOTEMPTY`.

The harness was corrected to:

1. boot out the isolated LaunchAgent;
2. wait until launchd no longer owns the label and both test listeners are gone;
3. use bounded retry for temporary-tree deletion.

The repeated 3-cycle canary then exited 0.

Canary evidence:

- completed: 3 / 3;
- Runtime PID: `69098 -> 69098`;
- production MCP PID: `79222 -> 79222`;
- production Host PID: `79222 -> 79222`;
- listener leaks: 0;
- recovery latency: min 2849 ms, p50 3394 ms, p95/max 3976 ms.

## 100-cycle result

Final harness result:

- requested cycles: **100**;
- completed cycles: **100**;
- process exit: **0**;
- Runtime PID: **69098 -> 69098**;
- production MCP PID: **79222 -> 79222**;
- production Connectivity Host PID: **79222 -> 79222**;
- successful `runtime_info` proof after every counted restart;
- Runtime version/API evidence: **1.0.0-rc.4 / 0.1**;
- listener leaks: **0**;
- secrets printed: **false**.

Restart recovery latency:

| Metric | Result |
| --- | ---: |
| min | 2779 ms |
| p50 | 3210 ms |
| p95 | 4220 ms |
| max | 5141 ms |

Raw success evidence:

- `release/acceptance/connectivity-host-restart-soak/restart-soak-100.json`;
- SHA256:
  `b6ae727f6feb713678dddd2839c86a54c8ebf66c02929085287f3b931b3fd835`.

The package file manifest and exact test-combination JSON are retained under
`release/acceptance/connectivity-host-restart-soak/` as local acceptance
artifacts.

## Cleanup proof

After the gate:

- soak launchd label is absent;
- ports 8890 and 8891 have no listeners;
- no `/tmp/owl-packaged-connectivity-soak-*` directory remains;
- production 8788/8790/8791 listeners remain on their original PIDs.

## Gate conclusion

This closes:

> **isolated packaged Connectivity Host 100-cycle restart soak**

It proves repeated packaged Host death/restart is bounded and isolated from the
resident Runtime and production connectivity stack.

It does **not** close:

- temporary Cloud outage;
- Wi-Fi/network loss and recovery;
- sleep/wake;
- duplicate Cloud delivery / duplicate side-effect prevention;
- lost completion acknowledgement / completion replay;
- credential invalidation / recovery;
- Custom Tunnel kill/reconnect;
- false-green readiness across all failure classes;
- embedded packaged Runtime lifecycle acceptance;
- signed/notarized clean install, update or rollback.

Those remain the separate **full packaged fault matrix** and release gates.
