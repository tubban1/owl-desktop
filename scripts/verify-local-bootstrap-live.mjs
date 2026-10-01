#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { LocalRuntimeBootstrap } from "../electron/services/local-runtime-bootstrap.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resourcesPath = path.resolve(
  process.env.OWL_BOOTSTRAP_RESOURCES_PATH?.trim() ||
    path.join(root, "vendor"),
);
const desktopExecPath = path.resolve(
  process.env.OWL_BOOTSTRAP_EXEC_PATH?.trim() ||
    path.join(
      root,
      "node_modules",
      "electron",
      "dist",
      "Electron.app",
      "Contents",
      "MacOS",
      "Electron",
    ),
);

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (!port) reject(new Error("No free port allocated."));
        else resolve(port);
      });
    });
  });
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), "owl-bootstrap-live-"));
for (const dir of ["Desktop", "Documents", "Downloads"]) {
  fs.mkdirSync(path.join(home, dir), { recursive: true });
}

const port = await freePort();
const label = `com.owl.runtime.bootstrap-e2e.${process.pid}`;
if (!fs.existsSync(desktopExecPath)) {
  throw new Error(`Desktop runtime executable is missing: ${desktopExecPath}`);
}

const secrets = new Map();
const store = {
  getSettings() {
    return {
      wakeName: "OWL",
      wakeAliases: ["OWL Runtime", "AgentOS"],
      allowedDirectories: [
        path.join(home, "Desktop"),
        path.join(home, "Documents"),
        path.join(home, "Downloads"),
      ],
    };
  },
  readSecret(name, project) {
    return secrets.get(`${project}:${name}`);
  },
  upsertSecret({ name, project, value }) {
    secrets.set(`${project}:${name}`, value);
    return { name, project };
  },
};

const events = [];
const bootstrap = new LocalRuntimeBootstrap({
  resourcesPath,
  desktopExecPath,
  store,
  homeDir: home,
  uid: process.getuid(),
  runtimePort: port,
  launchdLabel: label,
  onEvent(level, message, meta) {
    events.push({ level, message, meta });
  },
});

try {
  const result = await bootstrap.ensure();
  if (result.health?.reachable !== true) {
    throw new Error("Bundled Runtime did not become reachable.");
  }
  if (result.health?.apiVersion !== "0.1") {
    throw new Error(
      `Unexpected Runtime API ${result.health?.apiVersion ?? "unknown"}`,
    );
  }

  const { stdout: launchd } = await execFileAsync(
    "/bin/launchctl",
    ["print", `gui/${process.getuid()}/${label}`],
    { timeout: 5_000, maxBuffer: 2 * 1024 * 1024 },
  );
  if (!/state = running/.test(launchd)) {
    throw new Error("Runtime LaunchAgent is not running.");
  }

  const token = secrets.get("owl-runtime:OWL_RUNTIME_API_TOKEN");
  const response = await fetch(
    `http://127.0.0.1:${port}/runtime/v0.1/info`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  );
  const info = await response.json();
  if (!response.ok || info?.ok !== true) {
    throw new Error("Runtime public info failed after bootstrap.");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        gate: "Packaged local Runtime bootstrap",
        source:
          process.env.OWL_BOOTSTRAP_RESOURCES_PATH?.trim()
            ? "packaged Desktop resources"
            : "Desktop vendor release components",
        runtimeApiVersion: result.health.apiVersion,
        runtimeVersion: result.health.runtimeVersion,
        launchdLabel: label,
        launchdRunning: true,
        runtimeHostInstalled: fs.existsSync(
          path.join(
            home,
            "Applications",
            "OWL Runtime.app",
            "Contents",
            "MacOS",
            "OwlRuntimeHost",
          ),
        ),
        helperInstalled: fs.existsSync(
          path.join(
            home,
            "Applications",
            "OWL LAB Helper.app",
            "Contents",
            "MacOS",
            "ComputerMCPHelper",
          ),
        ),
        apiTokenPersistedToDesktopVaultBoundary: Boolean(token),
        defaultPolicy: {
          allowedDirectories: result.environment.allowedDirectories,
          write: result.environment.allowWrite,
          delete: result.environment.allowDelete,
          shell: result.environment.allowShell,
          gui: result.environment.allowGui,
        },
        eventCount: events.length,
      },
      null,
      2,
    ),
  );
} finally {
  const target = `gui/${process.getuid()}/${label}`;
  await execFileAsync("/bin/launchctl", ["bootout", target], {
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  }).catch(() => undefined);
  fs.rmSync(home, { recursive: true, force: true });
}
