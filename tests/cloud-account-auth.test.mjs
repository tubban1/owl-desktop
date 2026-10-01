import { describe, expect, it, vi } from "vitest";
import { CloudAccountAuth } from "../electron/services/cloud-account-auth.mjs";

function config() {
  return {
    contractVersion: 1,
    provider: "cognito",
    region: "eu-central-1",
    issuer: "https://issuer.example.test",
    clientId: "desktop-client",
    authorizationEndpoint: "https://login.example.test/oauth2/authorize",
    tokenEndpoint: "https://login.example.test/oauth2/token",
    logoutEndpoint: "https://login.example.test/logout",
    redirectUri: "owl-desktop://auth/callback",
    developmentRedirectUri: "http://127.0.0.1:18991/auth/callback",
    logoutRedirectUri: "owl-desktop://auth/logout",
    scopes: ["openid", "email", "profile"],
    responseType: "code",
    pkce: { required: true, method: "S256" },
  };
}

describe("CloudAccountAuth", () => {
  it("creates a Cognito authorization URL with PKCE S256", async () => {
    const cloudClient = { authConfig: vi.fn(async () => config()) };
    const auth = new CloudAccountAuth({ cloudClient, fetchImpl: vi.fn() });

    const started = await auth.begin();
    const url = new URL(started.authorizationUrl);

    expect(url.origin + url.pathname).toBe(
      "https://login.example.test/oauth2/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("desktop-client");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "owl-desktop://auth/callback",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(auth.hasPending()).toBe(true);
  });

  it("uses the loopback callback for development authorization and token exchange", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: "access-token",
          id_token: "id-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const auth = new CloudAccountAuth({
      cloudClient: { authConfig: vi.fn(async () => config()) },
      fetchImpl,
    });

    const started = await auth.begin({ useDevelopmentRedirect: true });
    const authorize = new URL(started.authorizationUrl);
    expect(started.redirectUri).toBe(
      "http://127.0.0.1:18991/auth/callback",
    );
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:18991/auth/callback",
    );

    const state = authorize.searchParams.get("state");
    await auth.complete(
      `http://127.0.0.1:18991/auth/callback?code=dev-code&state=${encodeURIComponent(state)}`,
    );
    const [, init] = fetchImpl.mock.calls[0];
    const body = new URLSearchParams(init.body);
    expect(body.get("redirect_uri")).toBe(
      "http://127.0.0.1:18991/auth/callback",
    );
  });

  it("rejects a callback with a mismatched state", async () => {
    const auth = new CloudAccountAuth({
      cloudClient: { authConfig: vi.fn(async () => config()) },
      fetchImpl: vi.fn(),
    });
    await auth.begin();

    await expect(
      auth.complete(
        "owl-desktop://auth/callback?code=abc&state=wrong-state",
      ),
    ).rejects.toThrow("state mismatch");
  });

  it("exchanges the code with the verifier and returns tokens only to main-process code", async () => {
    const fetchImpl = vi.fn(async (_url, init) =>
      new Response(
        JSON.stringify({
          access_token: "access-token",
          id_token: "id-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const auth = new CloudAccountAuth({
      cloudClient: { authConfig: vi.fn(async () => config()) },
      fetchImpl,
    });

    const started = await auth.begin();
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    const tokens = await auth.complete(
      `owl-desktop://auth/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    );

    expect(tokens).toMatchObject({
      accessToken: "access-token",
      idToken: "id-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://login.example.test/oauth2/token");
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_id")).toBe("desktop-client");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("code_verifier")).toBeTruthy();
    expect(auth.hasPending()).toBe(false);
  });
});
