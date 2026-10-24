// Narrow, explicit tab authority; no cookies, password fields, or debugger.
export const GRANT_MS = 120_000;
export const MAX_TEXT_CHARS = 5_000;
export function siteOrigin(url) {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.origin : null;
  } catch { return null; }
}
export function grantFor(tab, now = Date.now()) {
  const origin = siteOrigin(tab?.url);
  if (!origin || !Number.isInteger(tab?.id) || tab.id < 0) {
    throw new Error("Only an active HTTP(S) browser tab can be authorized.");
  }
  return {tabId: tab.id, origin, expiresAt: now + GRANT_MS};
}
export function grantIsCurrent(grant, tab, now = Date.now()) {
  return Boolean(grant && now < grant.expiresAt &&
    grant.tabId === tab?.id && grant.origin === siteOrigin(tab?.url));
}
export function sanitizeSnapshot(snapshot) {
  return {
    origin: siteOrigin(snapshot?.url),
    title: String(snapshot?.title || "").slice(0, 200),
    text: String(snapshot?.text || "").slice(0, MAX_TEXT_CHARS),
    controls: Array.isArray(snapshot?.controls)
      ? snapshot.controls.slice(0, 50).map(c => ({
        tag: String(c.tag || "").slice(0, 32),
        type: String(c.type || "").slice(0, 32),
        label: String(c.label || "").slice(0, 140)
      })) : []
  };
}
