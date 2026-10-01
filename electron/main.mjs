import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { configureOwlDesktopStorage } from "./storage-layout.mjs";
import { DesktopStore } from "./store.mjs";
import { RuntimeHttpClient } from "./runtime-http-client.mjs";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";
import { RuntimeHostSupervisor } from "./services/runtime-host-supervisor.mjs";
import { LocalRuntimeBootstrap } from "./services/local-runtime-bootstrap.mjs";
import { TunnelSupervisor } from "./services/tunnel-supervisor.mjs";
import { IdentityVault } from "./services/identity-vault.mjs";
import { RuntimeSkillManagerPort } from "./services/skill-manager-port.mjs";
import { CloudHttpClient } from "./services/cloud-http-client.mjs";
import { CloudAccountAuth } from "./services/cloud-account-auth.mjs";
import { CloudEnrollmentService } from "./services/cloud-enrollment-service.mjs";
import { CloudControlPlaneService } from "./services/cloud-control-plane-service.mjs";
import { RemoteSubmissionStore } from "./services/remote-submission-store.mjs";
import { RemoteDeviceControlService } from "./services/remote-device-control-service.mjs";
import { PlannerContinuationStore } from "./services/planner-continuation-store.mjs";
import {
  DevAuthCallbackServer,
  DEV_AUTH_CALLBACK_URI,
} from "./services/dev-auth-callback-server.mjs";
import { buildSafeDeviceCapabilityCard } from "./services/device-capability-card.mjs";
import { CloudBridgeStore } from "./services/cloud-bridge-store.mjs";
import { CloudBridgeService } from "./services/cloud-bridge-service.mjs";
import { assertRuntimeCompatibility } from "./services/compatibility-v1.mjs";
import { AgentInboxStore } from "./services/agent-inbox-store.mjs";
import { RuntimeAgentRequestEventConsumer } from "./services/runtime-agent-request-consumer.mjs";
import { RuntimeAgentRequestEventBridge } from "./services/runtime-agent-request-event-bridge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let storageLayout;
const devForceConnectivity =
  !app.isPackaged && process.env.OWL_DEV_FORCE_CONNECTIVITY === "true";
let mainWindow;
let store;
let identityVault;
let tunnelSupervisor;
let cloudBridgeStore;
let remoteSubmissionStore;
let plannerContinuationStore;
let cloudAccountAuth;
let cloudEnrollmentService;
let devAuthCallbackServer;
let pendingCloudAuthCallbackUrl = null;
let agentInbox;
let cloudBridge;
let runtimeAgentRequestConsumer;
let runtimeAgentRequestEventBridge;
let runtimeAgentRequestConsumerStateFile;
let runtimeAgentRequestBridgeStateFile;
let cloudBridgeState = {
  status: "stopped",
  running: false,
  lastErrorCode: null,
};
let cloudAccountState = {
  status: "signed_out",
  account: null,
  access: null,
  entitlement: null,
  runtimeAccess: null,
  deviceId: null,
  lastErrorCode: null,
  lastErrorMessage: null,
};
let mcpServer;
let mcpState = { status: "stopped", url: null, error: null };
const activity = [];

const record = (level, source, message, meta = {}) => {
  activity.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    level,
    source,
    message,
    meta,
  });
  if (activity.length > 200) activity.length = 200;
};

const collectionSize = (value, keys = []) => {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return 0;
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key].length;
  }
  if (value.result && typeof value.result === "object") {
    return collectionSize(value.result, keys);
  }
  return 0;
};

function runtimeToken() {
  return (
    store.readSecret("OWL_RUNTIME_API_TOKEN", "owl-runtime") ??
    store.readSecret("OWL_RUNTIME_API_TOKEN")
  );
}

function effectiveRuntimeBaseUrl(settings = store.getSettings()) {
  const devOverride =
    !app.isPackaged ? process.env.OWL_RUNTIME_DEV_URL?.trim() : "";
  return devOverride || settings.runtimeBaseUrl;
}

function runtimeClient() {
  const settings = store.getSettings();
  return new RuntimeHttpClient({
    baseUrl: effectiveRuntimeBaseUrl(settings),
    sessionId: settings.sessionId,
    token: runtimeToken(),
  });
}

function skillManagerPort() {
  return new RuntimeSkillManagerPort({ client: runtimeClient() });
}

function localRuntimeBootstrapPort(settings) {
  try {
    const url = new URL(settings.runtimeBaseUrl);
    if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
      return null;
    }
    const port = Number(url.port || 8788);
    return Number.isInteger(port) && port > 0 && port <= 65535
      ? port
      : 8788;
  } catch {
    return null;
  }
}

function createLocalRuntimeBootstrap(settings) {
  const port = localRuntimeBootstrapPort(settings);
  if (!port) return null;
  return new LocalRuntimeBootstrap({
    resourcesPath: process.resourcesPath,
    desktopExecPath: process.execPath,
    store,
    runtimePort: port,
    onEvent(level, message, meta) {
      record(level, "bootstrap", message, meta);
    },
  });
}

async function applyRuntimeUserPreferences(settings) {
  if (!app.isPackaged) {
    record(
      "info",
      "runtime",
      "Runtime preferences saved; DEV restart required to apply",
      {
        wakeName: settings.wakeName,
        allowedDirectoryCount: settings.allowedDirectories?.length ?? 0,
      },
    );
    return { applied: false, requiresDevRestart: true };
  }
  const bootstrap = createLocalRuntimeBootstrap(settings);
  if (!bootstrap) {
    return { applied: false, requiresDevRestart: false };
  }
  const environment = bootstrap.ensureEnvironment();
  await runtimeHostSupervisor().restartService();
  record("info", "runtime", "Runtime preferences applied", {
    wakeName: environment.wakeName,
    allowedDirectoryCount:
      environment.allowedDirectories?.split(",").filter(Boolean).length ?? 0,
  });
  return { applied: true, requiresDevRestart: false, environment };
}

async function ensurePackagedLocalRuntime(settings) {
  if (!app.isPackaged) return null;
  const port = localRuntimeBootstrapPort(settings);
  if (!port) {
    record(
      "info",
      "bootstrap",
      "Local Runtime bootstrap skipped for non-loopback Runtime endpoint",
      { runtimeBaseUrl: settings.runtimeBaseUrl },
    );
    return null;
  }

  record("info", "bootstrap", "Preparing bundled OWL Runtime", {
    runtimeBaseUrl: settings.runtimeBaseUrl,
    port,
  });
  const bootstrap = createLocalRuntimeBootstrap(settings);
  try {
    const result = await bootstrap.ensure();
    record("info", "bootstrap", "Bundled OWL Runtime is ready", {
      runtimeVersion: result.health?.runtimeVersion ?? null,
      apiVersion: result.health?.apiVersion ?? null,
      releaseDir: result.release?.releaseDir ?? null,
      helperInstalled:
        result.nativeApps?.find((item) => item.name === "Helper")?.installed ===
        true,
      runtimeHostInstalled:
        result.nativeApps?.find((item) => item.name === "Runtime Host")
          ?.installed === true,
    });
    return result;
  } catch (error) {
    record("error", "bootstrap", "Bundled OWL Runtime bootstrap failed", {
      code: error?.code ?? "LOCAL_RUNTIME_BOOTSTRAP_FAILED",
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function runtimeEventBridgeSnapshot() {
  return runtimeAgentRequestEventBridge?.snapshot() ?? {
    version: 1,
    status: "stopped",
    supported: null,
    running: false,
    pollIntervalMs: 3000,
    lastPollAt: null,
    lastSuccessAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    acceptedEvents: 0,
    acceptedPages: 0,
    retention: null,
    reconciliation: null,
    consumer: {
      lastSequence: null,
      lastCursor: null,
    },
  };
}

function createRuntimeEventBridge() {
  runtimeAgentRequestEventBridge?.stop();
  runtimeAgentRequestEventBridge = new RuntimeAgentRequestEventBridge({
    client: runtimeClient(),
    consumer: runtimeAgentRequestConsumer,
    inbox: agentInbox,
    stateFile: runtimeAgentRequestBridgeStateFile,
    pollIntervalMs: 3000,
    pageLimit: 100,
    onEvent(level, message, meta) {
      record(level, "runtime-events", message, meta);
    },
  });
  return runtimeAgentRequestEventBridge;
}

async function startRuntimeEventBridge() {
  if (!runtimeAgentRequestConsumer) return runtimeEventBridgeSnapshot();
  const bridge = createRuntimeEventBridge();
  return await bridge.start();
}

function stopRuntimeEventBridge() {
  runtimeAgentRequestEventBridge?.stop();
  return runtimeEventBridgeSnapshot();
}

function mcpToken() {
  return (
    store.readSecret("OWL_MCP_API_TOKEN", "owl-desktop") ??
    store.readSecret("OWL_MCP_API_TOKEN")
  );
}

function tunnelApiKey() {
  return (
    store.readSecret("OWL_TUNNEL_API_KEY", "owl-tunnel") ??
    store.readSecret("OWL_TUNNEL_API_KEY")
  );
}

function cloudDeviceCredential() {
  return (
    store.readSecret("OWL_CLOUD_DEVICE_CREDENTIAL", "owl-cloud") ??
    store.readSecret("OWL_CLOUD_DEVICE_CREDENTIAL")
  );
}

function cloudAccountClient() {
  const settings = store.getSettings();
  return new CloudHttpClient({
    baseUrl: settings.cloudBaseUrl,
  });
}

function cloudControlPlane() {
  const client = cloudAccountClient();
  const auth = new CloudAccountAuth({ cloudClient: client });
  return new CloudControlPlaneService({
    cloudClient: client,
    auth,
    store,
  });
}

function remoteDeviceControl() {
  if (!remoteSubmissionStore) {
    throw new Error("Remote submission store is not initialized.");
  }
  return new RemoteDeviceControlService({
    controlPlane: cloudControlPlane(),
    store: remoteSubmissionStore,
  });
}

function ensureCloudEnrollmentService() {
  const settings = store.getSettings();
  if (!settings.cloudBaseUrl?.trim()) {
    throw new Error("OWL Cloud base URL is not configured.");
  }
  const client = cloudAccountClient();
  cloudAccountAuth = new CloudAccountAuth({ cloudClient: client });
  cloudEnrollmentService = new CloudEnrollmentService({
    cloudClient: client,
    auth: cloudAccountAuth,
    store,
    platform: `${process.platform}-${process.arch}`,
    displayName: os.hostname() || "This Mac",
    capabilities: {
      cloudBridge: "m1-polling-v1",
      mcp: "streamable-http-v1",
    },
    runtimeCompatibility: {
      desktopVersion: app.getVersion(),
      runtimeApi: "0.1",
    },
  });
  return cloudEnrollmentService;
}

function cloudAccountSnapshot() {
  return {
    ...cloudAccountState,
    deviceId:
      cloudAccountState.deviceId ??
      store?.getSettings()?.cloudDeviceId ??
      null,
  };
}

async function syncRuntimeAccessFromCloud(
  account,
  access,
  deviceId,
  runtimeLease,
) {
  const client = runtimeClient();
  const entitlement =
    runtimeLease?.entitlement ?? account?.entitlement ?? null;
  const entitled =
    entitlement?.canRun === true && entitlement?.features?.runtime === true;
  const leaseReady =
    runtimeLease?.canRun === true &&
    typeof runtimeLease?.leaseToken === "string" &&
    runtimeLease.leaseToken.length > 0;

  if (!deviceId || access?.canRun !== true || !entitled || !leaseReady) {
    const reasonCode =
      !deviceId
        ? "CLOUD_DEVICE_ENROLLMENT_REQUIRED"
        : access?.canRun !== true
          ? "CLOUD_DEVICE_RUN_NOT_GRANTED"
          : entitlement?.status === "trial_expired"
            ? "CLOUD_TRIAL_EXPIRED"
            : entitlement?.status === "payment_required"
              ? "CLOUD_PAYMENT_REQUIRED"
              : entitlement?.status === "suspended"
                ? "CLOUD_ACCOUNT_SUSPENDED"
                : "CLOUD_ENTITLEMENT_NOT_ACTIVE";
    return await client.lockRuntimeAccess(reasonCode, {
      idempotencyKey: `runtime-access-lock:${deviceId ?? "none"}:${reasonCode.toLowerCase()}`,
    });
  }

  return await client.authorizeRuntimeAccess(
    {
      deviceId,
      leaseToken: runtimeLease.leaseToken,
    },
    {
      idempotencyKey:
        `runtime-access-authorize:${deviceId}:${runtimeLease?.lease?.leaseId ?? "cloud-lease"}`,
    },
  );
}

async function safeSyncRuntimeAccess(
  account,
  access,
  deviceId,
  runtimeLease,
) {
  try {
    const state = await syncRuntimeAccessFromCloud(
      account,
      access,
      deviceId,
      runtimeLease,
    );
    record("info", "runtime-access", "Runtime access projection updated", {
      state: state?.state ?? null,
      reasonCode: state?.reasonCode ?? null,
      deviceId,
      expiresAt: state?.grant?.expiresAt ?? null,
    });
    return state;
  } catch (error) {
    record("warn", "runtime-access", "Runtime access projection failed", {
      code: error?.code ?? null,
      message: error instanceof Error ? error.message : String(error),
      deviceId,
    });
    return await runtimeClient().runtimeAccess().catch(() => null);
  }
}

async function beginCloudAccountLogin() {
  const service = ensureCloudEnrollmentService();
  const useDevelopmentRedirect = !app.isPackaged;
  if (useDevelopmentRedirect) {
    await devAuthCallbackServer?.stop().catch(() => undefined);
    devAuthCallbackServer = new DevAuthCallbackServer({
      onCallback: async (url) => {
        await completeCloudAccountLogin(url);
      },
    });
    await devAuthCallbackServer.start();
  }
  cloudAccountState = {
    ...cloudAccountState,
    status: "authorizing",
    lastErrorCode: null,
    lastErrorMessage: null,
  };
  let started;
  try {
    started = await service.begin({ useDevelopmentRedirect });
    if (
      useDevelopmentRedirect &&
      started.redirectUri !== DEV_AUTH_CALLBACK_URI
    ) {
      throw new Error(
        `OWL Cloud development redirect mismatch: expected ${DEV_AUTH_CALLBACK_URI} but discovery returned ${started.redirectUri}.`,
      );
    }
    await shell.openExternal(started.authorizationUrl);
  } catch (error) {
    if (useDevelopmentRedirect) {
      await devAuthCallbackServer?.stop().catch(() => undefined);
      devAuthCallbackServer = null;
    }
    throw error;
  }
  record("info", "cloud", "OWL LAB account login opened in system browser", {
    provider: started.provider,
    region: started.region,
  });
  return {
    status: cloudAccountState.status,
    provider: started.provider,
    region: started.region,
    redirectUri: started.redirectUri,
  };
}

async function completeCloudAccountLogin(url) {
  try {
    const service = cloudEnrollmentService ?? ensureCloudEnrollmentService();
    const enrolled = await service.complete(url);
    const runtimeAccess = await safeSyncRuntimeAccess(
      enrolled.account ?? null,
      enrolled.access ?? null,
      enrolled.device?.deviceId ?? null,
      enrolled.runtimeLease ?? null,
    );
    cloudAccountState = {
      status: "ready",
      account: enrolled.account ?? null,
      access: enrolled.access ?? null,
      entitlement:
        enrolled.entitlement ?? enrolled.account?.entitlement ?? null,
      runtimeAccess,
      deviceId: enrolled.device?.deviceId ?? null,
      lastErrorCode: null,
      lastErrorMessage: null,
    };
    record("info", "cloud", "OWL LAB account and device enrollment completed", {
      deviceId: cloudAccountState.deviceId,
      canRun: enrolled.access?.canRun === true,
    });
    await startCloudBridge();
    mainWindow?.webContents?.send("cloud:account-updated", cloudAccountSnapshot());
    return cloudAccountSnapshot();
  } catch (error) {
    cloudAccountState = {
      ...cloudAccountState,
      status: "error",
      lastErrorCode: error?.code ?? "CLOUD_LOGIN_FAILED",
      lastErrorMessage: error instanceof Error ? error.message : String(error),
    };
    record("error", "cloud", "OWL LAB account login failed", {
      code: cloudAccountState.lastErrorCode,
      message: cloudAccountState.lastErrorMessage,
    });
    mainWindow?.webContents?.send("cloud:account-updated", cloudAccountSnapshot());
    throw error;
  }
}

async function resumeCloudAccountSession() {
  try {
    const service = ensureCloudEnrollmentService();
    service.recoverDeviceIdFromCredential();
    const resumed = await service.resumeFromRefreshToken();
    if (!resumed) {
      const deviceId = store.getSettings().cloudDeviceId || null;
      const runtimeAccess = await runtimeClient()
        .lockRuntimeAccess("ACCOUNT_LOGIN_REQUIRED", {
          idempotencyKey: `runtime-access-lock:${deviceId ?? "none"}:account-login-required`,
        })
        .catch(() => null);
      cloudAccountState = {
        ...cloudAccountState,
        status: deviceId ? "device_enrolled" : "signed_out",
        access: null,
        entitlement: null,
        runtimeAccess,
        deviceId,
      };
      return cloudAccountSnapshot();
    }
    const runtimeAccess = await safeSyncRuntimeAccess(
      resumed.account ?? null,
      resumed.access ?? null,
      resumed.deviceId ?? null,
      resumed.runtimeLease ?? null,
    );
    cloudAccountState = {
      status: "ready",
      account: resumed.account ?? null,
      access: resumed.access ?? null,
      entitlement:
        resumed.entitlement ?? resumed.account?.entitlement ?? null,
      runtimeAccess,
      deviceId: resumed.deviceId ?? null,
      lastErrorCode: null,
      lastErrorMessage: null,
    };
    return cloudAccountSnapshot();
  } catch (error) {
    cloudAccountState = {
      ...cloudAccountState,
      status: "needs_login",
      lastErrorCode: error?.code ?? "CLOUD_SESSION_RESUME_FAILED",
      lastErrorMessage: error instanceof Error ? error.message : String(error),
    };
    return cloudAccountSnapshot();
  }
}

async function reauthorizeCloudAccount() {
  const resumed = await resumeCloudAccountSession();
  if (resumed?.status === "ready") {
    const currentAccess = resumed.runtimeAccess;
    if (currentAccess?.state === "READY") {
      mainWindow?.webContents?.send(
        "cloud:account-updated",
        cloudAccountSnapshot(),
      );
      record(
        "info",
        "runtime-access",
        "Runtime access reauthorized from stored Cloud session",
        {
          state: currentAccess.state,
          deviceId: resumed.deviceId ?? null,
          interactionRequired: false,
        },
      );
      return {
        ...cloudAccountSnapshot(),
        interactionRequired: false,
      };
    }

    const recovered = await recoverRuntimeAccessAfterReconnect();
    if (recovered?.state === "READY") {
      return {
        ...cloudAccountSnapshot(),
        interactionRequired: false,
      };
    }

    const error = new Error(
      "Cloud account session is valid, but Runtime access projection did not reach READY.",
    );
    error.code = "RUNTIME_ACCESS_PROJECTION_FAILED";
    throw error;
  }

  const started = await beginCloudAccountLogin();
  return {
    ...started,
    interactionRequired: true,
  };
}

async function recoverRuntimeAccessAfterReconnect() {
  if (cloudAccountState.status !== "ready") return null;
  try {
    const service = cloudEnrollmentService ?? ensureCloudEnrollmentService();
    service.recoverDeviceIdFromCredential();
    const resumed = await service.resumeFromRefreshToken();
    if (!resumed) return null;

    const runtimeAccess = await safeSyncRuntimeAccess(
      resumed.account ?? cloudAccountState.account ?? null,
      resumed.access ?? null,
      resumed.deviceId ?? cloudAccountState.deviceId ?? null,
      resumed.runtimeLease ?? null,
    );
    cloudAccountState = {
      ...cloudAccountState,
      status: "ready",
      account: resumed.account ?? cloudAccountState.account ?? null,
      access: resumed.access ?? null,
      entitlement:
        resumed.entitlement ??
        resumed.account?.entitlement ??
        cloudAccountState.entitlement ??
        null,
      runtimeAccess,
      deviceId: resumed.deviceId ?? cloudAccountState.deviceId ?? null,
      lastErrorCode: null,
      lastErrorMessage: null,
    };
    record("info", "runtime-access", "Runtime access recovered after reconnect", {
      state: runtimeAccess?.state ?? null,
      deviceId: cloudAccountState.deviceId,
    });
    mainWindow?.webContents?.send(
      "cloud:account-updated",
      cloudAccountSnapshot(),
    );
    return runtimeAccess;
  } catch (error) {
    record("warn", "runtime-access", "Runtime reconnect authorization failed", {
      code: error?.code ?? null,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function logoutCloudAccount() {
  const service = cloudEnrollmentService ?? ensureCloudEnrollmentService();
  service.clearAccountSession();
  const deviceId = store.getSettings().cloudDeviceId || null;
  const runtimeAccess = await runtimeClient()
    .lockRuntimeAccess("ACCOUNT_LOGGED_OUT", {
      idempotencyKey: `runtime-access-lock:${deviceId ?? "none"}:account-logged-out`,
    })
    .catch(() => null);
  cloudAccountState = {
    status: deviceId ? "device_enrolled" : "signed_out",
    account: null,
    access: null,
    entitlement: null,
    runtimeAccess,
    deviceId,
    lastErrorCode: null,
    lastErrorMessage: null,
  };
  record("info", "cloud", "OWL LAB account signed out", {
    deviceEnrollmentPreserved: Boolean(cloudAccountState.deviceId),
    runtimeAccess: runtimeAccess?.state ?? null,
  });
  return cloudAccountSnapshot();
}

function createAgentRequest(input) {
  if (!agentInbox) return null;
  const result = agentInbox.create(input);
  if (result.created) {
    record("info", "agent-inbox", "AgentRequest created", {
      requestId: result.request.requestId,
      type: result.request.type,
      priority: result.request.priority,
      producer: result.request.producer,
    });
  }
  return result.request;
}

async function buildCloudPresence() {
  const client = runtimeClient();
  const [info, runtimeAccess] = await Promise.all([
    client.info().catch(() => null),
    client.runtimeAccess().catch(() => null),
  ]);
  const runtimeReady =
    runtimeAccess?.mode === "compat" || runtimeAccess?.state === "READY";

  const [manifest, tasks, approvals, processes] = runtimeReady
    ? await Promise.all([
        client.capabilities("").catch(() => null),
        client.tasks().catch(() => []),
        client.approvals().catch(() => []),
        client.processes().catch(() => null),
      ])
    : [null, [], [], null];

  const capabilityCard = buildSafeDeviceCapabilityCard(manifest);
  const taskRows = Array.isArray(tasks) ? tasks : [];
  const approvalRows = Array.isArray(approvals) ? approvals : [];
  const terminalTaskStates = new Set([
    "completed",
    "failed",
    "cancelled",
    "blocked",
  ]);
  const activeTasks = taskRows.filter(
    (task) => !terminalTaskStates.has(String(task?.status ?? "")),
  ).length;
  const completedTasks = taskRows.filter(
    (task) => String(task?.status ?? "") === "completed",
  ).length;
  const needsAttentionTasks = taskRows.filter((task) =>
    ["failed", "blocked"].includes(String(task?.status ?? "")),
  ).length;
  const approvalsPending = approvalRows.filter((approval) =>
    ["pending", "requested", "waiting"].includes(
      String(approval?.state ?? approval?.status ?? "pending"),
    ),
  ).length;
  const activeProcesses = collectionSize(processes, ["processes", "items"]);
  const sampledAt = new Date().toISOString();
  const leaseExpiresAt = runtimeAccess?.grant?.expiresAt ?? null;

  const operationalState =
    runtimeAccess?.state === "REVOKED"
      ? "REVOKED"
      : runtimeReady
        ? "READY"
        : "ONLINE_LOCKED";

  return {
    capabilities: {
      cloudBridge: "m1-polling-v1",
      agentInbox: "v1",
      supportedRemoteCommands: [
        "runtime.task.create@1",
        "runtime.task.create-and-start@1",
      ],
      runtimeReachable: Boolean(info),
      mcpAvailable: mcpState.status === "running",
      tunnelAvailable: tunnelSupervisor?.status().state === "running",
      authorization: {
        operationalState,
        accountSessionState: cloudAccountState.status,
        entitlementPlan: cloudAccountState.entitlement?.plan ?? null,
        entitlementStatus: cloudAccountState.entitlement?.status ?? null,
        runtimeAccessState: runtimeAccess?.state ?? "UNKNOWN",
        runtimeAccessMode: runtimeAccess?.mode ?? null,
        leaseExpiresAt,
        signatureVerified:
          runtimeAccess?.grant?.signatureVerified === true,
      },
      usage: {
        sampledAt,
        activeTasks,
        totalTasks: taskRows.length,
        completedTasks,
        needsAttentionTasks,
        activeProcesses,
        approvalsPending,
        mcpSessions: mcpServer?.snapshot()?.sessionCount ?? 0,
        outboxPending: cloudBridgeStore?.snapshot()?.outboxPending ?? 0,
      },
      providers: capabilityCard.providers,
      skillRegistry: capabilityCard.skillRegistry,
      verification: capabilityCard.verification,
    },
    runtimeCompatibility: {
      desktopVersion: app.getVersion(),
      runtimeApiVersion: info?.apiVersion ?? null,
      runtimeVersion: info?.runtimeVersion ?? null,
      primitiveAbiVersion: capabilityCard.primitiveAbiVersion,
      platform: process.platform,
      arch: process.arch,
      cloudBridgeContract: "v1",
    },
  };
}

function cloudBridgeSnapshot() {
  const settings = store.getSettings();
  const storeSnapshot = cloudBridgeStore?.snapshot() ?? {
    commandCounts: {
      processing: 0,
      accepted: 0,
      rejected: 0,
      uncertain: 0,
    },
    outboxPending: 0,
    commands: [],
  };
  return {
    baseUrl: settings.cloudBaseUrl,
    deviceId: settings.cloudDeviceId || null,
    configured: Boolean(
      settings.cloudBaseUrl &&
      settings.cloudDeviceId &&
      cloudDeviceCredential(),
    ),
    ...storeSnapshot,
    ...(cloudBridge?.snapshot() ?? cloudBridgeState),
  };
}

async function stopCloudBridge() {
  if (cloudBridge) {
    await cloudBridge.stop().catch(() => undefined);
    cloudBridge = undefined;
  }
  cloudBridgeState = {
    status: "stopped",
    running: false,
    lastErrorCode: null,
  };
  return cloudBridgeSnapshot();
}

async function startCloudBridge() {
  const settings = store.getSettings();
  await stopCloudBridge();

  if (!settings.cloudBaseUrl?.trim()) {
    cloudBridgeState = {
      status: "needs_configuration",
      running: false,
      lastErrorCode: "CLOUD_BASE_URL_MISSING",
    };
    return cloudBridgeSnapshot();
  }
  if (!settings.cloudDeviceId?.trim() || !cloudDeviceCredential()) {
    cloudBridgeState = {
      status: "needs_enrollment",
      running: false,
      lastErrorCode: "CLOUD_DEVICE_IDENTITY_MISSING",
    };
    return cloudBridgeSnapshot();
  }

  const runtime = runtimeClient();
  try {
    assertRuntimeCompatibility(await runtime.info());
  } catch (error) {
    cloudBridgeState = {
      status: "incompatible",
      running: false,
      lastErrorCode: error?.code ?? "RUNTIME_COMPATIBILITY_UNVERIFIED",
    };
    record("error", "compatibility", "Cloud Bridge blocked by Runtime compatibility gate", {
      code: cloudBridgeState.lastErrorCode,
      message: error instanceof Error ? error.message : String(error),
    });
    return cloudBridgeSnapshot();
  }

  const client = new CloudHttpClient({
    baseUrl: settings.cloudBaseUrl,
    deviceCredential: cloudDeviceCredential(),
  });

  cloudBridge = new CloudBridgeService({
    client,
    runtimeClient: runtime,
    store: cloudBridgeStore,
    deviceId: settings.cloudDeviceId,
    appVersion: app.getVersion(),
    pollIntervalMs: settings.cloudPollIntervalMs,
    presenceIntervalMs: settings.cloudPresenceIntervalMs,
    telemetryEnabled: settings.cloudTelemetryEnabled,
    buildPresence: buildCloudPresence,
    onEvent(level, message, meta) {
      record(level, "cloud", message, meta);
    },
    onAgentRequest(input) {
      createAgentRequest(input);
    },
    async onAuthRejected(error) {
      const revoked = await runtimeClient()
        .revokeRuntimeAccess("CLOUD_DEVICE_AUTH_REJECTED", {
          idempotencyKey: `runtime-access-revoke:${settings.cloudDeviceId}:cloud-device-auth-rejected`,
        })
        .catch(() => null);
      cloudAccountState = {
        ...cloudAccountState,
        runtimeAccess: revoked,
      };
      record("error", "runtime-access", "Runtime access revoked after Cloud device authentication rejection", {
        deviceId: settings.cloudDeviceId,
        code: error?.code ?? null,
        runtimeState: revoked?.state ?? null,
      });
      mainWindow?.webContents?.send("cloud:account-updated", cloudAccountSnapshot());
    },
  });

  try {
    cloudBridgeState = await cloudBridge.start();
  } catch (error) {
    cloudBridgeState = {
      status: "error",
      running: false,
      lastErrorCode: error?.code ?? "CLOUD_BRIDGE_START_FAILED",
    };
    record("error", "cloud", "Cloud Bridge failed to start", {
      code: cloudBridgeState.lastErrorCode,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return cloudBridgeSnapshot();
}

async function probeCloud() {
  const settings = store.getSettings();
  if (!settings.cloudBaseUrl?.trim()) {
    throw new Error("OWL Cloud base URL is not configured.");
  }
  const client = new CloudHttpClient({
    baseUrl: settings.cloudBaseUrl,
  });
  return client.health();
}

function runtimeHostSupervisor() {
  const settings = store.getSettings();
  return new RuntimeHostSupervisor({
    runtimeBaseUrl: effectiveRuntimeBaseUrl(settings),
    runtimeToken: runtimeToken(),
  });
}

function effectiveTunnelBinary(settings) {
  const configured = settings.tunnelBinaryPath?.trim();
  if (configured) return configured;

  const arch = process.arch === "x64" ? "x64" : "arm64";
  if (!app.isPackaged) {
    return path.join(
      __dirname,
      "..",
      "vendor",
      "owl-tunnel",
      arch,
      "tunnel-client-runtime",
    );
  }

  return path.join(
    process.resourcesPath,
    "owl-tunnel",
    arch,
    "tunnel-client-runtime",
  );
}

async function startTunnel() {
  const settings = store.getSettings();
  if (!settings.tunnelEnabled && !devForceConnectivity) {
    await tunnelSupervisor.stop();
    return tunnelSupervisor.status();
  }
  return tunnelSupervisor.start({
    binaryPath: effectiveTunnelBinary(settings),
    tunnelId: settings.tunnelId,
    apiKey: tunnelApiKey(),
    mcpUrl: `http://127.0.0.1:${settings.mcpPort}/mcp`,
  });
}

async function stopMcp() {
  if (mcpServer) {
    await mcpServer.close().catch(() => undefined);
    mcpServer = undefined;
  }
  mcpState = { status: "stopped", url: null, error: null };
}

async function startMcp() {
  const settings = store.getSettings();
  if (!settings.mcpEnabled && !devForceConnectivity) {
    await stopMcp();
    return mcpState;
  }

  await stopMcp();
  mcpState = { status: "starting", url: null, error: null };

  try {
    mcpServer = await startOwlMcpHttpServer({
      port: settings.mcpPort,
      runtimeBaseUrl: effectiveRuntimeBaseUrl(settings),
      runtimeToken: runtimeToken(),
      mcpToken: mcpToken(),
      fallbackOwnerId: settings.sessionId,
      agentInbox,
      remoteDeviceControl: remoteDeviceControl(),
      plannerContinuation: plannerContinuationStore,
      onEvent(level, message, meta) {
        record(level, "mcp", message, meta);
      },
    });
    mcpState = { status: "running", url: mcpServer.url, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    mcpState = { status: "error", url: null, error: message };
    record("error", "mcp", "OWL MCP failed to start", { message });
  }
  return mcpState;
}

async function runtimeSnapshot(options = {}) {
  const settings = store.getSettings();
  const client = runtimeClient();

  const started = Date.now();
  const [info, runtimeAccess, health, tasks, approvals, processes, diagnostics, host] =
    await Promise.allSettled([
      client.info(),
      client.runtimeAccess(),
      client.health(),
      client.tasks(),
      client.approvals(),
      client.processes(),
      settings.diagnosticsEnabled ? client.diagnostics(40) : Promise.resolve(null),
      runtimeHostSupervisor().status(),
    ]);

  const online = info.status === "fulfilled";
  let effectiveRuntimeAccess =
    runtimeAccess.status === "fulfilled" ? runtimeAccess.value : null;

  if (
    online &&
    cloudAccountState.status === "ready" &&
    cloudAccountState.access?.canRun === true &&
    cloudAccountState.entitlement?.canRun === true &&
    effectiveRuntimeAccess?.state !== "READY"
  ) {
    const recovered = await recoverRuntimeAccessAfterReconnect();
    if (recovered) effectiveRuntimeAccess = recovered;
  }

  const result = {
    mode: online ? "live" : "offline",
    checkedAt: new Date().toISOString(),
    runtimeEndpoint: effectiveRuntimeBaseUrl(settings),
    latencyMs: Date.now() - started,
    info: info.status === "fulfilled" ? info.value : null,
    runtimeAccess: effectiveRuntimeAccess,
    health: health.status === "fulfilled" ? health.value : null,
    tasks: tasks.status === "fulfilled" ? tasks.value : null,
    approvals: approvals.status === "fulfilled" ? approvals.value : null,
    processes: processes.status === "fulfilled" ? processes.value : null,
    diagnostics: diagnostics.status === "fulfilled" ? diagnostics.value : null,
    error: online ? null : (info.reason?.message ?? "OWL Runtime is unavailable"),
    metrics: {
      tasks: tasks.status === "fulfilled" ? collectionSize(tasks.value, ["tasks", "items"]) : 0,
      approvals: approvals.status === "fulfilled" ? collectionSize(approvals.value, ["approvals", "items"]) : 0,
      processes: processes.status === "fulfilled" ? collectionSize(processes.value, ["processes", "items"]) : 0,
    },
    mcp: {
      ...mcpState,
      ...(mcpServer?.snapshot() ?? { sessionCount: 0, sessions: [] }),
    },
    host: host.status === "fulfilled" ? host.value : null,
    tunnel: tunnelSupervisor?.status() ?? { state: "stopped" },
    cloud: cloudBridgeSnapshot(),
    agentInbox: agentInbox?.summary() ?? {
      pending: 0,
      claimed: 0,
      highestPriority: null,
      byType: {},
    },
    runtimeEvents: runtimeEventBridgeSnapshot(),
    accounts: identityVault?.list() ?? [],
    activity: activity.slice(0, 50),
  };

  if (options.quiet !== true) {
    record(
      online ? "info" : "warn",
      "runtime",
      online ? "Runtime snapshot refreshed" : "Runtime connection unavailable",
      {
        baseUrl: effectiveRuntimeBaseUrl(settings),
        configuredBaseUrl: settings.runtimeBaseUrl,
        devOverride: !app.isPackaged && Boolean(process.env.OWL_RUNTIME_DEV_URL),
        latencyMs: result.latencyMs,
      },
    );
  }
  result.activity = activity.slice(0, 50);
  return result;
}

function registerCloudAuthProtocol() {
  if (!app.isPackaged) return;
  app.setAsDefaultProtocolClient("owl-desktop");
}

function isCloudAuthCallbackUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "owl-desktop:" &&
      url.host === "auth" &&
      url.pathname === "/callback"
    );
  } catch {
    return false;
  }
}

function acceptCloudAuthCallbackUrl(url) {
  if (!isCloudAuthCallbackUrl(url)) return false;
  if (!store) {
    pendingCloudAuthCallbackUrl = url;
    return true;
  }
  void completeCloudAccountLogin(url).catch(() => undefined);
  return true;
}

app.on("open-url", (event, url) => {
  if (!isCloudAuthCallbackUrl(url)) return;
  event.preventDefault();
  acceptCloudAuthCallbackUrl(url);
});

registerCloudAuthProtocol();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 1060,
    minHeight: 700,
    backgroundColor: "#080a0c",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  } else {
    mainWindow.loadURL("http://127.0.0.1:5173");
  }
}

function registerIpc() {
  ipcMain.handle("desktop:activity:list", () => activity.slice(0, 200));
  ipcMain.handle("desktop:environment", () => ({
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    storage: {
      version: storageLayout.version,
      productRoot: storageLayout.productRoot,
      desktopRoot: storageLayout.desktopRoot,
      stagingRoot: storageLayout.stagingRoot,
      logsRoot: storageLayout.logsRoot,
      cacheRoot: storageLayout.cacheRoot,
      diagnosticsRoot: storageLayout.diagnosticsRoot,
      migrationReportFile: storageLayout.migrationReportFile,
      migration: {
        copied: storageLayout.migration.copied.length,
        preservedExisting: storageLayout.migration.preservedExisting.length,
        missing: storageLayout.migration.missing.length,
        errors: storageLayout.migration.errors.length,
        legacyDetected:
          storageLayout.migration.copied.length > 0 ||
          storageLayout.migration.preservedExisting.length > 0,
      },
    },
  }));

  ipcMain.handle("runtime:refresh", (_event, options) => runtimeSnapshot(options ?? {}));
  ipcMain.handle("monitor:task-detail", (_event, taskId, includeResults = false) => {
    if (typeof taskId !== "string" || !taskId.trim()) {
      throw new Error("MONITOR_TASK_ID_REQUIRED");
    }
    return runtimeClient().getTask(taskId.trim(), Boolean(includeResults));
  });
  ipcMain.handle("cloud:status", () => cloudBridgeSnapshot());
  ipcMain.handle("cloud:account-status", () => cloudAccountSnapshot());
  ipcMain.handle("cloud:login", () => beginCloudAccountLogin());
  ipcMain.handle("cloud:reauthorize", () => reauthorizeCloudAccount());
  ipcMain.handle("cloud:logout", () => logoutCloudAccount());
  ipcMain.handle("cloud:probe", () => probeCloud());
  ipcMain.handle("cloud:start", () => startCloudBridge());
  ipcMain.handle("cloud:stop", () => stopCloudBridge());
  ipcMain.handle("cloud:sync", async () => {
    if (!cloudBridge) return await startCloudBridge();
    await cloudBridge.syncOnce({ forceHeartbeat: true });
    return cloudBridgeSnapshot();
  });
  ipcMain.handle("cloud:devices:list", () =>
    cloudControlPlane().listDevices(),
  );
  ipcMain.handle("cloud:commands:list", (_event, deviceId, limit) =>
    cloudControlPlane().listCommands(deviceId, limit),
  );
  ipcMain.handle("cloud:commands:create", async (_event, deviceId, input) => {
    const command = await cloudControlPlane().createCommand(deviceId, input);
    record("info", "cloud", "Remote task queued for device", {
      commandId: command.commandId,
      deviceId: command.deviceId,
      kind: command.kind,
    });
    return command;
  });
  ipcMain.handle("cloud:commands:cancel", async (_event, commandId) => {
    const command = await cloudControlPlane().cancelCommand(commandId);
    record("info", "cloud", "Remote task cancelled before Runtime acceptance", {
      commandId: command.commandId,
      deviceId: command.deviceId,
    });
    return command;
  });
  ipcMain.handle("agent-inbox:summary", () =>
    agentInbox?.summary() ?? {
      pending: 0,
      claimed: 0,
      highestPriority: null,
      byType: {},
    });
  ipcMain.handle("agent-inbox:list", (_event, input) =>
    agentInbox?.list({
      statuses: input?.statuses ?? [
        "pending",
        "claimed",
        "completed",
        "cancelled",
      ],
      limit: input?.limit ?? 100,
    }) ?? []);
  ipcMain.handle("runtime-events:status", () =>
    runtimeEventBridgeSnapshot());
  ipcMain.handle("runtime-events:sync", async () => {
    if (!runtimeAgentRequestEventBridge) {
      const settings = store.getSettings();
      if (!settings.autoConnectRuntime) return runtimeEventBridgeSnapshot();
      await startRuntimeEventBridge();
    }
    return await runtimeAgentRequestEventBridge.syncOnce();
  });
  ipcMain.handle("runtime-events:retry-saved-cursor", async () => {
    if (!runtimeAgentRequestEventBridge) {
      await startRuntimeEventBridge();
    }
    return await runtimeAgentRequestEventBridge.retrySavedCursor();
  });
  ipcMain.handle("agent-inbox:cancel", (_event, requestId) => {
    const request = agentInbox?.cancel(requestId, {
      reasonCode: "CANCELLED_BY_USER",
    });
    if (request) {
      record("warn", "agent-inbox", "AgentRequest cancelled by user", {
        requestId: request.requestId,
        type: request.type,
      });
    }
    return request ?? null;
  });
  ipcMain.handle("skills:snapshot", async () => {
    const started = Date.now();
    try {
      const snapshot = await skillManagerPort().snapshot();
      record("info", "skills", "Skill catalog refreshed", {
        skillCount: snapshot.skills.length,
        durationMs: Date.now() - started,
      });
      return snapshot;
    } catch (error) {
      record("error", "skills", "Skill catalog refresh failed", {
        code: error?.code ?? null,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
  ipcMain.handle("skills:dry-run", async (_event, skillId, args) => {
    const started = Date.now();
    try {
      const result = await skillManagerPort().dryRun(skillId, args ?? {});
      record("info", "skills", "Skill dry run completed", {
        skillId,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (error) {
      record("warn", "skills", "Skill dry run failed", {
        skillId,
        code: error?.code ?? null,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
  ipcMain.handle("skills:run", async (_event, skillId, args) => {
    const started = Date.now();
    try {
      const result = await skillManagerPort().run(skillId, args ?? {});
      record("info", "skills", "Skill run completed", {
        skillId,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (error) {
      record("warn", "skills", "Skill run failed", {
        skillId,
        code: error?.code ?? null,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
  ipcMain.handle("skills:discover", async (_event, request) => {
    return await skillManagerPort().discover(request ?? {});
  });
  ipcMain.handle("skills:candidate-submit", async (_event, manifest) => {
    const result = await skillManagerPort().submitCandidate(manifest);
    record("info", "skills", "Skill Candidate submitted", {
      candidateId: result?.candidate?.id ?? null,
      idempotent: result?.idempotent === true,
    });
    return result;
  });
  ipcMain.handle("skills:candidate-get", async (_event, candidateId) =>
    skillManagerPort().getCandidate(candidateId));
  ipcMain.handle(
    "skills:candidate-revise",
    async (_event, candidateId, expectedDigest, manifest) =>
      skillManagerPort().reviseCandidate(
        candidateId,
        expectedDigest,
        manifest,
      ),
  );
  ipcMain.handle(
    "skills:candidate-validate",
    async (_event, candidateId, expectedDigest) =>
      skillManagerPort().validateCandidate(candidateId, expectedDigest),
  );
  ipcMain.handle(
    "skills:candidate-dismiss",
    async (_event, candidateId, expectedDigest) =>
      skillManagerPort().dismissCandidate(candidateId, expectedDigest),
  );
  ipcMain.handle(
    "skills:candidate-compile-test",
    async (_event, candidateId, expectedDigest, inputs) =>
      skillManagerPort().compileCandidateTest(
        candidateId,
        expectedDigest,
        inputs ?? {},
      ),
  );
  ipcMain.handle("skills:candidate-run-test", async (_event, taskId) =>
    skillManagerPort().runCandidateTest(taskId));
  ipcMain.handle(
    "skills:candidate-inspect",
    async (_event, candidateId, testTaskId) =>
      skillManagerPort().inspectCandidate(candidateId, testTaskId),
  );
  ipcMain.handle(
    "skills:candidate-promote",
    async (_event, candidateId, expectedDigest, testTaskId, confirm) => {
      const result = await skillManagerPort().promoteCandidate(
        candidateId,
        expectedDigest,
        testTaskId,
        confirm === true,
      );
      record("info", "skills", "Skill Candidate promotion evaluated", {
        candidateId,
        testTaskId,
        promoted: result?.promoted === true,
      });
      return result;
    },
  );
  ipcMain.handle("skills:user-set-enabled", async (_event, skillId, enabled) =>
    skillManagerPort().setEnabled(skillId, enabled === true));
  ipcMain.handle(
    "skills:user-activate-version",
    async (_event, skillId, version) =>
      skillManagerPort().activateVersion(skillId, version),
  );
  ipcMain.handle("skills:user-rollback", async (_event, skillId, version) =>
    skillManagerPort().rollback(skillId, version));
  ipcMain.handle("skills:user-uninstall", async (_event, skillId, version) =>
    skillManagerPort().uninstall(skillId, version));

  ipcMain.handle("host:status", () => runtimeHostSupervisor().status());
  ipcMain.handle("host:restart", () => runtimeHostSupervisor().restartService());
  ipcMain.handle("host:stop", () => runtimeHostSupervisor().stopService());
  ipcMain.handle("tunnel:status", () => tunnelSupervisor.status());
  ipcMain.handle("tunnel:start", () => startTunnel());
  ipcMain.handle("tunnel:stop", () => tunnelSupervisor.stop());
  ipcMain.handle("accounts:list", () => identityVault.list());
  ipcMain.handle("accounts:upsert", (_event, input) => identityVault.upsert(input));
  ipcMain.handle("accounts:delete", (_event, id) => identityVault.delete(id));
  ipcMain.handle("accounts:status", (_event, id, status, options) =>
    identityVault.markStatus(id, status, options));
  ipcMain.handle("accounts:capabilities", (_event, id) =>
    identityVault.capabilities(id));
  ipcMain.handle("settings:get", () => store.getSettings());
  ipcMain.handle("settings:pick-folders", async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: "Choose folders OWL can access",
      buttonLabel: "Allow folders",
      properties: ["openDirectory", "multiSelections", "createDirectory"],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("settings:update", async (_event, patch) => {
    const next = store.updateSettings(patch ?? {});
    if (typeof patch?.launchAtLogin === "boolean" && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin });
    }
    if (
      "runtimeBaseUrl" in (patch ?? {}) ||
      "mcpEnabled" in (patch ?? {}) ||
      "mcpPort" in (patch ?? {})
    ) {
      await startMcp();
    }
    if (
      "wakeName" in (patch ?? {}) ||
      "wakeAliases" in (patch ?? {}) ||
      "allowedDirectories" in (patch ?? {})
    ) {
      await applyRuntimeUserPreferences(next);
    }
    if (
      "runtimeBaseUrl" in (patch ?? {}) ||
      "autoConnectRuntime" in (patch ?? {})
    ) {
      if (next.autoConnectRuntime) {
        await startRuntimeEventBridge();
      } else {
        stopRuntimeEventBridge();
      }
    }
    if (
      "tunnelEnabled" in (patch ?? {}) ||
      "tunnelBinaryPath" in (patch ?? {}) ||
      "tunnelId" in (patch ?? {}) ||
      "mcpPort" in (patch ?? {})
    ) {
      if (next.tunnelEnabled) {
        await tunnelSupervisor.restart({
          binaryPath: effectiveTunnelBinary(next),
          tunnelId: next.tunnelId,
          apiKey: tunnelApiKey(),
          mcpUrl: `http://127.0.0.1:${next.mcpPort}/mcp`,
        }).catch((error) => {
          record("error", "tunnel", "Tunnel restart failed", {
            message: error instanceof Error ? error.message : String(error),
          });
        });
      } else {
        await tunnelSupervisor.stop();
      }
    }
    if (
      "cloudEnabled" in (patch ?? {}) ||
      "cloudBaseUrl" in (patch ?? {}) ||
      "cloudDeviceId" in (patch ?? {}) ||
      "cloudPollIntervalMs" in (patch ?? {}) ||
      "cloudPresenceIntervalMs" in (patch ?? {}) ||
      "cloudTelemetryEnabled" in (patch ?? {})
    ) {
      if (
        next.cloudBaseUrl?.trim() &&
        next.cloudDeviceId?.trim() &&
        cloudDeviceCredential()
      ) {
        await startCloudBridge();
      } else {
        await stopCloudBridge();
      }
    }
    record("info", "desktop", "Settings updated");
    return next;
  });
  ipcMain.handle("secrets:list", () => store.listSecrets());
  ipcMain.handle("secrets:upsert", async (_event, input) => {
    const meta = store.upsertSecret(input);
    record("info", "vault", `Secret saved: ${meta.name}`, { project: meta.project });
    if (
      meta.name === "OWL_RUNTIME_API_TOKEN" ||
      meta.name === "OWL_MCP_API_TOKEN"
    ) {
      await startMcp();
    }
    if (meta.name === "OWL_RUNTIME_API_TOKEN") {
      const settings = store.getSettings();
      if (settings.autoConnectRuntime) await startRuntimeEventBridge();
    }
    if (meta.name === "OWL_TUNNEL_API_KEY") {
      const settings = store.getSettings();
      if (settings.tunnelEnabled) {
        await tunnelSupervisor.restart({
          binaryPath: effectiveTunnelBinary(settings),
          tunnelId: settings.tunnelId,
          apiKey: tunnelApiKey(),
          mcpUrl: `http://127.0.0.1:${settings.mcpPort}/mcp`,
        });
      }
    }
    if (meta.name === "OWL_CLOUD_DEVICE_CREDENTIAL") {
      const settings = store.getSettings();
      if (settings.cloudBaseUrl?.trim() && settings.cloudDeviceId?.trim()) {
        await startCloudBridge();
      }
    }
    return meta;
  });
  ipcMain.handle("secrets:delete", async (_event, id) => {
    const existing = store.listSecrets().find((secret) => secret.id === id);
    const result = store.deleteSecret(id);
    record("warn", "vault", "Secret removed", { id });
    if (
      existing?.name === "OWL_RUNTIME_API_TOKEN" ||
      existing?.name === "OWL_MCP_API_TOKEN"
    ) {
      await startMcp();
    }
    if (existing?.name === "OWL_RUNTIME_API_TOKEN") {
      const settings = store.getSettings();
      if (settings.autoConnectRuntime) await startRuntimeEventBridge();
    }
    if (existing?.name === "OWL_TUNNEL_API_KEY") {
      await tunnelSupervisor.stop();
    }
    if (existing?.name === "OWL_CLOUD_DEVICE_CREDENTIAL") {
      await stopCloudBridge();
    }
    return result;
  });
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  storageLayout = configureOwlDesktopStorage(app);

  app.on("second-instance", (_event, argv) => {
    const callbackUrl = argv.find((value) => isCloudAuthCallbackUrl(value));
    if (callbackUrl) acceptCloudAuthCallbackUrl(callbackUrl);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    store = new DesktopStore();
    identityVault = new IdentityVault();
    cloudBridgeStore = new CloudBridgeStore({
      file: path.join(app.getPath("userData"), "cloud-bridge-state.json"),
    });
    remoteSubmissionStore = new RemoteSubmissionStore({
      file: path.join(app.getPath("userData"), "remote-submissions.json"),
    });
    plannerContinuationStore = new PlannerContinuationStore({
      file: path.join(app.getPath("userData"), "planner-continuation.json"),
    });
    plannerContinuationStore.recoverConnectedTransports("desktop_restart");
    agentInbox = new AgentInboxStore({
      file: path.join(app.getPath("userData"), "agent-inbox.json"),
    });
    agentInbox.recoverExpiredClaims();
    runtimeAgentRequestConsumerStateFile = path.join(
      app.getPath("userData"),
      "runtime-agent-request-consumer.json",
    );
    runtimeAgentRequestBridgeStateFile = path.join(
      app.getPath("userData"),
      "runtime-agent-request-event-bridge.json",
    );
    runtimeAgentRequestConsumer = new RuntimeAgentRequestEventConsumer({
      inbox: agentInbox,
      stateFile: runtimeAgentRequestConsumerStateFile,
    });
    createRuntimeEventBridge();
    tunnelSupervisor = new TunnelSupervisor({
      onEvent(level, message, meta) {
        record(level, "tunnel", message, meta);
      },
    });
    registerIpc();
    record("info", "desktop", "OWL Desktop started", { version: app.getVersion() });
    const settings = store.getSettings();
    createWindow();
    await ensurePackagedLocalRuntime(settings);
    if (settings.cloudBaseUrl?.trim()) {
      await resumeCloudAccountSession();
    }
    if (pendingCloudAuthCallbackUrl) {
      const callbackUrl = pendingCloudAuthCallbackUrl;
      pendingCloudAuthCallbackUrl = null;
      await completeCloudAccountLogin(callbackUrl).catch(() => undefined);
    }
    await startMcp();
    if (settings.autoConnectRuntime) {
      await startRuntimeEventBridge().catch((error) => {
        record("error", "runtime-events", "Runtime event bridge start failed", {
          code: error?.code ?? null,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }
    if (
      devForceConnectivity ||
      (settings.tunnelEnabled && settings.tunnelAutoStart)
    ) {
      await startTunnel().catch((error) => {
        record("error", "tunnel", "Tunnel auto-start failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }
    if (
      settings.cloudDeviceId?.trim() &&
      cloudDeviceCredential() &&
      settings.cloudBaseUrl?.trim()
    ) {
      await startCloudBridge().catch((error) => {
        record("error", "cloud", "Cloud Bridge auto-start failed", {
          code: error?.code ?? null,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", () => {
    void devAuthCallbackServer?.stop();
    void cloudBridge?.stop();
    runtimeAgentRequestEventBridge?.stop();
    void tunnelSupervisor?.stop();
    void stopMcp();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
