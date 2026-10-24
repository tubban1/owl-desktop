#!/usr/bin/env node
// Regenerate a clean, scalable SVG + transparent PNG icons from the user-supplied
// chrome-agent-native/master.png. Does not modify the original master artwork.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "chrome-agent-native", "master.png");
const out = path.join(root, "chrome-agent-native", "icons");
if (!fs.existsSync(source)) throw new Error("Source artwork not found: " + source);
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const sizeText = run("magick", [source, "-channel", "R", "-separate", "+channel",
  "-threshold", "48%", "-trim", "-format", "%wx%h", "info:"]).trim();
const [width, height] = sizeText.split("x").map(Number);
if (![width, height].every(n => Number.isInteger(n) && n > 50)) throw new Error("Invalid artwork bounds");
const side = Math.ceil(Math.max(width, height) * 1.09 / 2) * 2;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "owl-icon-trace-"));
fs.mkdirSync(out, { recursive: true });
try {
  const mask = path.join(tmp, "owl-mask.pbm");
  // The white master background becomes vector transparency, while the blue
  // owl is accurately traced. The 4.5% margin protects tips at 16x16.
  run("magick", [source, "-channel", "R", "-separate", "+channel",
    "-threshold", "48%", "-trim", "+repage", "-gravity", "center",
    "-background", "white", "-extent", side + "x" + side, "pbm:" + mask]);
  const svg = path.join(out, "icon.svg");
  run("potrace", ["-s", "-t", "7", "-O", "0.2", "-C", "#0877F7", "-o", svg, mask]);
  for (const size of [16, 32, 48, 128, 256]) {
    run("magick", ["-background", "none", "-density", "144", svg,
      "-resize", size + "x" + size, "png32:" + path.join(out, "icon" + size + ".png")]);
  }
  console.log(JSON.stringify({ source, vector: svg, outputSizes:[16,32,48,128,256],
    sourceBounds:{width,height}, vectorCanvas:side },null,2));
} finally {
  fs.rmSync(tmp, { force: true, recursive: true });
}
