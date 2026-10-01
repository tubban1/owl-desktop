import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configureOwlDesktopStorage } from "../electron/storage-layout.mjs";

const roots = [];

function makeApp(root, legacyUserData) {
  const paths = {
    appData: path.join(root, "Application Support"),
    userData: legacyUserData,
  };
  fs.mkdirSync(paths.appData, { recursive: true });
  return {
    getPath(name) {
      if (!(name in paths)) throw new Error(`Unexpected getPath(${name})`);
      return paths[name];
    },
    setPath(name, value) {
      paths[name] = value;
    },
    paths,
  };
}

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owl-desktop-storage-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length) {
    fs.rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe("OWL LAB Desktop storage layout", () => {
  it("copies known legacy Desktop state without deleting the source", () => {
    const root = tempRoot();
    const legacy = path.join(root, "legacy-desktop");
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(
      path.join(legacy, "settings.json"),
      JSON.stringify({ tunnelId: "legacy-tunnel" }),
    );
    fs.writeFileSync(
      path.join(legacy, "secrets.json"),
      JSON.stringify([{ id: "secret-1" }]),
    );

    const app = makeApp(root, legacy);
    const layout = configureOwlDesktopStorage(app);

    expect(app.paths.userData).toBe(layout.desktopRoot);
    expect(app.paths.sessionData).toBe(layout.desktopSessionRoot);
    expect(app.paths.logs).toBe(layout.desktopLogsRoot);
    expect(fs.existsSync(path.join(legacy, "settings.json"))).toBe(true);
    expect(
      JSON.parse(
        fs.readFileSync(path.join(layout.desktopRoot, "settings.json"), "utf8"),
      ).tunnelId,
    ).toBe("legacy-tunnel");
    expect(layout.migration.copied).toContain("settings.json");
    expect(layout.migration.copied).toContain("secrets.json");
    expect(fs.existsSync(layout.migrationReportFile)).toBe(true);
  });

  it("never overwrites canonical Desktop state during migration", () => {
    const root = tempRoot();
    const legacy = path.join(root, "legacy-desktop");
    const canonicalDesktop = path.join(
      root,
      "Application Support",
      "OWL LAB",
      "desktop",
    );
    fs.mkdirSync(legacy, { recursive: true });
    fs.mkdirSync(canonicalDesktop, { recursive: true });
    fs.writeFileSync(
      path.join(legacy, "settings.json"),
      JSON.stringify({ source: "legacy" }),
    );
    fs.writeFileSync(
      path.join(canonicalDesktop, "settings.json"),
      JSON.stringify({ source: "canonical" }),
    );

    const app = makeApp(root, legacy);
    const layout = configureOwlDesktopStorage(app);

    expect(
      JSON.parse(
        fs.readFileSync(path.join(layout.desktopRoot, "settings.json"), "utf8"),
      ).source,
    ).toBe("canonical");
    expect(layout.migration.preservedExisting).toContain("settings.json");
  });

  it("preserves the first migration report as immutable evidence", () => {
    const root = tempRoot();
    const legacy = path.join(root, "legacy-desktop");
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(
      path.join(legacy, "settings.json"),
      JSON.stringify({ source: "legacy-v1" }),
    );

    const firstApp = makeApp(root, legacy);
    const first = configureOwlDesktopStorage(firstApp);
    const firstReportText = fs.readFileSync(first.migrationReportFile, "utf8");
    const firstReport = JSON.parse(firstReportText);

    expect(firstReport.copied).toContain("settings.json");

    fs.writeFileSync(
      path.join(legacy, "settings.json"),
      JSON.stringify({ source: "legacy-later" }),
    );

    const secondApp = makeApp(root, legacy);
    const second = configureOwlDesktopStorage(secondApp);
    const secondReportText = fs.readFileSync(second.migrationReportFile, "utf8");

    expect(secondReportText).toBe(firstReportText);
    expect(second.migration.completedAt).toBe(firstReport.completedAt);
    expect(second.migration.copied).toContain("settings.json");
    expect(
      JSON.parse(
        fs.readFileSync(path.join(second.desktopRoot, "settings.json"), "utf8"),
      ).source,
    ).toBe("legacy-v1");
  });
});
