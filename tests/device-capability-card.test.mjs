import { describe, expect, it } from "vitest";
import { buildSafeDeviceCapabilityCard } from "../electron/services/device-capability-card.mjs";

describe("buildSafeDeviceCapabilityCard", () => {
  it("projects capability booleans without leaking provider paths or executables", () => {
    const card = buildSafeDeviceCapabilityCard({
      providers: [
        {
          id: "filesystem",
          enabled: true,
          available: true,
          details: {
            allowedDirectories: ["/Users/private/Documents"],
            runtimeOwnedDirectories: ["/Users/private/staging"],
            write: true,
            delete: false,
          },
        },
        {
          id: "shell",
          enabled: true,
          available: true,
          details: { enabledBy: "ALLOW_SHELL" },
        },
        {
          id: "git",
          enabled: true,
          available: true,
          details: { push: false },
        },
        {
          id: "browser",
          enabled: true,
          available: true,
          details: {
            executable: "/Applications/Secret Browser",
            cdpPort: 12345,
          },
        },
        {
          id: "desktop",
          enabled: true,
          available: true,
          details: {
            helperSocketPath: "/Users/private/helper.sock",
            helperAppPath: "/Users/private/Helper.app",
          },
        },
      ],
      extensions: {
        userSkillRegistry: { status: "candidate" },
      },
      architecture: {
        primitiveAbi: { version: 1 },
        verifierAbi: { version: 1 },
      },
    });

    expect(card).toEqual({
      providers: {
        filesystem: { available: true, write: true, delete: false },
        shell: { available: true },
        git: { available: true, push: false },
        browser: { available: true },
        desktop: { available: true },
      },
      skillRegistry: true,
      verification: true,
      primitiveAbiVersion: 1,
    });

    const serialized = JSON.stringify(card);
    for (const secret of [
      "allowedDirectories",
      "/Users/private",
      "helperSocketPath",
      "helperAppPath",
      "executable",
      "cdpPort",
      "ALLOW_SHELL",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
