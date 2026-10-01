#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preferredSource = path.join(root, "assets", "owl1254.png");
const fallbackSource = path.join(root, "assets", "owl-desktop-icon.svg");
const source = fs.existsSync(preferredSource) ? preferredSource : fallbackSource;
const buildDir = path.join(root, "build");
const output = path.join(buildDir, "icon.icns");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} exited with ${result.status}`);
  }
  return (result.stdout || result.stderr || "").trim();
}

if (!fs.existsSync(source)) {
  throw new Error(`OWL LAB icon source is missing: ${source}`);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "owl-desktop-icon-"));
try {
  const iconset = path.join(temp, "OWLDesktop.iconset");
  fs.mkdirSync(iconset, { recursive: true });

  let sourcePng = source;
  if (path.extname(source).toLowerCase() !== ".png") {
    const previewDir = path.join(temp, "preview");
    fs.mkdirSync(previewDir, { recursive: true });
    run("/usr/bin/qlmanage", ["-t", "-s", "1024", "-o", previewDir, source]);
    sourcePng = path.join(previewDir, `${path.basename(source)}.png`);
    if (!fs.existsSync(sourcePng)) {
      throw new Error("Quick Look did not render the OWL LAB icon source.");
    }
  }

  const variants = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];

  for (const [size, name] of variants) {
    const target = path.join(iconset, name);
    fs.copyFileSync(sourcePng, target);
    run("/usr/bin/sips", ["-z", String(size), String(size), target]);
  }

  fs.mkdirSync(buildDir, { recursive: true });
  fs.rmSync(output, { force: true });
  run("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", output]);

  const info = run("/usr/bin/file", [output]);
  if (!/(Apple Icon Image format|Mac OS X icon)/.test(info)) {
    throw new Error(`Unexpected icon artifact: ${info}`);
  }

  const dimensions = run("/usr/bin/sips", [
    "-g",
    "pixelWidth",
    "-g",
    "pixelHeight",
    sourcePng,
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        source: path.relative(root, source),
        output: path.relative(root, output),
        format: "icns",
        generatedSizes: variants.map(([size]) => size),
        sourceDimensions: dimensions,
      },
      null,
      2,
    ),
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
