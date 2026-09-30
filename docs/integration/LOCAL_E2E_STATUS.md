# OWL Desktop Local E2E Status

Status: **Gate 3 complete / Desktop ↔ Runtime I2 live accepted**.

Validated on 2026-09-30 against the exact consumer/provider pair:

~~~text
OWL Desktop consumer code
779c00b51cbfb99d82e5e4413ac91a99d2b9e96c

OWL Runtime 1.x provider
852fdb4eb7595800eb1c3e64e822b15cf5528ef6

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

- 13/13 test files passed;
- 72/72 tests passed;
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

Observed acceptance was **113 ms** while the Task continued independently.

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
5. Desktop maps stable owner + logical MCP request + Runtime method/params to the same Runtime `x-owl-idempotency-key`.
6. Runtime returns the canonical prior result rather than executing again.

Observed result:

- first upstream execution completed successfully before response loss;
- retry returned the same canonical MCP response;
- target file contained exactly one `once\n`;
- side-effect count = 1.

This closes **CR-DESKTOP-005**. Desktop does not maintain a competing execution dedupe database; Runtime remains the canonical replay authority.

## Gate 3 conclusion

Gate 3 is **green** for the tested exact pair above:

- read-only path;
- stable logical owner reconnect;
- detached long-task start/progress;
- consequential response-loss replay;
- one side effect / one canonical result;
- Runtime Task/Process ownership remains authoritative.

## Next serial gate

The next integration phase is **I3 — mandatory OWL LAB login + Device Enrollment + Runtime access state**.

Do not start Cloud RemoteCommand E2E ahead of I3. The required order remains:

~~~text
I2 Desktop ↔ Runtime complete
→ I3 Cloud login + Device Enrollment + local Runtime unlock
→ I4 Cloud RemoteCommand → Desktop → Runtime → verified terminal projection
~~~
