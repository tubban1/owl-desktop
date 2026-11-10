# Windows OWL LAB tool latency forensic snapshot — 2026-11-10

## Evidence and scope

Source: Windows host local `%USERPROFILE%\.owl-lab\connectivity\mcp-call-timings.jsonl`, one-week interval **2026-11-03 10:06 UTC – 2026-11-10 10:05 UTC**. 9,551 MCP response records, including 3,100 `tools/call` records. This is the journal retained locally by the Windows host, **not** all ChatGPT end-to-end, Cloud/Tunnel or platform-side response timings. Chronological windows and logged tool-outcome coverage vary across versions.

For 3,100 tool records, observed tool wall time: P50 **358 ms**, P90 **3,698 ms**, P95 **10,199 ms**, P99 **25,088 ms**, maximum **122,309 ms**.

Only 1,271 had known success/failure labels (1,081 success, 190 failures; observed success fraction **85.1% among classified outcomes**). Another **1,829 were unlabeled** because prior releases did not consistently persist `toolOutcome`. This must **not** be reported as a full seven-day tool success rate. On 2026-11-10 the classified subset was 161 success / 37 failed (4 unknown), an **81.3% classified success rate**.

## Dominant slow-path evidence

| Tool | 7-day count | P50 | P95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| `primitive_call` | 28 | 58.1 s | 119.5 s | 122.3 s |
| `execute_command` | 731 | 0.9 s | 20.1 s | 25.2 s |
| `browser_agent_snapshot` | 535 | 0.34 s | 2.37 s | 35.6 s |
| `browser_agent_screenshot` | 102 | 0.56 s | 4.48 s | 18.4 s |

There were **11** `primitive_call` response records with HTTP status 0 around **119.5–122.3 s** (the upstream transport apparently closed without a completed response). Some further calls returned normally after **46–117 s**. This sharply aligns with a ~120-second upstream completion boundary; it **does not establish** whether their Runtime-side effects committed. Do not retry blindly. `primitive_call` currently permits an internal Runtime invocation timeout of up to **600 s**, much longer than the observed failure boundary.

`execute_command` uses a bounded Runtime execution timeout of up to 20 s plus a 5 s client margin; its long tail around **25 s** is expected when commands time out or are blocked. For builds, directory scans, Blender, Git clones, or other potentially long operations, prefer `start_process` + `get_process_output`, or durable `task_create` and `task_submit`. A short MCP tool call should not block while a long job runs.

In the last 128 MCP samples, normal health calls were ~100–130 ms by localhost; overall MCP HTTP P50 4 ms while tool P95 was 97.6 s because of the latest primitive outliers. Thus **storage of historical Git release clones is a cleanup problem, not a demonstrated cause of the two-minute calls**.

## Changes and acceptance

- Add low-cardinality `primitive`, `primitiveOp` and `targetKind` to future MCP timing journal rows and diagnostics, without logging arguments, code, paths, credentials, target IDs or user content.
- Normalize well-defined Runtime command timeouts to `RUNTIME_TIMEOUT` rather than `UNCLASSIFIED`, improving error category accuracy.
- Update public `primitive_call` guidance to use durable execution for long work.
- Regression check no raw secret payload is persisted.
- For actual remediation, classify the next >30-second calls by primitive, operation, destination and side-effect receipt before selecting a targeted timeout/async dispatch policy. A forced lower timeout would make the user see a faster error but **would not ensure work stopped** and could increase duplicate side effects.

## Remaining safety work

Full P0 #107 Runtime-wide atomic drain/checkpoint and Cloud/local/scheduled admission barrier, P1 #109 Windows stale process and scheduled-task migration, #106 tunnel/lock/429 attribution, #110 consented ChatGPT conversation continuation with durable outbox remain distinct acceptance tracks.
