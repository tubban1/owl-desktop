import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installStdioEpipeGuard } from "../scripts/lib/stdio-epipe-guard.mjs";

describe("inherited stdio EPIPE resilience", () => {
  it("absorbs only EPIPE and detaches listeners on cleanup", () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const uninstall = installStdioEpipeGuard({ stdout, stderr });
    expect(() => stdout.emit("error", Object.assign(new Error("broken"), { code: "EPIPE" }))).not.toThrow();
    expect(() => stderr.emit("error", Object.assign(new Error("broken"), { code: "EPIPE" }))).not.toThrow();
    expect(() => stdout.emit("error", Object.assign(new Error("unrelated"), { code: "EACCES" }))).toThrow("unrelated");
    uninstall();
    expect(stdout.listenerCount("error")).toBe(0);
    expect(stderr.listenerCount("error")).toBe(0);
  });

  it("keeps a detached child alive after the parent closes inherited pipes", async () => {
    const moduleFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/lib/stdio-epipe-guard.mjs");
    const code = [
      `import { installStdioEpipeGuard } from ${JSON.stringify(pathToFileURL(moduleFile).href)};`,
      "installStdioEpipeGuard();",
      'process.stdout.write("READY\\n");',
      'setTimeout(() => { process.stdout.write("AFTER\\n"); process.stderr.write("STILL\\n"); }, 40);',
      "setTimeout(() => process.exit(0), 150);",
    ].join("\n");
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.stdout.once("data", () => {
        child.stdout.destroy();
        child.stderr.destroy();
      });
      child.once("close", resolve);
    });
    expect(exitCode).toBe(0);
  }, 10_000);
});
