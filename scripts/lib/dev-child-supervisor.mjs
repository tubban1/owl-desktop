import { spawn as nodeSpawn } from "node:child_process";

export class DevChildSupervisor {
  constructor({
    spawnImpl = nodeSpawn,
    baseEnv = process.env,
    logger = console,
    onFatal = () => {},
  } = {}) {
    this.spawnImpl = spawnImpl;
    this.baseEnv = baseEnv;
    this.logger = logger;
    this.onFatal = onFatal;
    this.children = new Set();
    this.restartTimers = new Set();
    this.shuttingDown = false;
  }

  start(
    label,
    cwd,
    command,
    args,
    env = {},
    {
      restartOnExit = false,
      restartPolicy = null,
      restartDelayMs = 1000,
      onLaunch = () => {},
    } = {},
  ) {
    const launch = () => {
      const child = this.spawnImpl(command, args, {
        cwd,
        env: { ...this.baseEnv, ...env },
        stdio: "inherit",
        detached: false,
      });
      this.children.add(child);
      onLaunch(child);
      let terminationHandled = false;

      const handleTermination = (code, signal, error = null) => {
        if (terminationHandled) return;
        terminationHandled = true;
        this.children.delete(child);
        if (this.shuttingDown) return;

        const detail = error
          ? `error=${error instanceof Error ? error.message : String(error)}`
          : `code=${code ?? "null"}, signal=${signal ?? "null"}`;

        const effectiveRestartPolicy =
          restartPolicy ??
          (restartOnExit ? "always" : "never");
        const abnormalExit =
          Boolean(error) ||
          signal !== null ||
          (typeof code === "number" && code !== 0);
        const shouldRestart =
          effectiveRestartPolicy === "always" ||
          (effectiveRestartPolicy === "on-failure" && abnormalExit);

        if (shouldRestart) {
          this.logger.warn?.(
            `[dev:full] ${label} terminated (${detail}); restarting without touching other healthy fault domains.`,
          );
          const timer = setTimeout(() => {
            this.restartTimers.delete(timer);
            if (!this.shuttingDown) launch();
          }, Math.max(0, Number(restartDelayMs) || 0));
          timer.unref?.();
          this.restartTimers.add(timer);
          return;
        }

        if (effectiveRestartPolicy === "on-failure" && !abnormalExit) {
          this.logger.info?.(
            `[dev:full] ${label} exited cleanly (${detail}); not restarting this child. Other dev:full fault domains remain active. Press Ctrl+C to stop the full dev stack.`,
          );
          return;
        }

        this.logger.error?.(`[dev:full] ${label} terminated (${detail}).`);
        this.onFatal(code ?? 1, { label, code, signal, error });
      };

      child.once("error", (error) => handleTermination(null, null, error));
      child.once("exit", (code, signal) =>
        handleTermination(code, signal),
      );
      return child;
    };

    return launch();
  }

  shutdown(signal = "SIGTERM") {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    for (const timer of this.restartTimers) clearTimeout(timer);
    this.restartTimers.clear();

    for (const child of this.children) {
      try {
        child.kill(signal);
      } catch {}
    }
    this.children.clear();
  }
}
