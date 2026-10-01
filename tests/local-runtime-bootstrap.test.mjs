import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalRuntimeBootstrap } from "../electron/services/local-runtime-bootstrap.mjs";

const scratch = [];

afterEach(() => {
  while (scratch.length) {
    fs.rmSync(scratch.pop(), { recursive: true, force: true });
  }
});

function plist(bundleIdentifier, version, executable) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleIdentifier}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleExecutable</key><string>${executable}</string>
</dict></plist>`;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-bootstrap-test-"));
  scratch.push(root);
  const resources = path.join(root, "resources");
  const home = path.join(root, "home");
  fs.mkdirSync(path.join(home, "Desktop"), { recursive: true });
  fs.mkdirSync(path.join(home, "Documents"), { recursive: true });
  fs.mkdirSync(path.join(home, "Downloads"), { recursive: true });

  const runtime = path.join(resources, "owl-runtime");
  fs.mkdirSync(path.join(runtime, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(runtime, "component.json"),
    JSON.stringify({
      component: "owl-runtime",
      version: "1.0.0-rc.4",
      gitSha: "d6320d29941fe0d4e94e28cf94c5eb9f1d1ab681",
      apiVersion: "0.1",
    }),
  );
  fs.writeFileSync(path.join(runtime, "dist", "server.js"), "console.log('runtime');\n");
  fs.writeFileSync(path.join(runtime, "package.json"), JSON.stringify({ name: "owl-runtime" }));

  const host = path.join(resources, "runtime-host", "OWL Runtime.app");
  fs.mkdirSync(path.join(host, "Contents", "MacOS"), { recursive: true });
  fs.writeFileSync(
    path.join(host, "Contents", "Info.plist"),
    plist("fan.fde.owl.runtime", "1.0.0", "OwlRuntimeHost"),
  );
  fs.writeFileSync(path.join(host, "Contents", "MacOS", "OwlRuntimeHost"), "#!/bin/sh\n");
  fs.chmodSync(path.join(host, "Contents", "MacOS", "OwlRuntimeHost"), 0o755);

  const helper = path.join(resources, "helper", "OWL LAB Helper.app");
  fs.mkdirSync(path.join(helper, "Contents", "MacOS"), { recursive: true });
  fs.writeFileSync(
    path.join(helper, "Contents", "Info.plist"),
    plist("fan.fde.owl.helper", "1.0.0", "ComputerMCPHelper"),
  );
  fs.writeFileSync(path.join(helper, "Contents", "MacOS", "ComputerMCPHelper"), "#!/bin/sh\n");
  fs.chmodSync(path.join(helper, "Contents", "MacOS", "ComputerMCPHelper"), 0o755);

  const secrets = new Map();
  const store = {
    readSecret: vi.fn((name, project) => secrets.get(`${project}:${name}`)),
    upsertSecret: vi.fn(({ name, project, value }) => {
      secrets.set(`${project}:${name}`, value);
      return { name, project };
    }),
  };

  return { root, resources, home, store, secrets };
}

describe("LocalRuntimeBootstrap", () => {
  it("installs packaged components and prepares a safe local Runtime", async () => {
    const f = fixture();
    const bootstrap = new LocalRuntimeBootstrap({
      resourcesPath: f.resources,
      desktopExecPath: "/Applications/OWL LAB Desktop.app/Contents/MacOS/OWL LAB Desktop",
      store: f.store,
      homeDir: f.home,
      uid: 501,
      runtimePort: 8788,
      skipLaunchd: true,
    });

    const result = await bootstrap.ensure();

    expect(result.ok).toBe(true);
    expect(result.release.manifest.gitSha).toBe(
      "d6320d29941fe0d4e94e28cf94c5eb9f1d1ab681",
    );
    expect(
      fs.existsSync(
        path.join(
          f.home,
          "Applications",
          "OWL Runtime.app",
          "Contents",
          "MacOS",
          "OwlRuntimeHost",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          f.home,
          "Applications",
          "OWL LAB Helper.app",
          "Contents",
          "MacOS",
          "ComputerMCPHelper",
        ),
      ),
    ).toBe(true);

    const current = fs.realpathSync(path.join(f.home, ".owl", "current"));
    expect(current).toContain("1.0.0-rc.4-d6320d29941f");

    const env = fs.readFileSync(path.join(f.home, ".owl", "runtime.env"), "utf8");
    expect(env).toContain("PORT=8788");
    expect(env).toContain("ELECTRON_RUN_AS_NODE=1");
    expect(env).toContain("OWL_RUNTIME_ACCESS_MODE=enforced");
    expect(env).toContain("OWL_APPROVAL_MODE=enforce");
    expect(env).toContain("ALLOW_WRITE=true");
    expect(env).toContain("ALLOW_DELETE=false");
    expect(env).toContain("ALLOW_SHELL=false");
    expect(env).toContain("ALLOW_GUI=true");
    expect(env).toContain(path.join(f.home, "Desktop"));
    expect(f.store.upsertSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "OWL_RUNTIME_API_TOKEN",
        project: "owl-runtime",
      }),
    );

    const launchAgent = fs.readFileSync(
      path.join(
        f.home,
        "Library",
        "LaunchAgents",
        "com.owl.runtime.plist",
      ),
      "utf8",
    );
    expect(launchAgent).toContain("com.owl.runtime");
    expect(launchAgent).toContain("OWL Runtime.app");
    expect(launchAgent).toContain("OWL LAB Desktop.app");
    expect(launchAgent).toContain(".owl/current/dist/server.js");
  });


  it("keeps an already healthy packaged Runtime running without launchd churn", async () => {
    const f = fixture();
    const releaseDir = path.join(
      f.home,
      ".owl",
      "releases",
      "1.0.0-rc.4-d6320d29941f",
    );
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        service: "owl-runtime",
        version: "1.0.0-rc.4",
        publicApiVersion: "0.1",
        runtime: {
          mode: "production",
          stateRoot: path.join(f.home, ".owl-runtime"),
          codeRoot: releaseDir,
        },
      }),
    });
    const execFileImpl = vi.fn().mockResolvedValue({ stdout: "loaded" });

    const bootstrap = new LocalRuntimeBootstrap({
      resourcesPath: f.resources,
      desktopExecPath: "/Applications/OWL LAB Desktop.app/Contents/MacOS/OWL LAB Desktop",
      store: f.store,
      homeDir: f.home,
      uid: 501,
      runtimePort: 8788,
      fetchImpl,
      execFileImpl,
    });

    const result = await bootstrap.ensure();

    expect(result.launchd).toMatchObject({
      skipped: true,
      reason: "already_healthy",
    });
    expect(
      execFileImpl.mock.calls.some(([, args]) => args?.[0] === "bootout"),
    ).toBe(false);
    expect(
      execFileImpl.mock.calls.some(([, args]) => args?.[0] === "bootstrap"),
    ).toBe(false);

    const env = fs.readFileSync(path.join(f.home, ".owl", "runtime.env"), "utf8");
    expect(env).toContain("OWL_RUNTIME_MODE=production");
    expect(env).toContain(`OWL_STATE_ROOT=${path.join(f.home, ".owl-runtime")}`);
  });

  it("rejects a foreign Runtime already owning the configured port", async () => {
    const f = fixture();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        service: "owl-runtime",
        version: "1.0.0-rc.4",
        publicApiVersion: "0.1",
        runtime: {
          mode: "development",
          stateRoot: path.join(f.home, ".owl-runtime-dev"),
          codeRoot: "/tmp/owl-runtime-dev",
        },
      }),
    });
    const execFileImpl = vi.fn().mockRejectedValue(new Error("not loaded"));

    const bootstrap = new LocalRuntimeBootstrap({
      resourcesPath: f.resources,
      desktopExecPath: "/Applications/OWL LAB Desktop.app/Contents/MacOS/OWL LAB Desktop",
      store: f.store,
      homeDir: f.home,
      uid: 501,
      runtimePort: 8788,
      fetchImpl,
      execFileImpl,
    });

    await expect(bootstrap.ensure()).rejects.toMatchObject({
      code: "RUNTIME_PORT_CONFLICT",
    });
    expect(
      execFileImpl.mock.calls.some(([, args]) => args?.[0] === "bootstrap"),
    ).toBe(false);
  });

  it("retries launchctl bootstrap after a transient error 5 race", async () => {
    const f = fixture();
    const releaseDir = path.join(
      f.home,
      ".owl",
      "releases",
      "1.0.0-rc.4-d6320d29941f",
    );
    let healthCalls = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      healthCalls += 1;
      if (healthCalls === 1) throw new Error("connect ECONNREFUSED");
      return {
        ok: true,
        json: async () => ({
          ok: true,
          service: "owl-runtime",
          version: "1.0.0-rc.4",
          publicApiVersion: "0.1",
          runtime: {
            mode: "production",
            stateRoot: path.join(f.home, ".owl-runtime"),
            codeRoot: releaseDir,
          },
        }),
      };
    });

    let bootstrapAttempts = 0;
    const execFileImpl = vi.fn().mockImplementation(async (_command, args) => {
      if (args[0] === "print") throw new Error("not loaded");
      if (args[0] === "bootstrap") {
        bootstrapAttempts += 1;
        if (bootstrapAttempts === 1) {
          const error = new Error("Bootstrap failed: 5: Input/output error");
          error.code = 5;
          throw error;
        }
      }
      return { stdout: "" };
    });

    const bootstrap = new LocalRuntimeBootstrap({
      resourcesPath: f.resources,
      desktopExecPath: "/Applications/OWL LAB Desktop.app/Contents/MacOS/OWL LAB Desktop",
      store: f.store,
      homeDir: f.home,
      uid: 501,
      runtimePort: 8788,
      fetchImpl,
      execFileImpl,
    });

    const result = await bootstrap.ensure();
    expect(result.health).toMatchObject({
      reachable: true,
      mode: "production",
    });
    expect(bootstrapAttempts).toBe(2);
  });

  it("is idempotent and preserves same-version native permission identities", async () => {
    const f = fixture();
    const events = [];
    const bootstrap = new LocalRuntimeBootstrap({
      resourcesPath: f.resources,
      desktopExecPath: "/Applications/OWL LAB Desktop.app/Contents/MacOS/OWL LAB Desktop",
      store: f.store,
      homeDir: f.home,
      skipLaunchd: true,
      onEvent: (level, message, meta) => events.push({ level, message, meta }),
    });

    const first = await bootstrap.ensure();
    const host = path.join(
      f.home,
      "Applications",
      "OWL Runtime.app",
      "Contents",
      "Resources",
      "permission-marker.txt",
    );
    fs.mkdirSync(path.dirname(host), { recursive: true });
    fs.writeFileSync(host, "preserve-me");

    const second = await bootstrap.ensure();

    expect(first.nativeApps.every((item) => item.changed)).toBe(true);
    expect(second.nativeApps.every((item) => !item.changed)).toBe(true);
    expect(fs.readFileSync(host, "utf8")).toBe("preserve-me");
    expect(second.release.changed).toBe(false);
  });
});
