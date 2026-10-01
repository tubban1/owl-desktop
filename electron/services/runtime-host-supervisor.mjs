import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function defaultHostBinary() {
  return path.join(
    os.homedir(),
    "Applications",
    "OWL Runtime.app",
    "Contents",
    "MacOS",
    "OwlRuntimeHost",
  );
}

export class RuntimeHostSupervisor {
  constructor({
    hostBinary = defaultHostBinary(),
    launchdLabel = "com.owl.runtime",
    runtimeBaseUrl = "http://127.0.0.1:8788",
    runtimeToken,
  } = {}) {
    this.hostBinary = hostBinary;
    this.launchdLabel = launchdLabel;
    this.runtimeBaseUrl = runtimeBaseUrl.replace(/\/+$/, "");
    this.runtimeToken = runtimeToken;
  }

  async hostIdentity() {
    if (!fs.existsSync(this.hostBinary)) {
      return {
        installed: false,
        path: this.hostBinary,
        bundleIdentifier: null,
        version: null,
      };
    }

    try {
      const { stdout } = await execFileAsync(this.hostBinary, ["--status"], {
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });
      const parsed = JSON.parse(stdout);
      return {
        installed: parsed?.ok === true,
        path: this.hostBinary,
        bundleIdentifier: parsed?.bundleIdentifier ?? null,
        version: parsed?.version ?? null,
      };
    } catch (error) {
      return {
        installed: true,
        path: this.hostBinary,
        bundleIdentifier: null,
        version: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async launchdStatus() {
    try {
      const { stdout } = await execFileAsync(
        "/bin/launchctl",
        ["print", `gui/${process.getuid()}/${this.launchdLabel}`],
        { timeout: 3_000, maxBuffer: 2 * 1024 * 1024 },
      );
      const state = /\bstate = ([^\n]+)/.exec(stdout)?.[1]?.trim() ?? "loaded";
      const pidText = /\bpid = (\d+)/.exec(stdout)?.[1];
      return {
        loaded: true,
        state,
        pid: pidText ? Number(pidText) : null,
      };
    } catch {
      return { loaded: false, state: "not-loaded", pid: null };
    }
  }

  async runtimeHealth() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_500);
    try {
      const response = await fetch(
        `${this.runtimeBaseUrl}/runtime/v0.1/info`,
        {
          method: "GET",
          headers: this.runtimeToken
            ? { authorization: `Bearer ${this.runtimeToken}` }
            : {},
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        return { reachable: false, status: response.status };
      }
      const payload = await response.json();
      return {
        reachable: payload?.ok === true,
        apiVersion: payload?.apiVersion ?? null,
        runtimeVersion: payload?.result?.runtimeVersion ?? null,
      };
    } catch (error) {
      return {
        reachable: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async status() {
    const [host, service, runtime] = await Promise.all([
      this.hostIdentity(),
      this.launchdStatus(),
      this.runtimeHealth(),
    ]);
    return {
      host,
      service,
      runtime,
      authority: "owl-runtime",
      desktopRole: "lifecycle-consumer",
    };
  }

  async restartService() {
    const target = `gui/${process.getuid()}/${this.launchdLabel}`;
    await execFileAsync("/bin/launchctl", ["kickstart", "-k", target], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    return this.status();
  }

  async stopService() {
    const target = `gui/${process.getuid()}/${this.launchdLabel}`;
    await execFileAsync("/bin/launchctl", ["bootout", target], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    }).catch(() => undefined);
    return this.status();
  }
}
