import { createHash } from "node:crypto";

export const OWL_OWNER_HEADER = "x-owl-owner-id";
export const LEGACY_OWNER_HEADER = "x-computer-mcp-owner-id";
export const OWL_CLIENT_KIND_HEADER = "x-owl-client-kind";
export const OWL_CLIENT_LABEL_HEADER = "x-owl-client-label";

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

function clientMetadata(headers, fallbackKind) {
  const requestedKind = firstHeader(headers, OWL_CLIENT_KIND_HEADER);
  const allowedKinds = new Set([
    "chatgpt",
    "worker",
    "cloud",
    "desktop",
    "agent",
    "mcp",
  ]);
  const clientKind = allowedKinds.has(requestedKind)
    ? requestedKind
    : fallbackKind;
  const requestedLabel = firstHeader(headers, OWL_CLIENT_LABEL_HEADER);
  return {
    clientKind,
    clientLabel: requestedLabel ? requestedLabel.slice(0, 80) : null,
  };
}

export function resolveOwnerIdentity(
  headers,
  transportSessionId,
  fallbackOwnerId,
) {
  const explicit =
    firstHeader(headers, OWL_OWNER_HEADER) ??
    firstHeader(headers, LEGACY_OWNER_HEADER);

  if (explicit) {
    return {
      runtimeSessionId: `owl-owner:${digest(explicit)}`,
      stable: true,
      source: "explicit-header",
      ...clientMetadata(headers, "chatgpt"),
    };
  }

  const fallback =
    typeof fallbackOwnerId === "string" ? fallbackOwnerId.trim() : "";
  if (fallback && fallback.length <= 512) {
    return {
      runtimeSessionId: `owl-owner:${digest(fallback)}`,
      stable: true,
      source: "desktop-session",
      ...clientMetadata(headers, "desktop"),
    };
  }

  return {
    runtimeSessionId: `owl-mcp:${transportSessionId}`,
    stable: false,
    source: "transport-session",
    ...clientMetadata(headers, "mcp"),
  };
}
