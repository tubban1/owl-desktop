const ACCESS_KEYS = [
  "canView",
  "canRun",
  "canSchedule",
  "canApprove",
];

export function normalizeEffectiveAccess(payload) {
  const source =
    payload?.effectiveAccess && typeof payload.effectiveAccess === "object"
      ? payload.effectiveAccess
      : payload ?? {};

  return Object.fromEntries(
    ACCESS_KEYS.map((key) => [key, source[key] === true]),
  );
}

export function cloudAccessAllows(access, capability) {
  if (!ACCESS_KEYS.includes(capability)) return false;
  return normalizeEffectiveAccess(access)[capability] === true;
}

export function cloudAccessKeys() {
  return [...ACCESS_KEYS];
}
