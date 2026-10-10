import { createHash } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const MAX_NATIVE_IMAGE_BYTES = 4 * 1024 * 1024;
function reject(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function detectMime(bytes) {
  if (bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 6 && ["GIF87a","GIF89a"].includes(bytes.toString("ascii",0,6))) return "image/gif";
  return null;
}

/** Caller must use the authenticated OWL Runtime fs.stat/get policy primitive. */
export async function readAuthorizedLocalImage(inputPath, authorize, maxBytes = MAX_NATIVE_IMAGE_BYTES) {
  if (typeof inputPath !== "string" || !inputPath) reject("An image path is required.", "IMAGE_PATH_INVALID");
  // Do not touch the local path before the Runtime authorizes it.
  const authorized = await authorize(inputPath);
  if (authorized?.type !== "file" || typeof authorized.path !== "string" ||
    !Number.isSafeInteger(authorized.size) || authorized.size <= 0)
    reject("Runtime did not authorize a regular file.", "IMAGE_NOT_FILE");
  if (authorized.size > maxBytes)
    reject("Image exceeds the MCP 4 MiB transfer limit. Compress it first.", "IMAGE_TOO_LARGE");
  const canonical = await fs.realpath(inputPath);
  if (canonical !== authorized.path) reject("Image path changed after authorization.", "IMAGE_PATH_CHANGED");
  const fd = await fs.open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await fd.stat();
    if (!stat.isFile() || stat.size !== authorized.size ||
        stat.mtime.toISOString() !== authorized.modifiedAt)
      reject("Image changed since Runtime authorization.", "IMAGE_CHANGED");
    const bytes = await fd.readFile();
    if (bytes.length > maxBytes || bytes.length !== stat.size)
      reject("Image grew or changed during read.", "IMAGE_CHANGED");
    if ((await fs.realpath(inputPath)) !== canonical)
      reject("Image path changed during read.", "IMAGE_PATH_CHANGED");
    const mimeType = detectMime(bytes);
    if (!mimeType) reject("Image must be PNG, JPEG, WebP or GIF (magic bytes checked).", "IMAGE_FORMAT_UNSUPPORTED");
    return {
      data: bytes.toString("base64"),
      mimeType, name: path.basename(canonical), bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } finally {
    await fd.close();
  }
}
