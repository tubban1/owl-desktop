import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectivityHostLaunchAgent } from "../electron/services/connectivity-host-launch-agent.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tempHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-connectivity-agent-"));
  roots.push(root);
  return root;
}

describe("ConnectivityHostLaunchAgent", () => {
  it("writes a private KeepAlive background LaunchAgent without secrets", () => {
    const homeDir = tempHome();
    const service = new ConnectivityHostLaunchAgent({
      desktopExecPath: "/Applications/OWL LAB Desktop.app/Contents/MacOS/OWL LAB Desktop",
      homeDir,
      skipLaunchd: true,
    });
    const result = service.writeLaunchAgent();
    const plist = fs.readFileSync(result.path, "utf8");
    const mode = fs.statSync(result.path).mode & 0o777;

    expect(mode).toBe(0o600);
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("<string>Background</string>");
    expect(plist).toContain("<key>OWL_CONNECTIVITY_HOST_ONLY</key>");
    expect(plist).toContain("<string>true</string>");
    expect(plist).toContain("OWL LAB Desktop.app/Contents/MacOS/OWL LAB Desktop");
    expect(plist).not.toMatch(/TOKEN|API_KEY|DEVICE_CREDENTIAL|Bearer|owldev1\./);
  });

  it("allows only non-secret isolation overrides in the LaunchAgent", () => {
    const homeDir = tempHome();
    const service = new ConnectivityHostLaunchAgent({
      desktopExecPath: "/Applications/OWL LAB Desktop.app/Contents/MacOS/OWL LAB Desktop",
      homeDir,
      launchdLabel: "ai.owl.desktop.connectivity-host.soak",
      throttleIntervalSeconds: 1,
      environmentVariables: {
        OWL_CONNECTIVITY_HOST_STORE_ROOT: "/tmp/owl-soak-store",
        OWL_CONNECTION_HOST_PORT: "8891",
        OWL_MCP_PORT: "8890",
        OWL_DESKTOP_USER_DATA_DIR: "/tmp/owl-soak-data",
      },
      skipLaunchd: true,
    });
    const plist = service.plist();

    expect(plist).toContain("ai.owl.desktop.connectivity-host.soak");
    expect(plist).toContain("OWL_CONNECTION_HOST_PORT");
    expect(plist).toContain("8891");
    expect(plist).toContain("OWL_MCP_PORT");
    expect(plist).toContain("8890");
    expect(plist).toContain("<integer>1</integer>");
    expect(plist).not.toMatch(/TOKEN|API_KEY|DEVICE_CREDENTIAL|Bearer|owldev1\./);
  });

  it("rejects secret-bearing LaunchAgent environment overrides", () => {
    expect(
      () =>
        new ConnectivityHostLaunchAgent({
          desktopExecPath: "/Applications/OWL LAB Desktop.app/Contents/MacOS/OWL LAB Desktop",
          homeDir: tempHome(),
          environmentVariables: {
            OWL_MCP_API_TOKEN: "must-never-enter-plist",
          },
          skipLaunchd: true,
        }),
    ).toThrow(/refuses non-allowlisted environment key/);
  });

  it("does not restart an unchanged already-loaded service", async () => {
    const homeDir = tempHome();
    const calls = [];
    const execFileImpl = vi.fn(async (_bin, args) => {
      calls.push(args);
      if (args[0] === "print") return { stdout: "loaded", stderr: "" };
      return { stdout: "", stderr: "" };
    });
    const service = new ConnectivityHostLaunchAgent({
      desktopExecPath: "/Applications/OWL LAB Desktop.app/Contents/MacOS/OWL LAB Desktop",
      homeDir,
      execFileImpl,
    });
    service.writeLaunchAgent();
    const result = await service.ensure();
    expect(result.launchAgent.changed).toBe(false);
    expect(result.launchd.reason).toBe("already_loaded");
    expect(calls.some((args) => args[0] === "bootstrap")).toBe(false);
    expect(calls.some((args) => args[0] === "kickstart")).toBe(false);
  });

  it("bootstraps and kickstarts when the LaunchAgent changes", async () => {
    const homeDir = tempHome();
    let loaded = true;
    const calls = [];
    const execFileImpl = vi.fn(async (_bin, args) => {
      calls.push(args);
      if (args[0] === "print") {
        if (loaded) return { stdout: "loaded", stderr: "" };
        throw Object.assign(new Error("not loaded"), { code: 113 });
      }
      if (args[0] === "bootout") {
        loaded = false;
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "bootstrap") {
        loaded = true;
        return { stdout: "", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });
    const service = new ConnectivityHostLaunchAgent({
      desktopExecPath: "/Applications/OWL LAB Desktop.app/Contents/MacOS/OWL LAB Desktop",
      homeDir,
      execFileImpl,
    });
    const result = await service.ensure();
    expect(result.launchAgent.changed).toBe(true);
    expect(calls.some((args) => args[0] === "bootout")).toBe(true);
    expect(calls.some((args) => args[0] === "bootstrap")).toBe(true);
    expect(calls.some((args) => args[0] === "kickstart")).toBe(true);
  });
});
