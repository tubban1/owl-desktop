import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function readEnv(file) {
  if (!fs.existsSync(file)) return new Map();
  const map = new Map();
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ")
      ? line.slice(7)
      : line;
    const index = normalized.indexOf("=");
    if (index <= 0) continue;
    map.set(
      normalized.slice(0, index).trim(),
      normalized.slice(index + 1).trim().replace(/^['"]|['"]$/g, ""),
    );
  }
  return map;
}

function writeEnv(file, values) {
  const keys = [
    "PORT",
    "OWL_WAKE_NAME",
    "ELECTRON_RUN_AS_NODE",
    "OWL_RUNTIME_ACCESS_MODE",
    "OWL_APPROVAL_MODE",
    "ALLOWED_DIRECTORIES",
    "ALLOW_WRITE",
    "ALLOW_DELETE",
    "ALLOW_SHELL",
    "ALLOW_GUI",
    "OWL_RUNTIME_API_TOKEN",
  ];
  const lines = [
    "# Managed by OWL LAB Desktop.",
    "# High-risk capabilities remain off unless the user enables them explicitly.",
  ];
  for (const key of keys) {
    const value = values.get(key);
    if (value !== undefined) lines.push(`${key}=${value}`);
  }
  for (const [key, value] of values) {
    if (!keys.includes(key)) lines.push(`${key}=${value}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function shortSha(value) {
  return String(value || "").slice(0, 12);
}

function copyApp(source, destination) {
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true });
  const temp = path.join(
    parent,
    `.${path.basename(destination)}.tmp-${process.pid}-${Date.now()}`,
  );
  fs.rmSync(temp, { recursive: true, force: true });
  fs.cpSync(source, temp, { recursive: true, force: true });
  fs.rmSync(destination, { recursive: true, force: true });
  fs.renameSync(temp, destination);
}

function bundleVersion(plist) {
  if (!fs.existsSync(plist)) return null;
  const text = fs.readFileSync(plist, "utf8");
  return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(text)?.[1] ?? null;
}

function bundleIdentifier(plist) {
  if (!fs.existsSync(plist)) return null;
  const text = fs.readFileSync(plist, "utf8");
  return /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(text)?.[1] ?? null;
}

export class LocalRuntimeBootstrap {
  constructor({
    resourcesPath,
    desktopExecPath,
    store,
    homeDir = os.homedir(),
    uid = process.getuid?.() ?? 501,
    runtimePort = 8788,
    launchdLabel = "com.owl.runtime",
    fetchImpl = fetch,
    execFileImpl = execFileAsync,
    skipLaunchd = false,
    onEvent = () => {},
  } = {}) {
    if (!resourcesPath) throw new Error("LocalRuntimeBootstrap requires resourcesPath.");
    if (!desktopExecPath) throw new Error("LocalRuntimeBootstrap requires desktopExecPath.");
    if (!store) throw new Error("LocalRuntimeBootstrap requires Desktop store.");
    this.resourcesPath = resourcesPath;
    this.desktopExecPath = desktopExecPath;
    this.store = store;
    this.homeDir = homeDir;
    this.uid = uid;
    this.runtimePort = runtimePort;
    this.launchdLabel = launchdLabel;
    this.fetchImpl = fetchImpl;
    this.execFileImpl = execFileImpl;
    this.skipLaunchd = skipLaunchd;
    this.onEvent = onEvent;

    this.owlHome = path.join(homeDir, ".owl");
    this.releaseRoot = path.join(this.owlHome, "releases");
    this.currentLink = path.join(this.owlHome, "current");
    this.envFile = path.join(this.owlHome, "runtime.env");
    this.logDir = path.join(this.owlHome, "logs");
    this.stateRoot = path.join(homeDir, ".owl-runtime");
    this.launchAgent = path.join(
      homeDir,
      "Library",
      "LaunchAgents",
      `${launchdLabel}.plist`,
    );
    this.runtimeHostDestination = path.join(
      homeDir,
      "Applications",
      "OWL Runtime.app",
    );
    this.helperDestination = path.join(
      homeDir,
      "Applications",
      "OWL LAB Helper.app",
    );
  }

  resource(...parts) {
    return path.join(this.resourcesPath, ...parts);
  }

  async ensureNativeApps() {
    const components = [
      {
        name: "Runtime Host",
        source: this.resource("runtime-host", "OWL Runtime.app"),
        destination: this.runtimeHostDestination,
        bundle: "fan.fde.owl.runtime",
        version: "1.0.0",
      },
      {
        name: "Helper",
        source: this.resource("helper", "OWL LAB Helper.app"),
        destination: this.helperDestination,
        bundle: "fan.fde.owl.helper",
        version: "1.0.0",
      },
    ];

    const installed = [];
    for (const component of components) {
      const sourcePlist = path.join(component.source, "Contents", "Info.plist");
      if (!fs.existsSync(sourcePlist)) {
        throw new Error(`Packaged ${component.name} is missing: ${component.source}`);
      }
      if (
        bundleIdentifier(sourcePlist) !== component.bundle ||
        bundleVersion(sourcePlist) !== component.version
      ) {
        throw new Error(`Packaged ${component.name} identity is invalid.`);
      }

      const destPlist = path.join(
        component.destination,
        "Contents",
        "Info.plist",
      );
      const unchanged =
        bundleIdentifier(destPlist) === component.bundle &&
        bundleVersion(destPlist) === component.version;

      if (!unchanged) {
        copyApp(component.source, component.destination);
        this.onEvent("info", `${component.name} installed`, {
          path: component.destination,
          bundleIdentifier: component.bundle,
          version: component.version,
        });
      }
      installed.push({
        name: component.name,
        installed: true,
        changed: !unchanged,
        path: component.destination,
        bundleIdentifier: component.bundle,
        version: component.version,
      });
    }
    return installed;
  }

  installRuntimeRelease() {
    const source = this.resource("owl-runtime");
    const manifestFile = path.join(source, "component.json");
    if (!fs.existsSync(manifestFile)) {
      throw new Error("Packaged OWL Runtime manifest is missing.");
    }
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    if (
      manifest.component !== "owl-runtime" ||
      manifest.apiVersion !== "0.1" ||
      !manifest.version ||
      !manifest.gitSha
    ) {
      throw new Error("Packaged OWL Runtime manifest is invalid.");
    }

    const releaseName = `${manifest.version}-${shortSha(manifest.gitSha)}`;
    const releaseDir = path.join(this.releaseRoot, releaseName);
    fs.mkdirSync(this.releaseRoot, { recursive: true });
    fs.mkdirSync(this.logDir, { recursive: true });

    let changed = false;
    if (!fs.existsSync(path.join(releaseDir, "component.json"))) {
      const temp = path.join(
        this.releaseRoot,
        `.tmp-${releaseName}-${process.pid}`,
      );
      fs.rmSync(temp, { recursive: true, force: true });
      fs.cpSync(source, temp, { recursive: true, force: true });
      fs.renameSync(temp, releaseDir);
      changed = true;
    }

    const existing = fs.existsSync(this.currentLink)
      ? fs.realpathSync(this.currentLink)
      : null;
    const canonicalRelease = fs.realpathSync(releaseDir);
    if (existing !== canonicalRelease) {
      fs.rmSync(this.currentLink, { recursive: true, force: true });
      fs.symlinkSync(releaseDir, this.currentLink, "dir");
      changed = true;
    }

    this.onEvent("info", "Runtime release prepared", {
      releaseDir,
      version: manifest.version,
      gitSha: manifest.gitSha,
      changed,
    });
    return { manifest, releaseDir, changed };
  }

  ensureEnvironment() {
    const env = readEnv(this.envFile);
    const standardRoots = [
      path.join(this.homeDir, "Desktop"),
      path.join(this.homeDir, "Documents"),
      path.join(this.homeDir, "Downloads"),
    ].filter((candidate) => fs.existsSync(candidate));

    if (!env.has("PORT")) env.set("PORT", String(this.runtimePort));
    if (!env.has("OWL_WAKE_NAME")) env.set("OWL_WAKE_NAME", "OWL");
    env.set("ELECTRON_RUN_AS_NODE", "1");
    env.set("OWL_RUNTIME_ACCESS_MODE", "enforced");
    env.set("OWL_APPROVAL_MODE", "enforce");
    if (!env.has("ALLOWED_DIRECTORIES")) {
      env.set("ALLOWED_DIRECTORIES", standardRoots.join(","));
    }
    if (!env.has("ALLOW_WRITE")) env.set("ALLOW_WRITE", "true");
    if (!env.has("ALLOW_DELETE")) env.set("ALLOW_DELETE", "false");
    if (!env.has("ALLOW_SHELL")) env.set("ALLOW_SHELL", "false");
    if (!env.has("ALLOW_GUI")) env.set("ALLOW_GUI", "true");

    let token = env.get("OWL_RUNTIME_API_TOKEN");
    if (!token) {
      token =
        this.store.readSecret("OWL_RUNTIME_API_TOKEN", "owl-runtime") ??
        randomBytes(32).toString("base64url");
      env.set("OWL_RUNTIME_API_TOKEN", token);
    }
    writeEnv(this.envFile, env);

    this.store.upsertSecret({
      name: "OWL_RUNTIME_API_TOKEN",
      project: "owl-runtime",
      value: token,
    });

    return {
      token,
      port: Number(env.get("PORT") || this.runtimePort),
      allowedDirectories: env.get("ALLOWED_DIRECTORIES") ?? "",
      allowWrite: env.get("ALLOW_WRITE") === "true",
      allowDelete: env.get("ALLOW_DELETE") === "true",
      allowShell: env.get("ALLOW_SHELL") === "true",
      allowGui: env.get("ALLOW_GUI") === "true",
    };
  }

  writeLaunchAgent() {
    const hostBinary = path.join(
      this.runtimeHostDestination,
      "Contents",
      "MacOS",
      "OwlRuntimeHost",
    );
    const serverScript = path.join(
      this.currentLink,
      "dist",
      "server.js",
    );
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(this.launchdLabel)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(hostBinary)}</string>
    <string>--env-file</string>
    <string>${xml(this.envFile)}</string>
    <string>${xml(this.desktopExecPath)}</string>
    <string>${xml(serverScript)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(this.currentLink)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${xml(path.join(this.logDir, "runtime.stdout.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(path.join(this.logDir, "runtime.stderr.log"))}</string>
</dict>
</plist>
`;
    fs.mkdirSync(path.dirname(this.launchAgent), { recursive: true });
    fs.writeFileSync(this.launchAgent, plist, { mode: 0o600 });
    fs.chmodSync(this.launchAgent, 0o600);
    return { hostBinary, serverScript };
  }

  async restartLaunchd() {
    if (this.skipLaunchd) {
      return { skipped: true, label: this.launchdLabel };
    }
    const target = `gui/${this.uid}/${this.launchdLabel}`;
    await this.execFileImpl("/bin/launchctl", ["bootout", target], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    }).catch(() => undefined);
    await this.execFileImpl(
      "/bin/launchctl",
      ["bootstrap", `gui/${this.uid}`, this.launchAgent],
      { timeout: 8_000, maxBuffer: 1024 * 1024 },
    );
    await this.execFileImpl(
      "/bin/launchctl",
      ["kickstart", "-k", target],
      { timeout: 8_000, maxBuffer: 1024 * 1024 },
    );
    return { skipped: false, label: this.launchdLabel };
  }

  async waitForHealth(token, port, timeoutMs = 20_000) {
    if (this.skipLaunchd) {
      return { skipped: true, reachable: false };
    }
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1_000);
      try {
        const response = await this.fetchImpl(
          `http://127.0.0.1:${port}/runtime/v0.1/info`,
          {
            headers: {
              authorization: `Bearer ${token}`,
            },
            signal: controller.signal,
          },
        );
        if (response.ok) {
          const payload = await response.json();
          if (payload?.ok === true && payload?.apiVersion === "0.1") {
            return {
              skipped: false,
              reachable: true,
              apiVersion: payload.apiVersion,
              runtimeVersion: payload?.result?.runtimeVersion ?? null,
            };
          }
        }
        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      } finally {
        clearTimeout(timer);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(
      `OWL Runtime did not become healthy on port ${port}: ${lastError ?? "unknown error"}`,
    );
  }

  async ensure() {
    const nativeApps = await this.ensureNativeApps();
    const release = this.installRuntimeRelease();
    const environment = this.ensureEnvironment();
    const launchAgent = this.writeLaunchAgent();
    const launchd = await this.restartLaunchd();
    const health = await this.waitForHealth(
      environment.token,
      environment.port,
    );

    return {
      ok: true,
      nativeApps,
      release,
      environment: {
        port: environment.port,
        allowedDirectories: environment.allowedDirectories,
        allowWrite: environment.allowWrite,
        allowDelete: environment.allowDelete,
        allowShell: environment.allowShell,
        allowGui: environment.allowGui,
      },
      launchAgent,
      launchd,
      health,
    };
  }
}
