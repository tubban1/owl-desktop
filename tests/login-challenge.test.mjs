import { describe, expect, it } from "vitest";
import {
  assertLoginTransition,
  loginChallengeFor,
} from "../electron/services/login-challenge.mjs";

describe("login challenge state", () => {
  it("keeps QR, OTP, passkey and authenticator flows human-in-the-loop", () => {
    for (const method of [
      "qr",
      "sms_otp",
      "email_otp",
      "totp",
      "passkey",
      "authenticator_push",
      "device_code",
    ]) {
      expect(loginChallengeFor(method)).toEqual({
        interactive: true,
        state: "waiting_for_human",
      });
    }
  });

  it("permits normal successful login progression", () => {
    expect(assertLoginTransition("needs_login", "waiting_for_human")).toBe(true);
    expect(assertLoginTransition("waiting_for_human", "authenticating")).toBe(true);
    expect(assertLoginTransition("authenticating", "ready")).toBe(true);
    expect(assertLoginTransition("ready", "expired")).toBe(true);
  });

  it("rejects impossible shortcuts", () => {
    expect(() => assertLoginTransition("ready", "authenticating"))
      .toThrow("Invalid login state transition");
  });
});
