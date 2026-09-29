export const LOGIN_STATES = [
  "needs_login",
  "waiting_for_human",
  "authenticating",
  "ready",
  "expired",
  "failed",
];

const transitions = new Map([
  ["needs_login", new Set(["waiting_for_human", "authenticating", "ready", "failed"])],
  ["waiting_for_human", new Set(["authenticating", "ready", "expired", "failed"])],
  ["authenticating", new Set(["waiting_for_human", "ready", "expired", "failed"])],
  ["ready", new Set(["expired", "needs_login"])],
  ["expired", new Set(["needs_login", "waiting_for_human", "authenticating"])],
  ["failed", new Set(["needs_login", "waiting_for_human", "authenticating"])],
]);

export function isLoginState(value) {
  return LOGIN_STATES.includes(value);
}

export function assertLoginTransition(from, to) {
  if (!isLoginState(from) || !isLoginState(to)) {
    throw new Error(`Unknown login state transition: ${from} → ${to}`);
  }
  if (from === to) return true;
  if (!transitions.get(from)?.has(to)) {
    throw new Error(`Invalid login state transition: ${from} → ${to}`);
  }
  return true;
}

export function loginChallengeFor(authMethod) {
  if (["qr", "passkey", "authenticator_push", "device_code"].includes(authMethod)) {
    return { interactive: true, state: "waiting_for_human" };
  }
  if (["sms_otp", "email_otp", "totp"].includes(authMethod)) {
    return { interactive: true, state: "waiting_for_human" };
  }
  return { interactive: false, state: "authenticating" };
}
