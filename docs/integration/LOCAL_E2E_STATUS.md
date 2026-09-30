# OWL Desktop Local E2E Status

Status: **Gate 3 complete / Desktop ↔ Runtime I2 live accepted**.

Validated on 2026-09-30 against the exact consumer/provider pair:

~~~text
OWL Desktop tested main
1d32e902caaab12c99e1932788904ff58062f99c

OWL Runtime canonical main merge
ae926a14327fedee68269ded608951dcc0ccbaa5

Runtime public API
0.1
~~~

The Runtime implementation still reports `runtimeVersion=1.0.0-rc.4`; integration compatibility is therefore pinned by exact provider SHA, not by the runtimeVersion string alone.

## Proven local path

~~~text
ChatGPT / MCP client
→ OWL Desktop-owned OWL MCP
→ Desktop RuntimeHttpClient
→ OWL Runtime public API
→ Primitive / Skill / durable Task
→ Observation / Verification
~~~

The legacy Computer MCP / AgentOS production service on port 8787 remained untouched.

## Automated evidence

Core Desktop gate:

~~~bash
npm test
npm run build
git diff --check
~~~

Result at the tested consumer code baseline:

- 14/14 test files passed;
- 74/74 tests passed;
- production Vite/TypeScript build passed.

Read-only Local E2E:

~~~bash
OWL_MCP_URL=<desktop-owned-mcp> \
OWL_E2E_REPO=<owl-desktop> \
npm run verify:local-e2e
~~~

Proves:

- MCP tool discovery;
- Runtime API/version discovery;
- stable logical owner hashing;
- same owner across a new MCP transport connection;
- no identity inference from User-Agent/IP/timing;
- MCP abort propagation into Runtime HTTP AbortSignal;
- `git_status` maps to Runtime `git.query(status)`;
- MCP Git status exactly matches direct Git status;
- deterministic read-only retry;
- Desktop-owned MCP exposes `task_start` and `task_status`;
- MCP server instructions tell agents to detach long work and surface only truthful Runtime progress.

## Long-task frontend continuity

The live gate creates a real 2.2-second durable Runtime Task through:

~~~text
OWL MCP skill_run(runtime.compile_task)
→ Runtime durable Task
→ OWL MCP task_start
→ repeated task_status
→ terminal completed
~~~

Final exact-pair validation against canonical Runtime `main` observed **1034 ms** cold-start acceptance while the 2.2-second Task continued independently. Earlier warm integration runs were as low as 43 ms; both remain below the 1500 ms acceptance gate.

The gate also proved:

- `task_status` observed the active long-running step;
- progress revision remained monotonic and reached revision 9;
- terminal completion came only from canonical Runtime state;
- the initiating interactive tool request did not need to remain open for the full Task lifetime.

This is the product mechanism for avoiding ChatGPT/frontend idle disconnects: execution is detached first; ChatGPT polls real progress and can send a concise user-facing update before its own frontend idle deadline. It must never fabricate activity merely to keep a connection alive.

## Consequential response-loss / replay gate

Run:

~~~bash
OWL_RUNTIME_URL=<runtime> \
OWL_E2E_REPO=<owl-desktop> \
npm run verify:consequential-replay-live
~~~

The gate performs a non-idempotent `fs.write(append)` through the full Desktop-owned OWL MCP path.

Fault injection:

1. MCP sends the consequential Primitive to Runtime.
2. Runtime completes the append.
3. A test proxy receives the complete upstream MCP response, then intentionally destroys the downstream response before the caller can observe it.
4. The exact same MCP JSON-RPC request is replayed.
5. Desktop maps the MCP transport session + logical request + Runtime method/params to a Runtime `x-owl-idempotency-key` for the default retry scope.
6. Runtime returns the canonical prior result rather than executing again.
7. A fresh MCP transport receives a fresh default replay scope even when the logical owner is unchanged, preventing stale response replay when JSON-RPC numeric IDs are reused.
8. A client that explicitly supplies `x-owl-idempotency-key` may intentionally preserve the same replay identity across a fresh MCP transport.

Observed result:

- first upstream execution completed successfully before response loss;
- retry returned the same canonical MCP response;
- target file contained exactly one `once\n`;
- side-effect count = 1.

This closes **CR-DESKTOP-005**. Desktop does not maintain a competing execution dedupe database; Runtime remains the canonical replay authority. Stable logical owner identity and request replay identity are intentionally separate: owner identity may survive reconnect, while the default replay scope is transport-local unless the client explicitly supplies a cross-transport idempotency key.

## Gate 3 conclusion

Gate 3 is **green** for the tested exact pair above:

- read-only path;
- stable logical owner reconnect;
- detached long-task start/progress;
- consequential response-loss replay;
- one side effect / one canonical result;
- Runtime Task/Process ownership remains authoritative.

## I3 — OWL LAB login, Device Enrollment, Runtime access state

**Automated product implementation is closed. Human browser login remains a dogfood step, not an implementation blocker.**

Accepted provider/consumer baseline:

~~~text
OWL Cloud Frankfurt /auth/config
→ Cognito Authorization Code + PKCE S256
→ owl-desktop://auth/callback
→ Desktop main-process token exchange
→ bootstrap
→ device registration
→ one-time deviceCredential → OS safeStorage
→ effective device access
→ bounded local Runtime access lease
→ LOCKED / READY / REVOKED
~~~

Evidence:

- Frankfurt live `/auth/config` returns Cognito `eu-central-1`, public client, Authorization Code, PKCE S256 and `owl-desktop://auth/callback`;
- Desktop PKCE/state/code-exchange tests pass;
- device credential is persisted to OS-backed secure storage before non-secret device settings;
- refresh token remains main-process/OS-vault only;
- Runtime `access.get / authorize / lock / revoke` is available through the public HTTP contract;
- production Runtime access defaults to enforced/LOCKED;
- Cloud `canRun=true` creates a bounded READY lease;
- logout/no run permission locks new mutations;
- rejected/revoked device auth transitions Runtime to REVOKED;
- expired leases fail closed while read-only status remains observable.

Canonical Runtime access implementation is on the Runtime integration branch at `919eeed`.
Canonical Desktop binding is on `main` at `082a526`.

## I4 — Cloud RemoteCommand → Desktop → Runtime → terminal Cloud projection

**CLOSED for the tested dev contract.**

Canonical implementation pair:

~~~text
OWL Cloud feat/cloud-m1-control-plane @ 9f71e4e
OWL Desktop main @ 9254ea5
OWL Runtime integration baseline @ 919eeed
~~~

The versioned Cloud registry now exposes:

~~~text
runtime.task.create@1
→ tasks.create

runtime.task.create-and-start@1
→ tasks.create
→ tasks.start
→ desktop.cloud.task.terminal@1
~~~

The HTTP live gate `npm run verify:cloud-bridge-http-live` uses a real HTTP Cloud transport implementation, Desktop `CloudHttpClient + CloudBridgeService`, and a real enforced Runtime instance. It proved:

- device presence, command pull, accept, event ingest and telemetry all traverse HTTP;
- `runtime.task.create-and-start@1` creates exactly one Runtime Task and starts it durably;
- create/start each use stable Runtime replay identity derived from Cloud `commandId`;
- a deliberate duplicate delivery replays the same `commandId → runtimeTaskId` mapping and does not create/start a second Task;
- Runtime reached canonical `completed` with progress revision 8 in the acceptance run;
- Desktop emitted exactly one `desktop.cloud.task.terminal@1` event and one bounded terminal telemetry record;
- Cloud terminal projection matched the exact Runtime task status/revision;
- the local bridge journal retained only digest/mapping/terminal metadata and not the raw command payload.

Frankfurt dev deployment was updated on 2026-09-30 and CloudFormation reached `UPDATE_COMPLETE`. Live read-back from:

~~~text
GET /contracts/remote-command-kinds/v1
~~~

confirmed both `runtime.task.create@1` and `runtime.task.create-and-start@1` are deployed.

## I5 — Approval E2E

**CLOSED for the tested dev contract.**

Canonical implementation set:

~~~text
OWL Cloud feat/cloud-m1-control-plane @ b6a764b
OWL Desktop main @ a8cb8ab
OWL Runtime integration baseline @ 919eeed
~~~

Authority remains intentionally split:

~~~text
Cloud ApprovalDecision
= authenticated human decision + provenance + delivery/ack state

Runtime Approval
= exact task/step/fingerprint authorization + one-time receipt consumption
~~~

The live gate `npm run verify:i5-approval-e2e` exercised real Cloud API handler/control-plane logic, Desktop Cloud Bridge, and a real approval-enforcing Runtime. It proved:

- an `fs.delete` step remained `waiting_approval` and the file remained present before approval;
- Cloud `approve` resumed the same Runtime taskId and same stepId;
- the exact Runtime approval receipt became `consumed`;
- the delete side effect executed once;
- replaying the same Cloud ApprovalDecision replayed the durable Cloud acknowledgement rather than re-invoking Runtime;
- a separate Cloud `deny` decision moved the waiting Task to `failed`;
- the denied delete side effect never executed;
- no replacement Task was created for approve or deny;
- Cloud records the final Runtime approval/task outcome, not an intermediate `approved` snapshot;
- ApprovalDecision is persisted in Aurora via `005_approval_decision_v1.sql`, exposed through OpenAPI, and protected by effective `approve` DeviceGrant access.

Provider/consumer gates are green:

- Cloud typecheck + 52/52 tests;
- Cloud schema verifier: 10 tables + approval constraints/indexes;
- Desktop 87/87 tests + production build.

## I6 — Offline / reconnect

**CLOSED for the tested dev contract.**

The live gate `npm run verify:i6-offline-reconnect-e2e` exercises an actual HTTP Cloud transport, Desktop Cloud Bridge with durable journal, and a real enforced Runtime. It proved:

- a RemoteCommand can remain queued while Desktop is not polling;
- repeated pre-accept pulls return the same stable `commandId`;
- duplicate delivery maps to one `runtimeTaskId` and does not create/start a second Task;
- the Cloud HTTP server was actually stopped while the Runtime Task was active;
- Runtime reached canonical `completed` while Cloud transport was unavailable;
- no terminal Cloud projection was fabricated while the device was offline;
- restarting Cloud on the same endpoint and reconnecting with the same device credential restored device identity;
- a fresh Desktop bridge instance reused the durable journal and reconciled the same Runtime Task;
- exactly one terminal event was projected after reconnect;
- a second reconnect/sync did not duplicate terminal projection or invent failure.

This closes the Gate 6 invariants for queued intent, at-least-once delivery, command dedupe, Runtime independence from Cloud transport, stable device identity and projection reconciliation.

## Next serial gate

The next integration phase is **I7 — Compatibility Matrix**.

~~~text
I2 Desktop ↔ Runtime CLOSED
→ I3 login + Device Enrollment + Runtime access CLOSED
→ I4 RemoteCommand product E2E CLOSED
→ I5 Approval E2E CLOSED
→ I6 Offline / reconnect CLOSED
→ I7 Compatibility Matrix
→ I8 Dogfood / soak / production promotion
~~~
