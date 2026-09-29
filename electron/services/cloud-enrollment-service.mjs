import { createHash, randomBytes } from "node:crypto";

const ACCOUNT_REFRESH_SECRET = "OWL_CLOUD_ACCOUNT_REFRESH_TOKEN";
const DEVICE_CREDENTIAL_SECRET = "OWL_CLOUD_DEVICE_CREDENTIAL";
const SECRET_SCOPE = "owl-cloud";

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

export function createPkcePair() {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(
    createHash("sha256").update(verifier, "utf8").digest(),
  );
  return { verifier, challenge };
}

function sameCallbackTarget(actualUrl, expectedUrl) {
  const actual = new URL(actualUrl);
  const expected = new URL(expectedUrl);
  return (
    actual.protocol === expected.protocol &&
    actual.hostname === expected.hostname &&
    actual.pathname === expected.pathname
  );
}

function requireAuthConfig(config) {
  if (!config || typeof config !== "object") {
    throw Object.assign(new Error("Cloud auth discovery returned no config."), {
      code: "CLOUD_AUTH_CONFIG_INVALID",
    });
  }
  if (
    config.provider !== "cognito" ||
    config.responseType !== "code" ||
    config.pkce?.required !== true ||
    config.pkce?.method !== "S256"
  ) {
    throw Object.assign(
      new Error("Cloud auth provider does not satisfy Desktop PKCE contract."),
      { code: "CLOUD_AUTH_CONTRACT_UNSUPPORTED" },
    );
  }
  for (const field of [
    "clientId",
    "authorizationEndpoint",
    "tokenEndpoint",
    "logoutEndpoint",
    "redirectUri",
    "logoutRedirectUri",
  ]) {
    if (typeof config[field] !== "string" || !config[field]) {
      throw Object.assign(new Error(`Cloud auth config missing ${field}.`), {
        code: "CLOUD_AUTH_CONFIG_INVALID",
      });
    }
  }
  return config;
}

export function buildAuthorizationUrl(config, {
  state,
  challenge,
} = {}) {
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set(
    "scope",
    Array.isArray(config.scopes)
      ? config.scopes.join(" ")
      : "openid email profile",
  );
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function parseJsonResponse(response, code) {
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw Object.assign(
        new Error(`Cloud identity provider returned non-JSON HTTP ${response.status}.`),
        { code },
      );
    }
  }
  if (!response.ok) {
    throw Object.assign(
      new Error(
        payload.error_description ??
          payload.error ??
          `Cloud identity provider HTTP ${response.status}`,
      ),
      { code },
    );
  }
  return payload;
}

export class CloudEnrollmentService {
  constructor({
    client,
    openExternal,
    storeSecret,
    deleteSecret,
    updateSettings,
    buildDeviceRegistration,
    fetchImpl = fetch,
    onEvent = () => {},
    now = () => new Date(),
  }) {
    this.client = client;
    this.openExternal = openExternal;
    this.storeSecret = storeSecret;
    this.deleteSecret = deleteSecret;
    this.updateSettings = updateSettings;
    this.buildDeviceRegistration = buildDeviceRegistration;
    this.fetchImpl = fetchImpl;
    this.onEvent = onEvent;
    this.now = now;
    this.pending = null;
    this.config = null;
    this.state = {
      status: "idle",
      startedAt: null,
      completedAt: null,
      account: null,
      deviceId: null,
      lastErrorCode: null,
    };
  }

  snapshot() {
    return structuredClone(this.state);
  }

  async begin() {
    const config = requireAuthConfig(await this.client.authConfig());
    const { verifier, challenge } = createPkcePair();
    const state = base64url(randomBytes(24));
    const startedAt = this.now().toISOString();
    this.config = config;
    this.pending = { verifier, state, startedAt };
    this.state = {
      status: "waiting_for_browser",
      startedAt,
      completedAt: null,
      account: null,
      deviceId: this.state.deviceId ?? null,
      lastErrorCode: null,
    };

    const authorizationUrl = buildAuthorizationUrl(config, {
      state,
      challenge,
    });
    await this.openExternal(authorizationUrl);
    this.onEvent("info", "Cloud account login opened in system browser", {
      provider: config.provider,
    });
    return this.snapshot();
  }

  async handleCallback(callbackUrl) {
    const pending = this.pending;
    const config = this.config;
    if (!pending || !config) {
      return this.fail("CLOUD_AUTH_NOT_PENDING");
    }
    if (!sameCallbackTarget(callbackUrl, config.redirectUri)) {
      return this.fail("CLOUD_AUTH_CALLBACK_INVALID");
    }

    const callback = new URL(callbackUrl);
    if (callback.searchParams.get("state") !== pending.state) {
      return this.fail("CLOUD_AUTH_STATE_MISMATCH");
    }
    const oauthError = callback.searchParams.get("error");
    if (oauthError) {
      return this.fail(`CLOUD_AUTH_${oauthError.toUpperCase()}`);
    }
    const code = callback.searchParams.get("code");
    if (!code) return this.fail("CLOUD_AUTH_CODE_MISSING");

    this.state = { ...this.state, status: "exchanging_code" };

    try {
      const form = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        code,
        redirect_uri: config.redirectUri,
        code_verifier: pending.verifier,
      });
      const response = await this.fetchImpl(config.tokenEndpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
      const tokens = await parseJsonResponse(
        response,
        "CLOUD_AUTH_TOKEN_EXCHANGE_FAILED",
      );
      if (typeof tokens.id_token !== "string" || !tokens.id_token) {
        throw Object.assign(new Error("Cognito response omitted id_token."), {
          code: "CLOUD_AUTH_ID_TOKEN_MISSING",
        });
      }

      if (typeof tokens.refresh_token === "string" && tokens.refresh_token) {
        await this.storeSecret({
          name: ACCOUNT_REFRESH_SECRET,
          project: SECRET_SCOPE,
          value: tokens.refresh_token,
        });
      }

      this.state = { ...this.state, status: "bootstrapping" };
      const account = await this.client.bootstrap(tokens.id_token);

      this.state = { ...this.state, status: "registering_device" };
      const registration = await this.buildDeviceRegistration(account);
      const enrolled = await this.client.registerDevice(
        tokens.id_token,
        registration,
      );
      if (
        typeof enrolled?.deviceId !== "string" ||
        typeof enrolled?.deviceCredential !== "string"
      ) {
        throw Object.assign(
          new Error("Cloud device registration returned no device identity."),
          { code: "CLOUD_DEVICE_REGISTRATION_INVALID" },
        );
      }

      await this.storeSecret({
        name: DEVICE_CREDENTIAL_SECRET,
        project: SECRET_SCOPE,
        value: enrolled.deviceCredential,
      });
      await this.updateSettings({
        cloudDeviceId: enrolled.deviceId,
        cloudEnabled: true,
      });

      const completedAt = this.now().toISOString();
      this.pending = null;
      this.state = {
        status: "ready",
        startedAt: pending.startedAt,
        completedAt,
        account: {
          userId: account.userId ?? null,
          organizationId: account.organizationId ?? null,
          membershipId: account.membershipId ?? null,
          role: account.role ?? null,
          email: account.email ?? null,
        },
        deviceId: enrolled.deviceId,
        lastErrorCode: null,
      };
      this.onEvent("info", "OWL Cloud device enrollment completed", {
        deviceId: enrolled.deviceId,
        role: account.role ?? null,
      });
      return this.snapshot();
    } catch (error) {
      return this.fail(error?.code ?? "CLOUD_ENROLLMENT_FAILED", error);
    }
  }

  async logoutAccount() {
    const config = this.config ?? requireAuthConfig(await this.client.authConfig());
    await this.deleteSecret(ACCOUNT_REFRESH_SECRET, SECRET_SCOPE);
    this.pending = null;
    this.state = {
      ...this.state,
      status: this.state.deviceId ? "device_enrolled" : "idle",
      account: null,
      lastErrorCode: null,
    };

    const url = new URL(config.logoutEndpoint);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("logout_uri", config.logoutRedirectUri);
    await this.openExternal(url.toString());
    this.onEvent("info", "OWL Cloud human account session signed out", {
      devicePreserved: Boolean(this.state.deviceId),
    });
    return this.snapshot();
  }

  fail(code, error) {
    this.pending = null;
    this.state = {
      ...this.state,
      status: "error",
      lastErrorCode: String(code).slice(0, 120),
    };
    this.onEvent("error", "OWL Cloud enrollment failed", {
      code: this.state.lastErrorCode,
      message: error instanceof Error ? error.message : undefined,
    });
    return this.snapshot();
  }
}

export const cloudEnrollmentSecretNames = {
  accountRefreshToken: ACCOUNT_REFRESH_SECRET,
  deviceCredential: DEVICE_CREDENTIAL_SECRET,
};
