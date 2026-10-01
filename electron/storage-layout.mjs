import fs from "node:fs";
import path from "node:path";

const PRODUCT_NAME = "OWL LAB";
const MIGRATION_VERSION = 1;
const DESKTOP_STATE_FILES = [
  "settings.json",
  "secrets.json",
  "identity-accounts.json",
  "cloud-bridge-state.json",
  "remote-submissions.json",
  "planner-continuation.json",
  "agent-inbox.json",
  "runtime-agent-request-consumer.json",
  "runtime-agent-request-event-bridge.json",
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function copyDesktopState(sourceRoot, desktopRoot) {
  const report = {
    version: MIGRATION_VERSION,
    sourceRoot,
    destinationRoot: desktopRoot,
    copied: [],
    preservedExisting: [],
    missing: [],
    errors: [],
    completedAt: new Date().toISOString(),
  };

  if (!sourceRoot || path.resolve(sourceRoot) === path.resolve(desktopRoot)) {
    report.skipped = "already_canonical";
    return report;
  }

  for (const name of DESKTOP_STATE_FILES) {
    const source = path.join(sourceRoot, name);
    const destination = path.join(desktopRoot, name);
    if (!fs.existsSync(source)) {
      report.missing.push(name);
      continue;
    }
    if (fs.existsSync(destination)) {
      report.preservedExisting.push(name);
      continue;
    }
    try {
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination, 0o600);
      report.copied.push(name);
    } catch (error) {
      report.errors.push({
        name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}

export function configureOwlDesktopStorage(app) {
  const legacyUserDataRoot = app.getPath("userData");
  const productRoot = path.join(app.getPath("appData"), PRODUCT_NAME);
  const desktopRoot = path.join(productRoot, "desktop");
  const stagingRoot = path.join(productRoot, "staging");
  const logsRoot = path.join(productRoot, "logs");
  const desktopLogsRoot = path.join(logsRoot, "desktop");
  const cacheRoot = path.join(productRoot, "cache");
  const desktopSessionRoot = path.join(cacheRoot, "desktop-session");
  const diagnosticsRoot = path.join(productRoot, "diagnostics");
  const migrationRoot = path.join(desktopRoot, "migrations");

  [
    productRoot,
    desktopRoot,
    stagingRoot,
    logsRoot,
    desktopLogsRoot,
    cacheRoot,
    desktopSessionRoot,
    diagnosticsRoot,
    migrationRoot,
  ].forEach(ensureDir);

  const migrationReportFile = path.join(
    migrationRoot,
    `storage-layout-v${MIGRATION_VERSION}.json`,
  );

  let migration = null;
  if (fs.existsSync(migrationReportFile)) {
    try {
      const existing = JSON.parse(
        fs.readFileSync(migrationReportFile, "utf8"),
      );
      if (existing?.version === MIGRATION_VERSION) migration = existing;
    } catch {
      // Invalid evidence is regenerated below; source state remains untouched.
    }
  }

  if (!migration) {
    migration = copyDesktopState(legacyUserDataRoot, desktopRoot);
    fs.writeFileSync(
      migrationReportFile,
      JSON.stringify(migration, null, 2) + "\n",
      { mode: 0o600 },
    );
  }

  app.setPath("userData", desktopRoot);
  app.setPath("sessionData", desktopSessionRoot);
  app.setPath("logs", desktopLogsRoot);

  return {
    version: MIGRATION_VERSION,
    productRoot,
    desktopRoot,
    stagingRoot,
    logsRoot,
    desktopLogsRoot,
    cacheRoot,
    desktopSessionRoot,
    diagnosticsRoot,
    migrationReportFile,
    legacyUserDataRoot,
    migration,
  };
}
