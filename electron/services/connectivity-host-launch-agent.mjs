import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";

const execFileAsync = promisify(execFile);

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export class ConnectivityHostLaunchAgent {
  constructor({
    desktopExecPath,
    homeDir = os.homedir(),
    uid = process.getuid?.() ?? 501,
    launchdLabel = "ai.owl.desktop.connectivity-host",
    execFileImpl = execFileAsync,
    skipLaunchd = false,
    monotonicNow = () => performance.now(),
    onEvent = () => {},
  } = {}) {
    if (!desktopExecPath) {
      throw new Error("ConnectivityHostLaunchAgent requires desktopExecPath.");
    }
    this.desktopExecPath = path.resolve(desktopExecPath);
    this.homeDir = homeDir;
    this.uid = uid;
    this.launchdLabel = launchdLabel;
    this.execFileImpl = execFileImpl;
    this.skipLaunchd = skipLaunchd;
    this.monotonicNow = monotonicNow;
    this.onEvent = onEvent;
    this.launchAgent = path.join(
      homeDir,
      "Library",
      "LaunchAgents",
      `${launchdLabel}.plist`,
    );
    this.logDir = path.join(
      homeDir,
      "Library",
      "Logs",
      "OWL LAB",
      "connectivity-host",
    );
  }

  plist() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(this.launchdLabel)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(this.desktopExecPath)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OWL_CONNECTIVITY_HOST_ONLY</key>
    <string>true</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${xml(path.join(this.logDir, "stdout.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(path.join(this.logDir, "stderr.log"))}</string>
</dict>
</plist>
`;
  }
  writeLaunchAgent() {
    const next = this.plist();
    const current = fs.existsSync(this.launchAgent)
      ? fs.readFileSync(this.launchAgent, "utf8")
      : null;
    const changed = current !== next;
    fs.mkdirSync(path.dirname(this.launchAgent), { recursive: true });
    fs.mkdirSync(this.logDir, { recursive: true, mode: 0o700 });
    if (changed) {
      const temp = `${this.launchAgent}.${process.pid}.tmp`;
      fs.writeFileSync(temp, next, { mode: 0o600 });
      fs.chmodSync(temp, 0o600);
      fs.renameSync(temp, this.launchAgent);
    }
    fs.chmodSync(this.launchAgent, 0o600);
    return {
      path: this.launchAgent,
      changed,
      label: this.launchdLabel,
    };
  }

  async loaded() {
    if (this.skipLaunchd) return false;
    try {
      await this.execFileImpl(
        "/bin/launchctl",
        ["print", `gui/${this.uid}/${this.launchdLabel}`],
        { timeout: 3_000, maxBuffer: 1024 * 1024 },
      );
      return true;
    } catch {
      return false;
    }
  }

  async bootstrap() {
    if (this.skipLaunchd) {
      return { skipped: true, label: this.launchdLabel };
    }
    const target = `gui/${this.uid}/${this.launchdLabel}`;
    await this.execFileImpl("/bin/launchctl", ["bootout", target], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    }).catch(() => undefined);

    const deadline = this.monotonicNow() + 4_000;
    while (this.monotonicNow() < deadline) {
      if (!(await this.loaded())) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    let lastError = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        await this.execFileImpl(
          "/bin/launchctl",
          ["bootstrap", `gui/${this.uid}`, this.launchAgent],
          { timeout: 8_000, maxBuffer: 1024 * 1024 },
        );
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 5) {
          await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
        }
      }
    }
    if (lastError) throw lastError;

    await this.execFileImpl(
      "/bin/launchctl",
      ["kickstart", "-k", target],
      { timeout: 8_000, maxBuffer: 1024 * 1024 },
    );
    return { skipped: false, label: this.launchdLabel };
  }

  async ensure() {
    const launchAgent = this.writeLaunchAgent();
    const loaded = await this.loaded();
    if (this.skipLaunchd) {
      return { launchAgent, launchd: { skipped: true, label: this.launchdLabel } };
    }
    if (loaded && !launchAgent.changed) {
      return {
        launchAgent,
        launchd: {
          skipped: true,
          label: this.launchdLabel,
          reason: "already_loaded",
        },
      };
    }
    const launchd = await this.bootstrap();
    this.onEvent("info", "Connectivity Host LaunchAgent ready", {
      label: this.launchdLabel,
      changed: launchAgent.changed,
    });
    return { launchAgent, launchd };
  }
}
