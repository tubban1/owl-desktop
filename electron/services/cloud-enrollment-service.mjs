const DEVICE_CREDENTIAL_NAME = "OWL_CLOUD_DEVICE_CREDENTIAL";
const ACCOUNT_REFRESH_TOKEN_NAME = "OWL_CLOUD_ACCOUNT_REFRESH_TOKEN";
const SECRET_PROJECT = "owl-cloud";

function withoutCredential(device) {
  if (!device || typeof device !== "object") return device;
  const { deviceCredential: _deviceCredential, ...safe } = device;
  return safe;
}

export class CloudEnrollmentService {
  constructor({
    cloudClient,
    auth,
    store,
    platform,
    displayName,
    capabilities = {},
    runtimeCompatibility = {},
  } = {}) {
    if (!cloudClient) throw new Error("CloudEnrollmentService requires Cloud client.");
    if (!auth) throw new Error("CloudEnrollmentService requires account auth.");
    if (!store) throw new Error("CloudEnrollmentService requires Desktop store.");
    this.cloudClient = cloudClient;
    this.auth = auth;
    this.store = store;
    this.platform = platform || process.platform;
    this.displayName = displayName || "OWL Desktop";
    this.capabilities = capabilities;
    this.runtimeCompatibility = runtimeCompatibility;
  }

  async begin(options) {
    return await this.auth.begin(options);
  }

  async complete(callbackUrl) {
    const tokens = await this.auth.complete(callbackUrl);
    return await this.enrollWithTokens(tokens);
  }

  async resumeFromRefreshToken() {
    const refreshToken = this.store.readSecret(
      ACCOUNT_REFRESH_TOKEN_NAME,
      SECRET_PROJECT,
    );
    if (!refreshToken) return null;
    const tokens = await this.auth.refresh(refreshToken);
    return await this.accountSnapshot(tokens, { persistRefreshToken: true });
  }

  async accountSnapshot(tokens, { persistRefreshToken = false } = {}) {
    const account = await this.cloudClient.bootstrap(tokens.idToken);
    const settings = this.store.getSettings();
    const deviceId =
      settings.cloudDeviceId || this.recoverDeviceIdFromCredential() || null;
    const access = deviceId
      ? await this.cloudClient.getDeviceAccess(tokens.idToken, deviceId)
      : null;

    if (persistRefreshToken && tokens.refreshToken) {
      this.persistRefreshToken(tokens.refreshToken);
    }

    return {
      account,
      deviceId,
      access,
      session: {
        authenticated: true,
        expiresIn: tokens.expiresIn,
        tokenType: tokens.tokenType,
      },
    };
  }

  async enrollWithTokens(tokens) {
    const account = await this.cloudClient.bootstrap(tokens.idToken);
    const registered = await this.cloudClient.registerDevice(tokens.idToken, {
      displayName: this.displayName,
      platform: this.platform,
      capabilities: this.capabilities,
      runtimeCompatibility: this.runtimeCompatibility,
    });

    if (!registered?.deviceId || !registered?.deviceCredential) {
      throw new Error("OWL Cloud device registration returned incomplete identity.");
    }

    // Persist the one-time credential before non-secret settings. If the process
    // dies between these writes, recoverDeviceIdFromCredential() can reconstruct
    // the deviceId from the encrypted credential on next launch.
    this.store.upsertSecret({
      name: DEVICE_CREDENTIAL_NAME,
      project: SECRET_PROJECT,
      value: registered.deviceCredential,
    });
    this.store.updateSettings({
      cloudDeviceId: registered.deviceId,
      cloudEnabled: true,
    });
    if (tokens.refreshToken) {
      this.persistRefreshToken(tokens.refreshToken);
    }

    const access = await this.cloudClient.getDeviceAccess(
      tokens.idToken,
      registered.deviceId,
    );

    return {
      account,
      device: withoutCredential(registered),
      access,
      session: {
        authenticated: true,
        expiresIn: tokens.expiresIn,
        tokenType: tokens.tokenType,
      },
    };
  }

  recoverDeviceIdFromCredential() {
    const credential = this.store.readSecret(
      DEVICE_CREDENTIAL_NAME,
      SECRET_PROJECT,
    );
    if (!credential) return null;
    const match = credential.match(/^owldev1\.([^.]+)\./);
    if (!match?.[1]) return null;
    const deviceId = match[1];
    const settings = this.store.getSettings();
    if (!settings.cloudDeviceId) {
      this.store.updateSettings({ cloudDeviceId: deviceId });
    }
    return deviceId;
  }

  clearAccountSession() {
    const refresh = this.store
      .listSecrets()
      .find(
        (entry) =>
          entry.name === ACCOUNT_REFRESH_TOKEN_NAME &&
          entry.project === SECRET_PROJECT,
      );
    if (refresh) this.store.deleteSecret(refresh.id);
    return { signedOut: true };
  }

  persistRefreshToken(value) {
    this.store.upsertSecret({
      name: ACCOUNT_REFRESH_TOKEN_NAME,
      project: SECRET_PROJECT,
      value,
    });
  }
}

export const cloudEnrollmentSecretNames = {
  project: SECRET_PROJECT,
  deviceCredential: DEVICE_CREDENTIAL_NAME,
  accountRefreshToken: ACCOUNT_REFRESH_TOKEN_NAME,
};
