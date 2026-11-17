import path from "node:path";

// Native Messaging Host accepts only immutable owl-desktop-<sha7> roots.
// Apply the same requirement BEFORE stopping the current healthy Desktop.
// No IO and no platform-specific side effects.
export function macReleaseNameMatchesSha(root, sha) {
  return typeof root === "string" && path.isAbsolute(root) &&
    typeof sha === "string" && /^[a-f0-9]{40}$/.test(sha) &&
    path.basename(path.normalize(root)) === "owl-desktop-" + sha.slice(0,7);
}
