import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  CloudEnrollmentService,
  cloudEnrollmentSecretNames,
} from "../electron/services/cloud-enrollment-service.mjs";

function authConfig() {
  return {
    contractVersion: 1,
    provider: "cognito",
    region: "eu-central-1",
    issuer: "https://issuer.example",
    clientId: "client_public",
    authorizationEndpoint: "https://auth.example/oauth2/authorize",
    tokenEndpoint: "https://auth.example/oauth2/token",
    logoutEndpoint: "https://auth.example/logout",
    redirectUri: "owl-desktop://auth/callback",
    logoutRedirectUri: "owl-desktop://auth/logout",
    scopes: ["openid", "email", "profile"],
    responseType: "code",
    pkce: { required: true, method: "S256" },
  };
}

function setup(overrides = {}) {
  const opened = [];
  const stored = [];
  const deleted = [];
  const settings = [];
  const client = {
    authConfig: vi.fn(async () => authConfig()),
    bootstrap: vi.fn(async () => ({
      userId: "usr_1",
      organizationId: "org_1",
      membershipId: "mem_1",
      role: "owner",
      email: "owner@example.com",
    })),
    registerDevice: vi.fn(async () => ({
      deviceId: "dev_1",
      deviceCredential: "owldev1.dev_1.secret-material",
    })),
  };

  const fetchImpl = vi.fn(async (_url, init) => {
    const form = new URLSearchParams(init.body);
    return new Response(
      JSON.stringify({
        id_token: "id-token-value",
        access_token: "access-token-value",
        refresh_token: "refresh-token-value",
        expires_in: 3600,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  const service = new CloudEnrollmentService({
    client,
    openExternal: vi.fn(async (url) => {
      opened.push(url);
    }),
    storeSecret: vi.fn(async (input) => {
      stored.push(input);
    }),
    deleteSecret: vi.fn(async (name, project) => {
      deleted.push({ name, project });
    }),
    updateSettings: vi.fn(async (patch) => {
      settings.push(patch);
    }),
    buildDeviceRegistration: vi.fn(async () => ({
      displayName: "JennyMacBook-Air · OWL Desktop",
      platform: "darwin-arm64",
    })),
    fetchImpl,
    now: () => new Date("2026-09-29T18:00:00.000Z"),
    ...overrides,
  });

  return {
    service,
    client,
    fetchImpl,
    opened,
    stored,
    deleted,
    settings,
  };
}

describe("CloudEnrollmentService", () => {
  it("uses Authorization Code + PKCE and never exposes credentials in its snapshot", async () => {
    const x = setup();
    const waiting = await x.service.begin();

    expect(waiting.status).toBe("waiting_for_browser");
    expect(x.opened).toHaveLength(1);

    const authorization = new URL(x.opened[0]);
    expect(authorization.searchParams.get("response_type")).toBe("code");
    expect(authorization.searchParams.get("client_id")).toBe("client_public");
    expect(authorization.searchParams.get("redirect_uri")).toBe(
      "owl-desktop://auth/callback",
    );
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.has("client_secret")).toBe(false);

    const state = authorization.searchParams.get("state");
    const callback =
      `owl-desktop://auth/callback?code=authorization-code&state=${encodeURIComponent(state)}`;
    const ready = await x.service.handleCallback(callback);

    expect(ready).toMatchObject({
      status: "ready",
      deviceId: "dev_1",
      account: {
        userId: "usr_1",
        organizationId: "org_1",
        role: "owner",
      },
      lastErrorCode: null,
    });
    expect(JSON.stringify(ready)).not.toContain("id-token-value");
    expect(JSON.stringify(ready)).not.toContain("refresh-token-value");
    expect(JSON.stringify(ready)).not.toContain("secret-material");

    const [, tokenInit] = x.fetchImpl.mock.calls[0];
    const tokenForm = new URLSearchParams(tokenInit.body);
    expect(tokenForm.get("grant_type")).toBe("authorization_code");
    expect(tokenForm.get("client_secret")).toBeNull();
    const verifier = tokenForm.get("code_verifier");
    const expectedChallenge = createHash("sha256")
      .update(verifier, "utf8")
      .digest("base64url");
    expect(authorization.searchParams.get("code_challenge")).toBe(
      expectedChallenge,
    );

    expect(x.client.bootstrap).toHaveBeenCalledWith("id-token-value");
    expect(x.client.registerDevice).toHaveBeenCalledWith(
      "id-token-value",
      expect.objectContaining({ platform: "darwin-arm64" }),
    );

    expect(x.stored).toEqual([
      {
        name: cloudEnrollmentSecretNames.accountRefreshToken,
        project: "owl-cloud",
        value: "refresh-token-value",
      },
      {
        name: cloudEnrollmentSecretNames.deviceCredential,
        project: "owl-cloud",
        value: "owldev1.dev_1.secret-material",
      },
    ]);
    expect(x.settings).toEqual([
      { cloudDeviceId: "dev_1", cloudEnabled: true },
    ]);
  });

  it("fails closed on OAuth state mismatch before token exchange", async () => {
    const x = setup();
    await x.service.begin();

    const result = await x.service.handleCallback(
      "owl-desktop://auth/callback?code=authorization-code&state=wrong",
    );

    expect(result).toMatchObject({
      status: "error",
      lastErrorCode: "CLOUD_AUTH_STATE_MISMATCH",
    });
    expect(x.fetchImpl).not.toHaveBeenCalled();
    expect(x.client.bootstrap).not.toHaveBeenCalled();
    expect(x.client.registerDevice).not.toHaveBeenCalled();
  });

  it("signs out the human account without revoking the enrolled device", async () => {
    const x = setup({ initialDeviceId: "dev_existing" });

    const result = await x.service.logoutAccount();

    expect(result).toMatchObject({
      status: "device_enrolled",
      deviceId: "dev_existing",
      account: null,
    });
    expect(x.deleted).toEqual([
      {
        name: cloudEnrollmentSecretNames.accountRefreshToken,
        project: "owl-cloud",
      },
    ]);
    expect(x.opened).toHaveLength(1);
    const logout = new URL(x.opened[0]);
    expect(logout.pathname).toBe("/logout");
    expect(logout.searchParams.get("client_id")).toBe("client_public");
    expect(logout.searchParams.get("logout_uri")).toBe(
      "owl-desktop://auth/logout",
    );
  });
});
