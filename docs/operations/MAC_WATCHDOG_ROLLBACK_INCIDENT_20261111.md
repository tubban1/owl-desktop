# Mac DEV watchdog rollback — 2026-11-11

## Observed facts (Europe/Zurich)

- `179cb753` was activated successfully around 12:44; local HTTP components and Native Messaging passed startup checks.
- At 14:12:54 the watchdog saw an MCP health timeout (3.5-second budget).
  On later probes, both MCP (8790) and Runtime (18788) timed out.
- The verified Supervisor PID 48077 and Electron main process remained present; watchdog evidence does not show an Electron crash.
- After seven consecutive failed probes, at 14:18 the watchdog selected `persistent-core-failure` and initiated SIGTERM rollback.
- At 14:22 the fallback `38c5bed3` was confirmed healthy.
- At 14:38 the 8-logical-core Mac (16 GiB physical RAM) reported a load average around 179 and around 13.9 GiB swap in use. At 14:49 load had fallen to around 4.1 and both loopback health endpoints responded in approximately 1–13 milliseconds.
- These observations support system-wide resource contention, but do not prove which process or operation first caused overload. No 2026-11-11 Electron crash report was found in the checked DiagnosticReports directory.

## Corrective safeguards

- Capture host one-/five-minute load and CPU core count in watchdog probes.
- If exact verified Supervisor, Electron and owner remain present, and HTTP failures are only timeouts under severe host load (one-minute load >= 2.5 times logical cores), persist that observation across the contiguous incident.
- For this narrow case, extend rollback grace from 5 to **at most 15 minutes** and recheck with an independent 12-second HTTP health probe before destructive rollback.
- Missing Supervisor, wrong owner, connection refused, HTTP errors and other clear failures retain existing faster recovery.
- If HTTP services remain unavailable after the bounded grace, allow the verified rollback.

## Operational limits

- Do not disable the watchdog or mask a true persistent outage.
- No indiscriminate process termination or Spotlight disabling.
- Do not automatically quit Chrome, IDEs or other work containing unsaved changes.
- Collect load, swap delta, queued tasks, process and event-loop diagnostics if the spike recurs.
- This patch reduces premature rollbacks; it does **not** directly eliminate the source of host resource contention.
