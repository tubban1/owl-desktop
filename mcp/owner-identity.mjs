import { createHash } from "node:crypto";

export const OWL_OWNER_HEADER = "x-owl-owner-id";
export const LEGACY_OWNER_HEADER = "x-computer-mcp-owner-id";

function firstHeader(headers, name) {
  const value = headers?.[name];
  const candidate = Array.isArray(value) ? value[0] : value;
  const trimmed = typeof candidate === "string" ? candidate.trim() : "";
  if (!trimmed || trimmed.length > 512) return undefined;
  return trimmed;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function resolveOwnerIdentity(headers, transportSessionId) {
  const explicit =
    firstHeader(headers, OWL_OWNER_HEADER) ??
    firstHeader(headers, LEGACY_OWNER_HEADER);

  if (explicit) {
    return {
      runtimeSessionId: `owl-owner:${digest(explicit)}`,
      stable: true,
      source: "explicit-header",
    };
  }

  return {
    runtimeSessionId: `owl-mcp:${transportSessionId}`,
    stable: false,
    source: "transport-session",
  };
}
