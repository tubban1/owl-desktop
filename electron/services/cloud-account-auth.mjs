import { createHash, randomBytes } from "node:crypto";

function base64url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function assertAuthConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("OWL Cloud auth configuration is missing.");
  }
  if (config.provider !== "cognito") {
    throw new Error("Unsupported OWL Cloud auth provider.");
  }
  if (config.pkce?.required !== true || config.pkce?.method !== "S256") {
    throw new Error("OWL Cloud auth must require PKCE S256.");
  }
  for (const key of [
    "clientId",
    "authorizationEndpoint",
    "tokenEndpoint",
    "redirectUri",
  ]) {
    if (typeof config[key] !== "string" || !config[key].trim()) {
      throw new Error(`OWL Cloud auth configuration is missing ${key}.`);
    }
  }
}

export class CloudAccountAuth {
  constructor({ cloudClient, fetchImpl = fetch } = {}) {
    if (!cloudClient) throw new Error("CloudAccountAuth requires a Cloud client.");
    this.cloudClient = cloudClient;
    this.fetchImpl = fetchImpl;
    this.pending = null;
  }

  async begin({ useDevelopmentRedirect = false } = {}) {
    const discovered = await this.cloudClient.authConfig();
    assertAuthConfig(discovered);
    const redirectUri = useDevelopmentRedirect
      ? discovered.developmentRedirectUri
      : discovered.redirectUri;
    if (typeof redirectUri !== "string" || !redirectUri.trim()) {
      throw new Error(
        useDevelopmentRedirect
          ? "OWL Cloud auth configuration is missing developmentRedirectUri."
          : "OWL Cloud auth configuration is missing redirectUri.",
      );
    }
    const config = {
      ...discovered,
      redirectUri,
    };

    const verifier = base64url(randomBytes(48));
    const state = base64url(randomBytes(32));
    const challenge = base64url(
      createHash("sha256").update(verifier).digest(),
    );

    const url = new URL(config.authorizationEndpoint);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("response_type", config.responseType ?? "code");
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("scope", (config.scopes ?? ["openid"]).join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");

    this.pending = {
      config,
      verifier,
      state,
      createdAt: new Date().toISOString(),
    };

    return {
      authorizationUrl: url.toString(),
      redirectUri: config.redirectUri,
      provider: config.provider,
      region: config.region ?? null,
      createdAt: this.pending.createdAt,
    };
  }

  hasPending() {
    return Boolean(this.pending);
  }

  clear() {
    this.pending = null;
  }

  async refresh(refreshToken) {
    if (!refreshToken) throw new Error("OWL Cloud refresh token is required.");
    const config = await this.cloudClient.authConfig();
    assertAuthConfig(config);

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      refresh_token: refreshToken,
    });
    const response = await this.fetchImpl(config.tokenEndpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    const text = await response.text();
    let tokens;
    try {
      tokens = text ? JSON.parse(text) : {};
    } catch {
      throw new Error("Cognito refresh endpoint returned non-JSON.");
    }
    if (!response.ok) {
      throw new Error(
        tokens?.error_description ??
          tokens?.error ??
          `Cognito token refresh failed with HTTP ${response.status}.`,
      );
    }
    if (!tokens?.access_token || !tokens?.id_token) {
      throw new Error("Cognito token refresh returned incomplete tokens.");
    }
    return {
      accessToken: tokens.access_token,
      idToken: tokens.id_token,
      refreshToken: tokens.refresh_token ?? refreshToken,
      expiresIn: Number(tokens.expires_in ?? 0) || null,
      tokenType: tokens.token_type ?? "Bearer",
      scope: tokens.scope ?? null,
    };
  }

  async complete(callbackUrl) {
    const pending = this.pending;
    if (!pending) {
      throw new Error("No OWL Cloud login is pending.");
    }

    const callback = new URL(callbackUrl);
    const expected = new URL(pending.config.redirectUri);
    if (
      callback.protocol !== expected.protocol ||
      callback.host !== expected.host ||
      callback.pathname !== expected.pathname
    ) {
      throw new Error("OWL Cloud login callback URI does not match discovery.");
    }

    const error = callback.searchParams.get("error");
    if (error) {
      const description = callback.searchParams.get("error_description");
      this.clear();
      throw new Error(
        description ? `OWL Cloud login failed: ${description}` : `OWL Cloud login failed: ${error}`,
      );
    }

    const state = callback.searchParams.get("state");
    if (!state || state !== pending.state) {
      throw new Error("OWL Cloud login callback state mismatch.");
    }
    const code = callback.searchParams.get("code");
    if (!code) {
      throw new Error("OWL Cloud login callback did not include an authorization code.");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: pending.config.clientId,
      code,
      redirect_uri: pending.config.redirectUri,
      code_verifier: pending.verifier,
    });

    const response = await this.fetchImpl(pending.config.tokenEndpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    const text = await response.text();
    let tokens;
    try {
      tokens = text ? JSON.parse(text) : {};
    } catch {
      this.clear();
      throw new Error("Cognito token endpoint returned non-JSON.");
    }
    if (!response.ok) {
      this.clear();
      throw new Error(
        tokens?.error_description ??
          tokens?.error ??
          `Cognito token exchange failed with HTTP ${response.status}.`,
      );
    }
    if (!tokens?.access_token || !tokens?.id_token) {
      this.clear();
      throw new Error("Cognito token exchange returned incomplete tokens.");
    }

    this.clear();
    return {
      accessToken: tokens.access_token,
      idToken: tokens.id_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresIn: Number(tokens.expires_in ?? 0) || null,
      tokenType: tokens.token_type ?? "Bearer",
      scope: tokens.scope ?? null,
    };
  }
}
