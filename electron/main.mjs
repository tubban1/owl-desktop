import { activeManagedProcessCount } from "./services/usage-process-count.mjs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Notification, dialog, ipcMain, powerMonitor, shell } from "electron";
import { configureOwlDesktopStorage } from "./storage-layout.mjs";
import { installStdioEpipeGuard } from "../scripts/lib/stdio-epipe-guard.mjs";
import { assessConnectivityRecovery } from "./services/connectivity-recovery-result.mjs";
import { DesktopStore } from "./store.mjs";
import { createScopedProviderOperations } from "./services/provider-operations.mjs";
import { createGoDaddyRequester } from "./services/godaddy-domains.mjs";
import { UsageStatisticsStore } from "./services/usage-statistics-store.mjs";
import { RuntimeHttpClient } from "./runtime-http-client.mjs";
import { startWindowsDevRuntime, stopWindowsDevRuntime, restartWindowsDevRuntime, getWindowsDevAppliedPermissionFlags } from "./services/windows-dev-runtime.mjs";
import { probeWindowsDevDirectMcp } from "./services/windows-dev-direct-mcp.mjs";
import { startOwlMcpHttpServer } from "../mcp/http-server.mjs";
import { startWindowsDevNativeBrowser } from "./services/windows-dev-native-browser.mjs";
import { RuntimeHostSupervisor } from "./services/runtime-host-supervisor.mjs";
import { LocalRuntimeBootstrap } from "./services/local-runtime-bootstrap.mjs";
import { runtimePermissionProjection, validateRuntimePermissionChange, installedRuntimeSupportsSignedReview, runtimePermissionChangeCopy, assertSafePermissionCombination } from "./services/runtime-permissions.mjs";
import { readDevOwner, ownerMatches } from "../scripts/lib/dev-full-owner.mjs";
import { readDevRuntimePermissionStatus, devPermissionStatusFile } from "../scripts/lib/dev-runtime-permissions.mjs";
import { TunnelSupervisor } from "./services/tunnel-supervisor.mjs";
import { createConnectivityIncidentTracker } from "./services/connectivity-incident.mjs";
import { probeLocalNetwork, readLocalNetworkLink } from "./services/local-network-evidence.mjs";
import { probeOpenAiIncidents } from "./services/openai-status-evidence.mjs";
import { createConnectivityIncidentJournal } from "./services/connectivity-incident-journal.mjs";
import { tunnelTransportAvailable } from "./services/tunnel-availability.mjs";
import { ConnectionHostClient } from "./services/connection-host-client.mjs";
import { startDesktopCapabilityBridge } from "./services/desktop-capability-bridge.mjs";
import { IdentityVault } from "./services/identity-vault.mjs";
import { OwlMailService } from "../shared/owl-mail/service.mjs";
import { connectYoutubeBrowser } from "./services/youtube-oauth.mjs";
import { connectInstagramBrowser, instagramRedirectUri, validateInstagramAppSecret } from "./services/instagram-oauth.mjs";
import { publishInstagramReel } from "./services/instagram-publisher.mjs";
import { RuntimeSkillManagerPort } from "./services/skill-manager-port.mjs";
import { CloudHttpClient } from "./services/cloud-http-client.mjs";
import { CloudAccountAuth } from "./services/cloud-account-auth.mjs";
import { CloudEnrollmentService, cloudEnrollmentSecretNames } from "./services/cloud-enrollment-service.mjs";
import { CloudControlPlaneService } from "./services/cloud-control-plane-service.mjs";
import { RemoteSubmissionStore } from "./services/remote-submission-store.mjs";
import { RemoteDeviceControlService } from "./services/remote-device-control-service.mjs";
import { PlannerContinuationStore } from "./services/planner-continuation-store.mjs";
import { missionApprovalScope } from "./services/mission-approval.mjs";
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
import { createTunnelRecoveryPlan } from "./services/tunnel-recovery-plan.mjs";
import { ConnectivityHostLaunchAgent } from "./services/connectivity-host-launch-agent.mjs";
import { buildManagedTunnelConfig } from "./services/managed-tunnel-config.mjs";
import { recoverRuntimeAccessProjection } from "./services/runtime-access-recovery.mjs";
import { createRuntimeAccessRecoveryGate } from "./services/runtime-access-recovery-gate.mjs";
import { createRuntimeLeaseMaintenance } from "./services/runtime-lease-maintenance.mjs";
import { createConnectivityWakeRecovery } from "./services/connectivity-wake-recovery.mjs";
import { revokeDeviceCredentialLifecycle, rotateDeviceCredentialLifecycle } from "./services/device-credential-lifecycle.mjs";

// Keep the UI alive if a DEV terminal/remote MCP process closes its pipe.
installStdioEpipeGuard();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let storageLayout;
const devForceConnectivity =
  !app.isPackaged && process.env.OWL_DEV_FORCE_CONNECTIVITY === "true";
let externalConnectionHostUrl =
  process.env.OWL_CONNECTION_HOST_URL?.trim() || "";
let externalConnectionHostToken =
  process.env.OWL_CONNECTION_HOST_CONTROL_TOKEN?.trim() || "";
let externalConnectionHostEnabled =
  Boolean(externalConnectionHostUrl && externalConnectionHostToken);
const connectivityRecoveryOnly =
  process.env.OWL_CONNECTIVITY_RECOVERY_ONLY === "true" ||
  process.env.OWL_TUNNEL_RECOVERY_ONLY === "true";
const cloudMcpLiveProbeOnly =
  process.env.OWL_CLOUD_MCP_LIVE_PROBE_ONLY === "true";
const packagedConnectivityHostLiveProbeOnly =
  process.env.OWL_PACKAGED_CONNECTIVITY_HOST_LIVE_PROBE_ONLY === "true";
const packagedConnectivityHostSoakOnly =
  process.env.OWL_PACKAGED_CONNECTIVITY_HOST_SOAK_ONLY === "true";
const connectivityHostOnly =
  process.env.OWL_CONNECTIVITY_HOST_ONLY === "true";
const desktopCapabilityBridgePort = Number(
  process.env.OWL_DESKTOP_CAPABILITY_BRIDGE_PORT || "8792",
);
let mainWindow;
let approvalNotificationTimer;
let connectivityNotificationTimer;
const connectivityTracker=createConnectivityIncidentTracker();
let connectivityIncidentState=connectivityTracker.snapshot();
let connectivityJournal=null;
let connectivityNetworkEvidence=null;
let connectivityOfficialEvidence=null;
let connectivityProbeAt=0;
let connectivityRecordedLayer=null;
let connectivityIncidentStartedAt=null;
const announcedApprovalIds=new Set();
let store;
let scopedProviderOperations;
function providerOperations(){
  if(!scopedProviderOperations){
    scopedProviderOperations=createScopedProviderOperations({
      readCredential:()=>store.readSecret("GODADDY","global"),
      request:createGoDaddyRequester(),
      audit:(event)=>record("info","provider", "GoDaddy operation recorded",event),
    });
  }
  return scopedProviderOperations;
}
let identityVault;
let mailService;
let tunnelSupervisor;
let cloudBridgeStore;
let remoteSubmissionStore;
let plannerContinuationStore;
let cloudAccountAuth;
let cloudEnrollmentService;
let runtimeLeaseMaintenance;
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
let runtimeAccessProjectionFailure = null;
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
let windowsDevBrowser = null;
let mcpState = { status: "stopped", url: null, error: null };
let connectionHostClient;
let connectionHostSnapshot = null;
let connectionHostEventCursor = 0;
let desktopCapabilityBridge;
const seenConnectionHostEventIds = new Set();
const activity = [];
let usageStatistics = null;

const record = (level, source, message, meta = {}) => {
  activity.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    level,
    source,
    message,
    meta,
  });
  usageStatistics?.ingest(activity[0]);
  if (activity.length > 200) activity.length = 200;
};

function ingestConnectionHostEvents(events = []) {
  const ordered = [...events].sort(
    (a, b) =>
      Number(a?.seq ?? 0) - Number(b?.seq ?? 0) ||
      Date.parse(a?.at ?? "") - Date.parse(b?.at ?? ""),
  );
  for (const event of ordered) {
    if (!event?.id || seenConnectionHostEventIds.has(event.id)) continue;
    seenConnectionHostEventIds.add(event.id);
    activity.unshift({
      id: `connection-host:${event.id}`,
      at: event.at ?? new Date().toISOString(),
      level: event.level ?? "info",
      source: event.source ?? "connection-host",
      message: event.message ?? "Connection Host event",
      meta: event.meta ?? {},
    });
    usageStatistics?.ingest(activity[0]);
  }
  while (seenConnectionHostEventIds.size > 800) {
    const oldest = seenConnectionHostEventIds.values().next().value;
    seenConnectionHostEventIds.delete(oldest);
  }
  if (activity.length > 200) activity.length = 200;
}

async function refreshConnectionHost() {
  if (!connectionHostClient) return null;
  try {
    const snapshot = await connectionHostClient.health();
    connectionHostSnapshot = snapshot;
    const latestCursor = Math.max(0, Number(snapshot?.eventCursor ?? 0) || 0);
    if (latestCursor < connectionHostEventCursor) {
      connectionHostEventCursor = 0;
    }
    const eventBatch = await connectionHostClient
      .events(connectionHostEventCursor, { limit: 80 })
      .catch(() => null);
    if (eventBatch?.events?.length) {
      ingestConnectionHostEvents(eventBatch.events);
    }
    connectionHostEventCursor = Math.max(
      connectionHostEventCursor,
      Number(eventBatch?.cursor ?? connectionHostEventCursor) || 0,
    );
    mcpState = {
      status: snapshot?.mcp?.status ?? "running",
      url: snapshot?.mcp?.url ?? null,
      error: null,
    };
    return snapshot;
  } catch (error) {
    connectionHostSnapshot = null;
    mcpState = {
      status: "error",
      url: null,
      error: error instanceof Error ? error.message : String(error),
    };
    return null;
  }
}

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
  if (!app.isPackaged && process.platform==="win32" && process.env.OWL_WIN_DEV_MANAGE_RUNTIME==="true") {
    const result=await restartWindowsDevRuntime({store,baseUrl:settings.runtimeBaseUrl});
    if(!result.managed) {
      record("warn","runtime","Windows DEV preferences saved but Runtime is not Desktop-owned",{reason:result.reason});
      return {applied:false,reason:result.reason};
    }
    record("info","runtime","Windows DEV folder preferences applied through Runtime restart",{
      effectiveDirectoryCount:result.effectiveDirectoryCount,
      blockedDirectoryReasons:result.blockedDirectoryReasons,
    });
    return {applied:true,effectiveDirectoryCount:result.effectiveDirectoryCount};
  }
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

async function ensurePackagedConnectivityHost() {
  if (!app.isPackaged || connectivityHostOnly) return null;
  const token = connectivityHostControlToken({ create: true });
  if (!token) {
    throw new Error("Connectivity Host control token is unavailable.");
  }

  setExternalConnectionHost({
    baseUrl: "http://127.0.0.1:8791",
    token,
  });
  const service = new ConnectivityHostLaunchAgent({
    desktopExecPath: process.execPath,
    onEvent(level, message, meta) {
      record(level, "connectivity-host-service", message, meta);
    },
  });
  const ensured = await service.ensure();

  const deadline = Date.now() + 20_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const health = await connectionHostClient.health();
      if (health?.ok === true && health?.service === "owl-connection-host") {
        record("info", "connectivity-host-service", "Background Connectivity Host is ready", {
          pid: health.pid ?? null,
          launchd: ensured.launchd,
        });
        return { ...ensured, health };
      }
      lastError = new Error("Connectivity Host returned an invalid health payload.");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Object.assign(
    new Error(
      `Background Connectivity Host did not become ready: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    ),
    { code: "CONNECTIVITY_HOST_START_TIMEOUT" },
  );
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

function canonicalDesktopRoot() {
  return path.join(app.getPath("appData"), "OWL LAB", "desktop");
}

function setExternalConnectionHost({ baseUrl, token }) {
  externalConnectionHostUrl = String(baseUrl ?? "").trim();
  externalConnectionHostToken = String(token ?? "").trim();
  externalConnectionHostEnabled = Boolean(
    externalConnectionHostUrl && externalConnectionHostToken,
  );
  connectionHostClient = externalConnectionHostEnabled
    ? new ConnectionHostClient({
        baseUrl: externalConnectionHostUrl,
        token: externalConnectionHostToken,
      })
    : undefined;
  return externalConnectionHostEnabled;
}

function connectivityHostControlToken({ create = false } = {}) {
  const existing =
    store.readSecret(
      "OWL_CONNECTION_HOST_CONTROL_TOKEN",
      "owl-connectivity",
    ) ??
    store.readSecret("OWL_CONNECTION_HOST_CONTROL_TOKEN");
  if (existing || !create) return existing;
  const value = randomBytes(32).toString("base64url");
  store.upsertSecret({
    name: "OWL_CONNECTION_HOST_CONTROL_TOKEN",
    project: "owl-connectivity",
    value,
  });
  return value;
}

async function syncConnectionHostCloudMcp() {
  if (!externalConnectionHostEnabled || !connectionHostClient || !store) return null;
  const settings = store.getSettings();
  const deviceCredential = cloudDeviceCredential();
  if (
    settings.cloudEnabled !== true ||
    !settings.cloudBaseUrl?.trim() ||
    !settings.cloudDeviceId?.trim() ||
    !deviceCredential
  ) {
    return connectionHostClient.stopCloudMcp().catch(() => null);
  }
  return connectionHostClient.configureCloudMcp({
    baseUrl: settings.cloudBaseUrl.trim(),
    deviceId: settings.cloudDeviceId.trim(),
    deviceCredential,
    pollIntervalMs: settings.cloudPollIntervalMs,
  });
}

async function resolveManagedTunnelConfig(
  settings = store.getSettings(),
  { mcpPort = settings.mcpPort } = {},
) {
  if (settings.connectivityMode !== "managed_tunnel") {
    return {
      projection: {
        mode: "cloud_durable",
        managedTunnel: {
          available: false,
          state: "disabled",
          reason: "managed_tunnel_not_selected",
        },
      },
      config: null,
    };
  }

  const deviceCredential = cloudDeviceCredential();
  if (
    settings.cloudEnabled !== true ||
    !settings.cloudBaseUrl?.trim() ||
    !settings.cloudDeviceId?.trim() ||
    !deviceCredential
  ) {
    return {
      projection: {
        mode: "cloud_durable",
        managedTunnel: {
          available: false,
          state: "not_configured",
          reason: "cloud_device_enrollment_incomplete",
        },
      },
      config: null,
    };
  }

  const cloud = new CloudHttpClient({
    baseUrl: settings.cloudBaseUrl.trim(),
    deviceCredential,
  });
  const projection = await cloud.connectivityBootstrap();
  return {
    projection,
    config: buildManagedTunnelConfig({
      projection,
      deviceCredential,
      binaryPath: effectiveTunnelBinary(settings),
      mcpUrl: `http://127.0.0.1:${mcpPort}/mcp`,
    }),
  };
}

async function reconcileManagedTunnel({
  settings = store.getSettings(),
  client = connectionHostClient,
  currentTunnel = null,
  mcpPort = settings.mcpPort,
  forceRestart = false,
} = {}) {
  if (settings.connectivityMode !== "managed_tunnel") return null;
  const resolved = await resolveManagedTunnelConfig(settings, { mcpPort });
  const status =
    currentTunnel ??
    (client ? (await client.health())?.tunnel ?? null : tunnelSupervisor?.status());

  if (!resolved.config) {
    if (
      status?.desiredRunning === true ||
      ["running", "restarting"].includes(status?.state)
    ) {
      if (client) await client.stopTunnel();
      else await tunnelSupervisor?.stop();
    }
    record("info", "managed-tunnel", "Managed Tunnel is not active; Durable MCP remains primary", {
      state: resolved.projection?.managedTunnel?.state ?? "unknown",
      reason: resolved.projection?.managedTunnel?.reason ?? null,
    });
    return {
      projection: resolved.projection,
      tunnel: client ? (await client.health())?.tunnel ?? null : tunnelSupervisor?.status(),
    };
  }

  const sameManagedControlPlane =
    status?.controlPlaneBaseUrl === resolved.config.controlPlaneBaseUrl;
  const tunnelRunning = ["running", "restarting"].includes(status?.state);
  let tunnel = status;
  if (forceRestart || !tunnelRunning || !sameManagedControlPlane) {
    tunnel =
      client
        ? tunnelRunning || status?.desiredRunning === true
          ? await client.restartTunnel(resolved.config)
          : await client.startTunnel(resolved.config)
        : tunnelRunning || status?.desiredRunning === true
          ? await tunnelSupervisor.restart(resolved.config)
          : await tunnelSupervisor.start(resolved.config);
  }
  record("info", "managed-tunnel", "OWL Managed Tunnel reconciled", {
    state: resolved.projection?.managedTunnel?.state ?? "active",
    controlPlane: "owl-cloud",
    credentialSource: "device",
  });
  return { projection: resolved.projection, tunnel };
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
    ...(runtimeAccessProjectionFailure ? {
      lastErrorCode: runtimeAccessProjectionFailure.code,
      lastErrorMessage: runtimeAccessProjectionFailure.message,
    } : {}),
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
    runtimeAccessProjectionFailure = null;
    record("info", "runtime-access", "Runtime access projection updated", {
      state: state?.state ?? null,
      reasonCode: state?.reasonCode ?? null,
      deviceId,
      expiresAt: state?.grant?.expiresAt ?? null,
    });
    return state;
  } catch (error) {
    // Preserve the underlying signature/lease failure instead of turning a
    // stale LOCKED grant into a misleading ACCOUNT_LOGIN_REQUIRED instruction.
    const raw = error instanceof Error ? error.message : String(error);
    const leaseCode = raw.match(/RUNTIME_ACCESS_[A-Z_]+/)?.[0];
    const code = leaseCode || (typeof error?.code === "string" ?
      error.code : "RUNTIME_ACCESS_PROJECTION_FAILED");
    runtimeAccessProjectionFailure = {
      code,
      message: "Cloud sign-in succeeded, but Runtime lease projection failed ("+
        code+"). Check the trusted Cloud verifier, current device, and signed lease.",
    };
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
    await syncConnectionHostCloudMcp().catch((error) => {
      record("warn", "cloud-mcp", "Cloud MCP activation after enrollment failed", {
        code: error?.code ?? error?.name ?? "ERROR",
      });
    });
    if (store.getSettings().connectivityMode === "managed_tunnel") {
      await reconcileManagedTunnel().catch((error) => {
        record("warn", "managed-tunnel", "Managed Tunnel activation after enrollment failed", {
          code: error?.code ?? error?.name ?? "ERROR",
        });
      });
    }
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

    const recovered = await recoverRuntimeAccessAfterReconnect({ force: true });
    if (recovered?.state === "READY") {
      return {
        ...cloudAccountSnapshot(),
        interactionRequired: false,
      };
    }

    const code = runtimeAccessProjectionFailure?.code ||
      recovered?.reasonCode || currentAccess?.reasonCode ||
      "RUNTIME_ACCESS_PROJECTION_FAILED";
    const error = new Error(runtimeAccessProjectionFailure?.message ||
      "Cloud account is signed in, but Runtime authorization is not READY ("+
      code+"). Inspect the Cloud device entitlement and the signed lease verifier.");
    error.code = code;
    throw error;
  }

  const started = await beginCloudAccountLogin();
  return {
    ...started,
    interactionRequired: true,
  };
}

const runtimeAccessRecoveryGate = createRuntimeAccessRecoveryGate({
  recover: async () => recoverRuntimeAccessAfterReconnectOnce(),
});

function recoverRuntimeAccessAfterReconnect({ force = false } = {}) {
  return runtimeAccessRecoveryGate.run({ force });
}

async function recoverRuntimeAccessAfterReconnectOnce() {
  try {
    const service = cloudEnrollmentService ?? ensureCloudEnrollmentService();
    const recovered = await recoverRuntimeAccessProjection({
      cloudState: cloudAccountState,
      enrollmentService: service,
      projectRuntimeAccess: async ({
        account,
        access,
        deviceId,
        runtimeLease,
      }) =>
        await safeSyncRuntimeAccess(
          account,
          access,
          deviceId,
          runtimeLease,
        ),
    });
    if (!recovered) return null;

    const runtimeAccess = recovered.runtimeAccess;
    // A lease refresh was attempted, but an explicit LOCKED/REVOKED result
    // is not a recovery. It must not create a misleading success event or
    // recursively trigger the onCloudAccountUpdated refresh loop.
    if (runtimeAccess?.state !== "READY") {
      record("warn", "runtime-access", "Runtime access remains unavailable after lease refresh", {
        state: runtimeAccess?.state ?? null,
        reasonCode: runtimeAccess?.reasonCode ?? null,
      });
      return runtimeAccess ?? null;
    }
    cloudAccountState = recovered.state;
    record("info", "runtime-access", "Runtime access recovered after reconnect", {
      state: runtimeAccess.state,
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

function startRuntimeLeaseMaintenance() {
  if (runtimeLeaseMaintenance) return;
  runtimeLeaseMaintenance = createRuntimeLeaseMaintenance({
    getCloudState: () => cloudAccountState,
    inspectRuntimeAccess: () => runtimeClient().runtimeAccess(),
    recover: () => recoverRuntimeAccessAfterReconnect(),
    onEvent: (level, message, meta) => record(level, "runtime-access", message, meta),
  });
  runtimeLeaseMaintenance.start();
  // Mac main process stays alive after closing the last window. This cannot
  // depend on renderer Refresh or a ChatGPT conversation being open.
  void runtimeLeaseMaintenance.check("startup");
  const onWake = () => { void runtimeLeaseMaintenance?.check("power_resume"); };
  powerMonitor.on("resume", onWake);
  app.once("before-quit", () => {
    powerMonitor.removeListener("resume", onWake);
    runtimeLeaseMaintenance?.stop();
  });
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

async function rotateCurrentCloudDeviceCredential() {
  const settings = store.getSettings();
  const deviceId = settings.cloudDeviceId?.trim();
  if (!deviceId) {
    throw new Error("This Mac is not enrolled as an OWL Cloud device.");
  }

  const result = await rotateDeviceCredentialLifecycle({
    deviceId,
    controlPlane: cloudControlPlane(),
    restartCloudBridge: () => startCloudBridge(),
    rebindCloudMcp: () => syncConnectionHostCloudMcp(),
    stopCloudMcp: () => connectionHostClient?.stopCloudMcp(),
    managedTunnelEnabled: settings.connectivityMode === "managed_tunnel",
    restartManagedTunnel: () =>
      reconcileManagedTunnel({
        settings,
        forceRestart: true,
      }),
  });

  record("info", "cloud", "OWL Cloud device credential rotated", {
    deviceId,
    cloudMcpRebound: true,
    managedTunnelRestarted: settings.connectivityMode === "managed_tunnel",
    secretExposedToRenderer: false,
  });
  return result;
}

async function revokeCurrentCloudDevice() {
  const settings = store.getSettings();
  const deviceId = settings.cloudDeviceId?.trim();
  if (!deviceId) {
    throw new Error("This Mac is not enrolled as an OWL Cloud device.");
  }

  const { revokedDevice, runtimeAccess } =
    await revokeDeviceCredentialLifecycle({
      deviceId,
      controlPlane: cloudControlPlane(),
      deleteLocalCredential: async () => {
        const credentialMeta = store
          .listSecrets()
          .find(
            (entry) =>
              entry.name === cloudEnrollmentSecretNames.deviceCredential &&
              entry.project === cloudEnrollmentSecretNames.project,
          );
        if (credentialMeta) store.deleteSecret(credentialMeta.id);
      },
      stopCloudBridge: () => stopCloudBridge(),
      stopCloudMcp: async () => {
        if (externalConnectionHostEnabled) {
          await connectionHostClient.stopCloudMcp();
        }
      },
      stopTunnel: () => stopTunnel(),
      updateLocalSettings: async () => {
        store.updateSettings({
          cloudDeviceId: "",
          cloudEnabled: false,
          ...(settings.connectivityMode === "custom_tunnel"
            ? { tunnelEnabled: false, tunnelAutoStart: false }
            : {}),
        });
      },
      revokeRuntimeAccess: () =>
        runtimeClient().revokeRuntimeAccess("CLOUD_DEVICE_REVOKED", {
          idempotencyKey: `runtime-access-revoke:${deviceId}:device-revoked`,
        }),
    });

  cloudAccountState = {
    ...cloudAccountState,
    status: cloudAccountState.account ? "ready" : "signed_out",
    access: null,
    runtimeAccess,
    deviceId: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  };
  record("warn", "cloud", "This OWL Cloud device was revoked", {
    deviceId,
    runtimeAccess: runtimeAccess?.state ?? null,
    customTunnelCredentialPreserved: true,
  });
  mainWindow?.webContents?.send(
    "cloud:account-updated",
    cloudAccountSnapshot(),
  );
  return revokedDevice;
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
  const connectionHost = externalConnectionHostEnabled
    ? await refreshConnectionHost()
    : null;
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
  const activeProcesses = activeManagedProcessCount(processes);
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
      mcpAvailable: externalConnectionHostEnabled
        ? connectionHost?.mcp?.status === "running"
        : mcpState.status === "running",
      tunnelAvailable: externalConnectionHostEnabled
        ? tunnelTransportAvailable(connectionHost?.tunnel)
        : tunnelTransportAvailable(tunnelSupervisor?.status()),
      durableMcpAvailable:
        externalConnectionHostEnabled &&
        connectionHost?.cloudMcp?.configured === true &&
        connectionHost?.cloudMcp?.consumer?.ready === true,
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
        mcpSessions: externalConnectionHostEnabled
          ? connectionHost?.mcp?.sessionCount ?? 0
          : mcpServer?.snapshot()?.sessionCount ?? 0,
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

async function tunnelStatus() {
  if (externalConnectionHostEnabled) {
    const snapshot = await refreshConnectionHost();
    return snapshot?.tunnel ?? { state: "unavailable" };
  }
  return tunnelSupervisor?.status() ?? { state: "stopped" };
}

async function stopTunnel() {
  if (externalConnectionHostEnabled) {
    return connectionHostClient.stopTunnel();
  }
  return tunnelSupervisor.stop();
}

async function restartTunnel(config) {
  if (externalConnectionHostEnabled) {
    return connectionHostClient.restartTunnel(config);
  }
  return tunnelSupervisor.restart(config);
}

async function startTunnel() {
  const settings = store.getSettings();
  if (
    !devForceConnectivity &&
    (settings.connectivityMode !== "custom_tunnel" || !settings.tunnelEnabled)
  ) {
    return stopTunnel();
  }
  const config = {
    binaryPath: effectiveTunnelBinary(settings),
    tunnelId: settings.tunnelId,
    apiKey: tunnelApiKey(),
    mcpUrl: `http://127.0.0.1:${settings.mcpPort}/mcp`,
  };
  if (externalConnectionHostEnabled) {
    return connectionHostClient.startTunnel(config);
  }
  return tunnelSupervisor.start(config);
}

async function stopMcp() {
  if (externalConnectionHostEnabled) {
    await refreshConnectionHost();
    return mcpState;
  }
  if (mcpServer) {
    await mcpServer.close().catch(() => undefined);
    mcpServer = undefined;
  }
  mcpState = { status: "stopped", url: null, error: null };
  return mcpState;
}

async function startMcp() {
  const settings = store.getSettings();
  if (!settings.mcpEnabled && !devForceConnectivity) {
    await stopMcp();
    return mcpState;
  }

  if (externalConnectionHostEnabled) {
    mcpState = { status: "starting", url: null, error: null };
    await refreshConnectionHost();
    return mcpState;
  }

  await stopMcp();
  mcpState = { status: "starting", url: null, error: null };

  try {
    if (!windowsDevBrowser) {
      // The macOS Connection Host and Windows DEV use exactly the same
      // Native Messaging browser bridge contract; never enable in packages.
      windowsDevBrowser = await startWindowsDevNativeBrowser({
        platform: process.platform,
        packaged: app.isPackaged,
        enabled: process.env.OWL_WIN_DEV_NATIVE_BROWSER === "true",
        userDataRoot: app.getPath("userData"),
      }).catch((error) => {
        record("warn", "agent-browser", "Windows DEV Native Messaging unavailable", {
          code: error?.code ?? error?.message ?? "NATIVE_BRIDGE_START_FAILED",
        });
        return null;
      });
    }
    mcpServer = await startOwlMcpHttpServer({
      port: settings.mcpPort,
      runtimeBaseUrl: effectiveRuntimeBaseUrl(settings),
      runtimeToken: runtimeToken(),
      mcpToken: mcpToken(),
      fallbackOwnerId: settings.sessionId,
      agentInbox,
      remoteDeviceControl: remoteDeviceControl(),
      mailService,
      providerOperations:providerOperations(),
      userChromeBridge: windowsDevBrowser?.bridge ?? null,
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
  const [info, runtimeAccess, health, tasks, processes, diagnostics, host] =
    await Promise.allSettled([
      client.info(),
      client.runtimeAccess(),
      client.health(),
      client.tasks(),
      client.processes(),
      settings.diagnosticsEnabled ? client.diagnostics(40) : Promise.resolve(null),
      runtimeHostSupervisor().status(),
    ]);

  const connectionHost = externalConnectionHostEnabled
    ? await refreshConnectionHost()
    : null;
  const connectionHostDetails =
    externalConnectionHostEnabled && options.detailedMcp === true
      ? await connectionHostClient?.diagnostics().catch(() => null)
      : null;

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
    if (recovered?.state === "READY") {
      // Read Runtime's canonical current access after projection, not a
      // cached Cloud snapshot or a failed attempt's temporary state.
      effectiveRuntimeAccess = await client.runtimeAccess().catch(() => recovered);
    }
  }

  // Never poll the protected approvals projection while Runtime is locked.
  // A legitimate LOCKED state is not a flood-worthy error condition.
  const approvals = effectiveRuntimeAccess?.state === "READY" ||
    effectiveRuntimeAccess?.mode === "compat"
    ? (await Promise.allSettled([client.approvals()]))[0]
    : { status: "fulfilled", value: [] };

  const result = {
    mode: online ? "live" : "offline",
    checkedAt: new Date().toISOString(),
    runtimeEndpoint: effectiveRuntimeBaseUrl(settings),
    latencyMs: Date.now() - started,
    info: info.status === "fulfilled" ? info.value : null,
    runtimeAccess: effectiveRuntimeAccess,
    runtimeAccessError: runtimeAccess.status === "rejected"
      ? { code: typeof runtimeAccess.reason?.code === "string"
          ? runtimeAccess.reason.code
          : runtimeAccess.reason?.name === "AbortError" ||
            /timed out/i.test(String(runtimeAccess.reason?.message ?? ""))
            ? "RUNTIME_ACCESS_PROBE_TIMEOUT" : "RUNTIME_ACCESS_PROBE_FAILED" }
      : null,
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
    mcp: externalConnectionHostEnabled
      ? {
          ...mcpState,
          ...(connectionHostDetails?.mcp ??
            connectionHost?.mcp ?? { sessionCount: 0 }),
          sessions: connectionHostDetails?.mcp?.sessions ?? [],
        }
      : {
          ...mcpState,
          ...(mcpServer?.snapshot() ?? { sessionCount: 0, sessions: [] }),
        },
    host: host.status === "fulfilled" ? host.value : null,
    tunnel: externalConnectionHostEnabled
      ? connectionHost?.tunnel ?? { state: "unavailable" }
      : tunnelSupervisor?.status() ?? { state: "stopped" },
    cloudMcp: externalConnectionHostEnabled
      ? connectionHost?.cloudMcp ?? {
          configured: false,
          config: null,
          consumer: null,
          completionStore: null,
        }
      : {
          configured: false,
          config: null,
          consumer: null,
          completionStore: null,
        },
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
  ipcMain.handle("desktop:statistics", async () => {
    if (externalConnectionHostEnabled) await refreshConnectionHost();
    return usageStatistics?.snapshot() ?? { since: new Date().toISOString(), days: [] };
  });
  ipcMain.handle("desktop:activity:list", async () => {
    if (externalConnectionHostEnabled) await refreshConnectionHost();
    return activity.slice(0, 200);
  });
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
  ipcMain.handle("desktop:direct-mcp-status", () =>
    probeWindowsDevDirectMcp({
      platform: process.platform,
      packaged: app.isPackaged,
      mcpPort: store.getSettings().mcpPort,
    }),
  );
  ipcMain.handle("mission:review:list", () =>
    plannerContinuationStore?.listMissionReviews() ?? []);
  ipcMain.handle("mission:review:approve", async (_event, workstreamId) => {
    if (typeof workstreamId !== "string" || !/^owl-workstream:[\w-]+$/.test(workstreamId))
      throw new Error("MISSION_WORKSTREAM_ID_REQUIRED");
    const before = plannerContinuationStore?.get(workstreamId);
    if (!before?.workstream || before.workstream.status === "completed")
      throw new Error("MISSION_WORKSTREAM_NOT_ACTIVE");
    const scope = missionApprovalScope(before);
    if (!scope?.workspaceRoot || !scope.allowedRepositories.length ||
        !scope.allowedRepositories.includes(path.basename(scope.workspaceRoot)))
      throw new Error("MISSION_SCOPE_INCOMPLETE: planner must provide an exact workspace.worktree and allowed repository.");
    const detail = [
      "This approval is only for the mission and repository shown below.",
      "It does not bypass Runtime permissions or authorize raw shell commands.",
      "",
      "Workstream: " + workstreamId,
      "Original goal: " + scope.originalGoal,
      "Workspace root: " + scope.workspaceRoot,
      "Allowed repositories: " + scope.allowedRepositories.join(", "),
      "Prohibited changes: " + (scope.prohibitedChanges.join("; ") || "(none specified)"),
      "Acceptance: " + (scope.acceptanceCriteria.join("; ") || "(not specified)"),
      "",
      "Reject if these are not exactly what you requested."
    ].join("\n");
    const {response} = await dialog.showMessageBox(mainWindow ?? undefined,{
      type:"warning",
      buttons:["Cancel", "Approve exactly this mission"],
      defaultId:0,cancelId:0,noLink:true,
      title:"OWL Mission scope approval",
      message:"Confirm mission and repository scope",
      detail,
    });
    if (response !== 1) return {approved:false, cancelled:true};
    // Re-read after the user's decision: consent cannot cover a changed scope.
    const latest = plannerContinuationStore.get(workstreamId);
    if (JSON.stringify(missionApprovalScope(latest)) !== JSON.stringify(scope))
      throw new Error("MISSION_SCOPE_CHANGED_DURING_REVIEW");
    store.ensureHumanApprovalSigner();
    const signature=store.signMissionScope(scope);
    const result=plannerContinuationStore.attachMissionApproval(workstreamId,signature);
    record("info","desktop","Mission scope approved by local human dialog",{
      workstreamId, digest:result.digest,
    });
    return result;
  });
  ipcMain.handle("runtime:approvals:list", () => runtimeClient().approvals());
  ipcMain.handle("runtime:approval:approve", async (_event, approvalId) => {
    if (typeof approvalId !== "string" || !approvalId.trim()) {
      throw new Error("APPROVAL_ID_REQUIRED");
    }
    const approval=await runtimeClient().getApproval(approvalId.trim());
    if(approval?.state!=="pending"||Date.parse(approval.expiresAt)<=Date.now())
      throw new Error("APPROVAL_NOT_PENDING_OR_EXPIRED");
    const modes=store.getSettings().runtimePermissionModes??{};
    const reviewing=Object.values(modes).includes("review");
    let humanProof;
    if(reviewing){
      const devReviewVerified=!app.isPackaged&&devForceConnectivity&&
        verifiedDevPermissionStatus()?.healthy===true&&
        verifiedDevPermissionStatus()?.reviewReady===true&&
        !currentRuntimePermissionProjection().restartRequired;
      if(!(devReviewVerified||
          (app.isPackaged&&createLocalRuntimeBootstrap(store.getSettings()))))
        throw new Error("SIGNED_APPROVAL_REQUIRES_VERIFIED_MANAGED_RUNTIME");
      if(!store.getHumanApprovalPublicKey())
        throw new Error("OS_HUMAN_SIGNER_NOT_PROVISIONED");
      if(approval.review?.complete!==true)
        throw new Error("EXACT_ACTION_ARGUMENT_PREVIEW_UNAVAILABLE");
    }
    const detail=approval.review?.fields
      ? JSON.stringify(approval.review.fields,null,2)
      : "Exact argument preview is unavailable in this Runtime.";
    const {response}=await dialog.showMessageBox(mainWindow??undefined,{
      type:"warning",buttons:["Cancel","Approve exact action"],
      defaultId:0,cancelId:0,noLink:true,title:"OWL Runtime exact action approval",
      message:`${approval.subject} · ${approval.riskLevel} risk`,
      detail:`Task: ${approval.ownerTaskId??"direct"} / Step: ${approval.ownerStepId??"—"}
Expires: ${approval.expiresAt}
Fingerprint: ${approval.fingerprint}

${detail}

Only this single action will be approved.`,
    });
    if(response!==1)throw new Error("USER_DECLINED_ACTION_APPROVAL");
    if(reviewing)humanProof=store.signHumanApproval(approval);
    const result = await runtimeClient().approveApproval(approvalId.trim(), {
      requestId: `desktop-approval:approve:${approvalId.trim()}:${Date.now().toString(36)}`,
      idempotencyKey: `desktop-approval:approve:${approvalId.trim()}`,
      ...(humanProof?{humanProof}:{}),
    });
    record("info", "desktop", "Runtime approval granted", {
      approvalId: approvalId.trim(),
    });
    return result;
  });
  ipcMain.handle("runtime:approval:deny", async (_event, approvalId) => {
    if (typeof approvalId !== "string" || !approvalId.trim()) {
      throw new Error("APPROVAL_ID_REQUIRED");
    }
    const result = await runtimeClient().denyApproval(approvalId.trim(), {
      requestId: `desktop-approval:deny:${approvalId.trim()}:${Date.now().toString(36)}`,
      idempotencyKey: `desktop-approval:deny:${approvalId.trim()}`,
    });
    record("info", "desktop", "Runtime approval denied", {
      approvalId: approvalId.trim(),
    });
    return result;
  });
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
  ipcMain.handle("connectivity:recover", async () => {
    const settings = store.getSettings();
    await startMcp();
    if (settings.connectivityMode === "custom_tunnel") {
      const tunnel = await startTunnel();
      return {
        mode: "custom_tunnel",
        tunnel,
        cloudMcp: null,
        recovery: assessConnectivityRecovery({
          mode: "custom_tunnel",
          mcpRunning: mcpState.status === "running",
          tunnel,
        }),
      };
    }
    const cloudMcp = await syncConnectionHostCloudMcp();
    let managedTunnel = null;
    if (settings.connectivityMode === "managed_tunnel") {
      managedTunnel = await reconcileManagedTunnel({ settings }).catch((error) => ({
        projection: {
          mode: "cloud_durable",
          managedTunnel: {
            available: false,
            state: "failed",
            reason: error?.code ?? error?.name ?? "managed_tunnel_recovery_failed",
          },
        },
        tunnel: null,
      }));
    }
    const host = externalConnectionHostEnabled
      ? await refreshConnectionHost()
      : null;
    const currentCloudMcp = host?.cloudMcp ?? cloudMcp ?? null;
    return {
      mode: settings.connectivityMode,
      tunnel: host?.tunnel ?? managedTunnel?.tunnel ?? null,
      cloudMcp: currentCloudMcp,
      managedTunnel: managedTunnel?.projection ?? null,
      recovery: assessConnectivityRecovery({
        mode: settings.connectivityMode,
        hostConnected: host?.ok === true,
        mcpRunning: mcpState.status === "running",
        cloudEnabled: settings.cloudEnabled,
        cloudBaseUrl: settings.cloudBaseUrl,
        deviceId: settings.cloudDeviceId,
        deviceCredentialAvailable: Boolean(cloudDeviceCredential()),
        cloudMcp: currentCloudMcp,
      }),
    };
  });
  ipcMain.handle("cloud:devices:list", () =>
    cloudControlPlane().listDevices(),
  );
  ipcMain.handle("cloud:device:credential:rotate", () =>
    rotateCurrentCloudDeviceCredential(),
  );
  ipcMain.handle("cloud:device:revoke", () =>
    revokeCurrentCloudDevice(),
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
  ipcMain.handle("tunnel:status", () => tunnelStatus());
  ipcMain.handle("connectivity:incident", () => connectivityIncidentState);
  ipcMain.handle("connectivity:timeline", () => connectivityJournal?.list(30)??[]);
  ipcMain.handle("tunnel:start", () => startTunnel());
  ipcMain.handle("tunnel:stop", () => stopTunnel());
  ipcMain.handle("accounts:instagram-config-status", () => {
    const settings=store.getSettings();
    const appId=settings.instagramAppId?.trim()??"";
    let redirectUri=null;
    try{redirectUri=instagramRedirectUri(settings.cloudBaseUrl);}catch{}
    return {appId,secretConfigured:!!appId && !!store.readSecret("INSTAGRAM_OAUTH_APP_SECRET",appId),
      redirectUri};
  });
  ipcMain.handle("accounts:instagram-config-save", (_event,input) => {
    const appId=String(input?.appId??"").trim();
    if(!/^[0-9]{6,30}$/.test(appId))throw Error("INSTAGRAM_OAUTH_APP_ID_REQUIRED");
    const secret=String(input?.appSecret??"");
    if(secret)validateInstagramAppSecret(secret);
    if(!secret&&!store.readSecret("INSTAGRAM_OAUTH_APP_SECRET",appId))
      throw Error("INSTAGRAM_OAUTH_APP_SECRET_REQUIRED");
    if(secret)store.upsertSecret({name:"INSTAGRAM_OAUTH_APP_SECRET",project:appId,value:secret});
    store.updateSettings({instagramAppId:appId});
    return {appId,secretConfigured:true};
  });
  ipcMain.handle("accounts:instagram-connect",async (_event,id)=>{
    const account=identityVault.get(id);
    if(!account||account.service.trim().toLowerCase()!=="instagram")
      throw Error("INSTAGRAM_ACCOUNT_NOT_FOUND");
    const settings=store.getSettings();
    const appId=settings.instagramAppId?.trim();
    const appSecret=store.readSecret("INSTAGRAM_OAUTH_APP_SECRET",appId);
    if(!appId||!appSecret)throw Error("INSTAGRAM_OAUTH_APP_CONFIG_REQUIRED");
    identityVault.noteInstagramOauthAttempt(id);
    try{
      const result=await connectInstagramBrowser({appId,appSecret,
       cloudBaseUrl:settings.cloudBaseUrl,expectedUsername:account.identifier,
       openExternal:async url=>shell.openExternal(url)});
      const saved=identityVault.saveInstagramGrant(id,result,appId);
      record("info","publish-oauth","Instagram professional account verified",{accountId:result.accountId});
      return saved;
    }catch(e){
      const raw=e instanceof Error?e.message:"";
      const safe=/^INSTAGRAM_OAUTH_[A-Z0-9_]{1,80}$/.test(raw)
        ?raw:"INSTAGRAM_OAUTH_CONNECTION_FAILED";
      identityVault.noteInstagramOauthAttempt(id,safe);
      record("warn","publish-oauth","Instagram authorization incomplete",{code:safe});
      throw Error(safe);
    }
  });
  ipcMain.handle("accounts:instagram-select-reel", async () => {
    const chosen=await dialog.showOpenDialog(mainWindow,{title:"Choose Instagram Reel",
      properties:["openFile"],filters:[{name:"MP4 videos",extensions:["mp4"]}]});
    return chosen.canceled?null:chosen.filePaths[0]??null;
  });
  ipcMain.handle("accounts:instagram-publish",async (_event,input)=>{
    if(!input||input.approved!==true||typeof input.accountId!=="string"||
      typeof input.mediaPath!=="string"||typeof input.caption!=="string")
      throw Error("INSTAGRAM_PUBLISH_INVALID_REQUEST");
    const configuredApp=store.getSettings().instagramAppId?.trim();
    try{
      const result=await identityVault.withInstagramPublishingAuthorization(
        input.accountId,configuredApp,credential=>publishInstagramReel({
          ...credential,mediaPath:input.mediaPath,caption:input.caption,approved:true,
          journalDir:path.join(app.getPath("userData"),"instagram-publish-journal")
        }));
      record("info","publish","Instagram Reel published",{mediaId:result.mediaId});
      return result;
    }catch(e){
      const safe=/^INSTAGRAM_PUBLISH_[A-Z0-9_]{1,90}$/.test(e?.message??"")?
        e.message:"INSTAGRAM_PUBLISH_UNEXPECTED_ERROR";
      record("warn","publish","Instagram publish not verified",{code:safe});
      throw Error(safe);
    }
  });
  ipcMain.handle("accounts:youtube-client-secret-status", () => {
    const id=store.getSettings().youtubeOauthClientId?.trim();
    return {configured:!!id && !!store.readSecret("GOOGLE_YOUTUBE_OAUTH_CLIENT_SECRET",id)};
  });
  ipcMain.handle("accounts:youtube-client-secret-save", (_event,value) => {
    const id=store.getSettings().youtubeOauthClientId?.trim();
    if(!/^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/.test(id??""))
      throw Error("YOUTUBE_OAUTH_CLIENT_ID_REQUIRED");
    if(typeof value!=="string"||value.length<8||value.length>512||/[\s\u0000-\u001f]/.test(value))
      throw Error("YOUTUBE_OAUTH_CLIENT_SECRET_INVALID");
    store.upsertSecret({name:"GOOGLE_YOUTUBE_OAUTH_CLIENT_SECRET",project:id,value});
    return {configured:true};
  });
  ipcMain.handle("accounts:youtube-connect", async (_event,id) => {
    const account=identityVault.get(id);
    if(!account||!["google","youtube"].includes(account.service.toLowerCase().trim()))
      throw Error("YOUTUBE_ACCOUNT_NOT_FOUND");
    const clientId=store.getSettings().youtubeOauthClientId?.trim();
    if(!clientId)throw Error("YOUTUBE_OAUTH_CLIENT_ID_REQUIRED");
    identityVault.noteYoutubeOauthAttempt(account.id);
    try {
      const result=await connectYoutubeBrowser({
        clientId,
        clientSecret:store.readSecret("GOOGLE_YOUTUBE_OAUTH_CLIENT_SECRET",clientId),
        expectedEmail:account.identifier,
        openExternal:async url=>shell.openExternal(url),
      });
      const saved=identityVault.saveYoutubeGrant(account.id,result,clientId);
      record("info","publish-oauth","YouTube channel connected by user authorization",{
        channelId:result.channelId,
      });
      return saved;
    }catch(error){
      // Preserve only fixed-format diagnostic codes, never OAuth response data.
      const raw=error instanceof Error?error.message:"";
      const safeCode=/^YOUTUBE_OAUTH_[A-Z0-9_]{1,80}$/.test(raw)
        ?raw:"YOUTUBE_OAUTH_CONNECTION_FAILED";
      identityVault.noteYoutubeOauthAttempt(account.id,safeCode);
      record("warn","publish-oauth","YouTube authorization incomplete",{code:safeCode});
      throw Error(safeCode);
    }
  });
  // Account passwords enter only via the local renderer and are stored with
  // Electron safeStorage; never exposed through the MCP or Cloud bridge.
  ipcMain.handle("mail:accounts",()=>mailService.accounts());
  ipcMain.handle("mail:connect",(_event,input)=>mailService.connect(input));
  ipcMain.handle("mail:disconnect",(_event,accountId)=>mailService.disconnect({accountId}));
  ipcMain.handle("accounts:list", () => identityVault.list());
  ipcMain.handle("accounts:upsert", (_event, input) => identityVault.upsert(input));
  ipcMain.handle("accounts:delete", (_event, id) => identityVault.delete(id));
  ipcMain.handle("accounts:status", (_event,id,status,options) => {
    const account=identityVault.get(id);
    if(status==="ready"&&["google","youtube","instagram"].includes(
      String(account?.service??"").toLowerCase().trim()))
      throw Error("OFFICIAL_OAUTH_VERIFICATION_REQUIRED");
    return identityVault.markStatus(id,status,options);
  });
  ipcMain.handle("accounts:capabilities", (_event, id) =>
    identityVault.capabilities(id));
  function verifiedDevPermissionStatus(){
    if(app.isPackaged||!devForceConnectivity)return null;
    const owner=readDevOwner();
    if(!ownerMatches(owner,path.join(__dirname,"..")))return null;
    const localRuntime=process.env.OWL_RUNTIME_DEV_URL?.trim()||"";
    if(!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(localRuntime))return null;
    const stateRoot=process.env.OWL_RUNTIME_DEV_STATE_ROOT?.trim()||
      path.join(os.homedir(),".owl-runtime-dev");
    const status=readDevRuntimePermissionStatus(devPermissionStatusFile(stateRoot));
    return status?.ownerPid===owner.pid?status:null;
  }
  function currentRuntimePermissionProjection(){
    const settings=store.getSettings();
    const windowsDevFlags=!app.isPackaged&&process.platform==="win32"?
      getWindowsDevAppliedPermissionFlags():null;
    if(windowsDevFlags){
      return {...runtimePermissionProjection(settings,"",{
        packaged:false,envOverride:windowsDevFlags,
        reviewSupportOverride:false,liveVerified:true
      }),source:"Managed Windows DEV Runtime"};
    }
    if(!app.isPackaged&&devForceConnectivity){
      const status=verifiedDevPermissionStatus();
      const envOverride=new Map(Object.entries(status?.flags??{}));
      const result=runtimePermissionProjection(settings,"",{
        packaged:false,envOverride,reviewSupportOverride:true,
        signedKeyConfiguredOverride:status?.reviewReady===true,
        liveVerified:status?.healthy===true
      });
      return {...result,source:"Isolated DEV Runtime",
       message:!status?"DEV_RUNTIME_POLICY_STATUS_UNAVAILABLE: actual running DEV configuration not yet verified":
       status.reason?"DEV_RUNTIME_POLICY_"+status.reason:
       result.restartRequired?"DEV_RUNTIME_POLICY_NOT_APPLIED: waiting for isolated Runtime restart":
       status.healthy?"DEV_RUNTIME_POLICY_APPLIED: isolated Runtime healthy":
       "DEV_RUNTIME_POLICY_RESTARTING"};
    }
    return runtimePermissionProjection(settings,path.join(os.homedir(),".owl","runtime.env"),{
      packaged:app.isPackaged,componentFile:path.join(os.homedir(),".owl","current","component.json")});
  }
  ipcMain.handle("runtime-permissions:get",()=>currentRuntimePermissionProjection());
  ipcMain.handle("runtime-permissions:set", async (_event,key,mode) => {
    validateRuntimePermissionChange(key,mode);
    assertSafePermissionCombination({
      ...store.getSettings().runtimePermissionModes,[key]:mode
    });
    if(mode==="review"&&app.isPackaged&&installedRuntimeSupportsSignedReview(path.join(os.homedir(),".owl","current","component.json"))!==true)
      throw new Error("REVIEW_UNAVAILABLE_INSTALLED_RUNTIME_LACKS_SIGNED_APPROVAL");
    if(mode==="review"&&!app.isPackaged&&!devForceConnectivity)
      throw new Error("REVIEW_REQUIRES_VERIFIED_MANAGED_RUNTIME");
    const changeCopy=runtimePermissionChangeCopy(mode);
    const {response}=await dialog.showMessageBox(mainWindow ?? undefined,{
      type:"warning",buttons:["Cancel",changeCopy.button],
      defaultId:0,cancelId:0,noLink:true,title:"OWL Runtime permission",
      message:changeCopy.message,detail:changeCopy.detail,
    });
    if(response===1){
      if(mode==="review")store.ensureHumanApprovalSigner();
      store.setRuntimePermission(key,mode);
      if(!app.isPackaged && process.platform==="win32" &&
         process.env.OWL_WIN_DEV_MANAGE_RUNTIME==="true"){
        const applied=await applyRuntimeUserPreferences(store.getSettings());
        record(applied.applied?"info":"warn","runtime",
          applied.applied?"Windows managed Runtime settings applied":"Windows managed Runtime settings not applied",
          {capability:key,mode,applied:applied.applied,reason:applied.reason});
      }else{
        record("info","runtime","Permission preference saved, requires Runtime restart",{capability:key,mode});
      }
    }
    return {...currentRuntimePermissionProjection(),changed:response===1};
  });
  ipcMain.handle("runtime-permissions:apply", async () => {
    if(!app.isPackaged){
      const owner=readDevOwner();
      if(!devForceConnectivity||!ownerMatches(owner,path.join(__dirname,"..")))
        return {applied:false,reason:"NOT_VERIFIED_OWNED_DEV_RUNTIME"};
      const {response}=await dialog.showMessageBox(mainWindow??undefined,{
        type:"warning",buttons:["Cancel","Apply to isolated DEV Runtime"],
        defaultId:0,cancelId:0,noLink:true,title:"Apply OWL Runtime permissions",
        message:"Restart only the managed development Runtime to apply these settings?",
        detail:"This briefly interrupts active DEV tasks. Production Runtime is untouched. No action is approved."
      });
      if(response!==1)return {applied:false,reason:"CANCELLED"};
      if(Object.values(store.getSettings().runtimePermissionModes||{}).includes("review"))
        store.ensureHumanApprovalSigner();
      // Only the authenticated dev:full owner receives the local reload signal.
      process.kill(owner.pid,"SIGHUP");
      for(let attempt=0;attempt<100;attempt++){
        await new Promise(resolve=>setTimeout(resolve,150));
        const status=verifiedDevPermissionStatus();
        const projection=currentRuntimePermissionProjection();
        if(status?.healthy===true&&!projection.restartRequired)
          return {applied:true,source:"Isolated DEV Runtime"};
      }
      return {applied:false,reason:"DEV_RUNTIME_APPLY_TIMEOUT"};
    }
    const bootstrap=createLocalRuntimeBootstrap(store.getSettings());
    if(!bootstrap)return {applied:false,reason:"NOT_DESKTOP_MANAGED_RUNTIME"};
    const {response}=await dialog.showMessageBox(mainWindow ?? undefined,{
      type:"warning",buttons:["Cancel","Apply and restart Runtime"],defaultId:0,cancelId:0,noLink:true,
      title:"Restart OWL Runtime",message:"Apply capability changes to the managed Runtime?",
      detail:"This briefly disconnects active sessions. Durable tasks are preserved. This does not approve any pending action.",
    });
    if(response!==1)return {applied:false,reason:"CANCELLED"};
    bootstrap.ensureEnvironment();
    await runtimeHostSupervisor().restartService();
    record("info","runtime","Permission settings applied through controlled Runtime restart");
    return {applied:true};
  });
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
      "connectivityMode" in (patch ?? {}) ||
      "tunnelEnabled" in (patch ?? {}) ||
      "tunnelAutoStart" in (patch ?? {}) ||
      "tunnelBinaryPath" in (patch ?? {}) ||
      "tunnelId" in (patch ?? {}) ||
      "mcpPort" in (patch ?? {})
    ) {
      if (next.connectivityMode === "managed_tunnel") {
        await reconcileManagedTunnel({ settings: next }).catch((error) => {
          record("warn", "managed-tunnel", "Managed Tunnel sync failed", {
            code: error?.code ?? error?.name ?? "ERROR",
            message: error instanceof Error ? error.message : String(error),
          });
        });
      } else if (
        next.connectivityMode === "custom_tunnel" &&
        next.tunnelEnabled &&
        next.tunnelAutoStart
      ) {
        await restartTunnel({
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
        await stopTunnel();
      }
    }
    if (
      "connectivityMode" in (patch ?? {}) ||
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
      await syncConnectionHostCloudMcp().catch((error) => {
        record("warn", "cloud-mcp", "Connection Host Cloud MCP sync failed", {
          code: error?.code ?? error?.name ?? "ERROR",
          message: error instanceof Error ? error.message : String(error),
        });
      });
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
      if (
        settings.connectivityMode === "custom_tunnel" &&
        settings.tunnelEnabled
      ) {
        await restartTunnel({
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
      await syncConnectionHostCloudMcp();
      if (settings.connectivityMode === "managed_tunnel") {
        await reconcileManagedTunnel({
          settings,
          forceRestart: true,
        }).catch((error) => {
          record("warn", "managed-tunnel", "Managed Tunnel credential refresh failed", {
            code: error?.code ?? error?.name ?? "ERROR",
          });
        });
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
      const settings = store.getSettings();
      if (settings.connectivityMode === "custom_tunnel") {
        await stopTunnel();
      }
    }
    if (existing?.name === "OWL_CLOUD_DEVICE_CREDENTIAL") {
      const settings = store.getSettings();
      await stopCloudBridge();
      await syncConnectionHostCloudMcp();
      if (settings.connectivityMode === "managed_tunnel") {
        await stopTunnel();
      }
    }
    return result;
  });
}

async function runConnectivityRecoveryOnly() {
  if (!externalConnectionHostEnabled) {
    throw new Error(
      "Connectivity recovery-only mode requires an external Connection Host.",
    );
  }

  store = new DesktopStore();
  const settings = store.getSettings();
  const client = new ConnectionHostClient({
    baseUrl: externalConnectionHostUrl,
    token: externalConnectionHostToken,
  });
  const result = { tunnel: null, cloudMcp: null, managedTunnel: null };

  if (settings.connectivityMode === "managed_tunnel") {
    const managed = await reconcileManagedTunnel({
      settings,
      client,
      mcpPort: settings.mcpPort,
      forceRestart: true,
    });
    result.tunnel = managed?.tunnel ?? null;
    result.managedTunnel = managed?.projection ?? null;
    console.log(
      `Managed Tunnel recovery ${
        managed?.projection?.managedTunnel?.available ? "applied" : "deferred"
      }: ${managed?.projection?.managedTunnel?.state ?? "unknown"}.`,
    );
  } else if (settings.connectivityMode === "custom_tunnel") {
    const plan = createTunnelRecoveryPlan({
      settings,
      apiKey: tunnelApiKey(),
      binaryPath:
        process.env.OWL_TUNNEL_BINARY?.trim() || effectiveTunnelBinary(settings),
      mcpUrl:
        process.env.OWL_MCP_URL?.trim() ||
        `http://127.0.0.1:${settings.mcpPort}/mcp`,
    });

    if (plan.action === "skip") {
      result.tunnel = plan;
      console.log(`Tunnel recovery skipped: ${plan.reason}.`);
    } else {
      const status = await client.startTunnel(plan.config);
      result.tunnel = status;
      console.log(
        `Tunnel recovery applied: ${status?.state ?? "unknown"}${
          status?.pid ? ` · PID ${status.pid}` : ""
        }.`,
      );
    }
  } else {
    await client.stopTunnel().catch(() => undefined);
    result.tunnel = {
      action: "skip",
      reason: "cloud_durable_mode",
    };
    console.log("Tunnel recovery skipped: Cloud Durable MCP mode.");
  }

  const deviceCredential = cloudDeviceCredential();
  if (
    settings.cloudEnabled === true &&
    settings.cloudBaseUrl?.trim() &&
    settings.cloudDeviceId?.trim() &&
    deviceCredential
  ) {
    const cloudMcp = await client.configureCloudMcp({
      baseUrl: settings.cloudBaseUrl.trim(),
      deviceId: settings.cloudDeviceId.trim(),
      deviceCredential,
      pollIntervalMs: settings.cloudPollIntervalMs,
    });
    result.cloudMcp = cloudMcp;
    console.log(`Cloud MCP recovery applied: ${cloudMcp?.state ?? "unknown"}.`);
  } else {
    result.cloudMcp = {
      action: "skip",
      reason: "cloud_device_enrollment_incomplete",
    };
    console.log("Cloud MCP recovery skipped: cloud device enrollment incomplete.");
  }

  return result;
}

async function runConnectivityHostOnly() {
  const connectivityStoreRoot =
    process.env.OWL_CONNECTIVITY_HOST_STORE_ROOT?.trim() ||
    canonicalDesktopRoot();
  store = new DesktopStore({ root: connectivityStoreRoot });
  const settings = store.getSettings();
  const controlToken = connectivityHostControlToken();
  if (!controlToken) {
    throw new Error(
      "Connectivity Host control token is missing. Open OWL LAB Desktop once to repair the background service.",
    );
  }

  const runtimeApiToken = runtimeToken();
  const localMcpToken = mcpToken();
  process.env.OWL_RUNTIME_URL = effectiveRuntimeBaseUrl(settings);
  if (runtimeApiToken) process.env.OWL_RUNTIME_API_TOKEN = runtimeApiToken;
  else delete process.env.OWL_RUNTIME_API_TOKEN;
  if (localMcpToken) process.env.OWL_MCP_API_TOKEN = localMcpToken;
  else delete process.env.OWL_MCP_API_TOKEN;
  process.env.OWL_MCP_PORT =
    process.env.OWL_MCP_PORT?.trim() || String(settings.mcpPort);
  process.env.OWL_CONNECTION_HOST_PORT =
    process.env.OWL_CONNECTION_HOST_PORT?.trim() || "8791";
  process.env.OWL_CONNECTION_HOST_CONTROL_TOKEN = controlToken;
  process.env.OWL_DESKTOP_CAPABILITY_BRIDGE_URL =
    `http://127.0.0.1:${desktopCapabilityBridgePort}`;
  process.env.OWL_DESKTOP_CAPABILITY_BRIDGE_TOKEN = controlToken;
  process.env.OWL_DESKTOP_USER_DATA_DIR =
    process.env.OWL_DESKTOP_USER_DATA_DIR?.trim() || connectivityStoreRoot;
  if (settings.sessionId) {
    process.env.OWL_DESKTOP_FALLBACK_OWNER_ID = settings.sessionId;
  } else {
    delete process.env.OWL_DESKTOP_FALLBACK_OWNER_ID;
  }

  await import("../connection-host/server.mjs");

  const client = new ConnectionHostClient({
    baseUrl: `http://127.0.0.1:${process.env.OWL_CONNECTION_HOST_PORT}`,
    token: controlToken,
  });

  let reconciling = false;
  const reconcile = async () => {
    if (reconciling) return;
    reconciling = true;
    try {
      const current = store.getSettings();
      const health = await client.health();

      if (current.connectivityMode === "managed_tunnel") {
        await reconcileManagedTunnel({
          settings: current,
          client,
          currentTunnel: health?.tunnel ?? null,
          mcpPort: Number(process.env.OWL_MCP_PORT),
        });
      } else {
        const wantsTunnel =
          current.connectivityMode === "custom_tunnel" &&
          current.tunnelEnabled === true &&
          current.tunnelAutoStart === true &&
          Boolean(current.tunnelId?.trim()) &&
          Boolean(tunnelApiKey());
        if (wantsTunnel) {
          if (!["running", "restarting"].includes(health?.tunnel?.state)) {
            await client.startTunnel({
              binaryPath: effectiveTunnelBinary(current),
              tunnelId: current.tunnelId,
              apiKey: tunnelApiKey(),
              mcpUrl: `http://127.0.0.1:${process.env.OWL_MCP_PORT}/mcp`,
            });
          }
        } else if (
          health?.tunnel?.state !== "stopped" ||
          health?.tunnel?.desiredRunning === true
        ) {
          await client.stopTunnel();
        }
      }

      const deviceCredential = cloudDeviceCredential();
      const wantsCloudMcp =
        current.cloudEnabled === true &&
        Boolean(current.cloudBaseUrl?.trim()) &&
        Boolean(current.cloudDeviceId?.trim()) &&
        Boolean(deviceCredential);
      const cloudConfig = health?.cloudMcp?.config ?? null;
      const cloudConsumer = health?.cloudMcp?.consumer ?? null;
      const cloudConfigMatches =
        cloudConfig?.baseUrl === current.cloudBaseUrl?.trim() &&
        cloudConfig?.deviceId === current.cloudDeviceId?.trim();

      if (wantsCloudMcp) {
        if (
          health?.cloudMcp?.configured !== true ||
          !cloudConfigMatches ||
          cloudConsumer?.running !== true
        ) {
          await client.configureCloudMcp({
            baseUrl: current.cloudBaseUrl.trim(),
            deviceId: current.cloudDeviceId.trim(),
            deviceCredential,
            pollIntervalMs: current.cloudPollIntervalMs,
          });
        }
      } else if (health?.cloudMcp?.configured === true) {
        await client.stopCloudMcp();
      }
    } catch (error) {
      console.warn(
        `Connectivity Host reconciliation failed: ${
          error?.code ?? error?.name ?? "ERROR"
        }`,
      );
    } finally {
      reconciling = false;
    }
  };

  await reconcile();
  const reconciliationTimer = setInterval(() => {
    void reconcile();
  }, 15_000);
  reconciliationTimer.unref?.();

  const wakeRecovery = createConnectivityWakeRecovery({
    reconcile: async () => {
      let recheckError = null;
      try {
        await client.wakeRecheck({ timeoutMs: 45_000 });
      } catch (error) {
        recheckError = error;
      }
      await reconcile();
      if (recheckError) throw recheckError;
    },
    onEvent(level, message, meta) {
      const payload = JSON.stringify({
        level,
        source: "wake-recovery",
        message,
        ...meta,
      });
      if (level === "warn") console.warn(payload);
      else console.log(payload);
    },
  });
  const onResume = () => {
    void wakeRecovery.trigger("power_resume");
  };
  powerMonitor.on("resume", onResume);
  app.once("before-quit", () => {
    powerMonitor.removeListener("resume", onResume);
  });

  console.log(
    JSON.stringify({
      ok: true,
      service: "owl-connectivity-host",
      pid: process.pid,
      controlUrl: `http://127.0.0.1:${process.env.OWL_CONNECTION_HOST_PORT}`,
      mcpPort: Number(process.env.OWL_MCP_PORT),
      secretSource: "electron-safeStorage",
      secretsPrinted: false,
    }),
  );
}

async function runCloudMcpLiveProbeOnly() {
  const canonicalDesktopRoot = path.join(
    app.getPath("appData"),
    "OWL LAB",
    "desktop",
  );
  store = new DesktopStore({ root: canonicalDesktopRoot });
  const settings = store.getSettings();
  const refreshToken = store.readSecret(
    "OWL_CLOUD_ACCOUNT_REFRESH_TOKEN",
    "owl-cloud",
  );
  const deviceCredential = cloudDeviceCredential();
  if (!settings.cloudBaseUrl?.trim()) {
    throw new Error("OWL Cloud base URL is not configured.");
  }
  if (!settings.cloudDeviceId?.trim()) {
    throw new Error("OWL Cloud device ID is not configured.");
  }
  if (!refreshToken) {
    throw new Error("OWL Cloud account refresh token is unavailable.");
  }
  if (!deviceCredential) {
    throw new Error("OWL Cloud device credential is unavailable.");
  }

  const authClient = new CloudHttpClient({
    baseUrl: settings.cloudBaseUrl,
  });
  const auth = new CloudAccountAuth({ cloudClient: authClient });
  const tokens = await auth.refresh(refreshToken);

  const [
    { CloudMcpCallConsumer },
    { LocalMcpExecutor },
  ] = await Promise.all([
    import("../connection-host/cloud-mcp-call-consumer.mjs"),
    import("../connection-host/local-mcp-executor.mjs"),
  ]);

  const executor = new LocalMcpExecutor({
    mcpUrl: `http://127.0.0.1:${settings.mcpPort}/mcp`,
    mcpToken: mcpToken(),
  });
  const consumer = new CloudMcpCallConsumer({
    cloudClient: new CloudHttpClient({
      baseUrl: settings.cloudBaseUrl,
      deviceCredential,
    }),
    executor,
    pollIntervalMs: 250,
    leaseMs: 10_000,
  });

  let sessionId = null;
  const gateway = async (request) => {
    const response = await fetch(
      `${settings.cloudBaseUrl.replace(/\/$/, "")}/mcp`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokens.idToken}`,
          "content-type": "application/json",
          accept: "application/json",
          ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        },
        body: JSON.stringify(request),
      },
    );
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(
        `Cloud MCP HTTP ${response.status}: ${
          payload?.message ?? payload?.error?.message ?? "request failed"
        }`,
      );
    }
    sessionId = response.headers.get("mcp-session-id") || sessionId;
    return payload;
  };

  try {
    const consumerReady = await consumer.start();
    if (consumerReady?.ready !== true) {
      throw new Error("Cloud MCP consumer did not prove readiness.");
    }

    await gateway({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "owl-live-parity-probe", version: "1.0" },
      },
    });
    if (!sessionId) {
      throw new Error("Cloud MCP initialize returned no session identity.");
    }

    const invoked = await gateway({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "owl_call",
        arguments: {
          deviceId: settings.cloudDeviceId,
          toolName: "runtime_info",
          arguments: {},
          waitMs: 15_000,
        },
      },
    });

    const result = invoked?.result;
    const callId =
      result?._meta?.owlCallId ??
      result?.structuredContent?.callId ??
      null;
    if (!callId) {
      throw new Error("Cloud MCP result returned no durable call identity.");
    }
    if (result?.isError === true) {
      throw new Error("Cloud MCP runtime_info completed with an MCP error.");
    }
    if (result?.structuredContent?.pending === true) {
      throw new Error("Cloud MCP runtime_info remained pending after live wait.");
    }

    const runtimeText = Array.isArray(result?.content)
      ? result.content.find(
          (item) => item && item.type === "text" && typeof item.text === "string",
        )?.text
      : null;
    let runtimeInfo = null;
    try {
      runtimeInfo = runtimeText ? JSON.parse(runtimeText) : null;
    } catch {}
    if (
      runtimeInfo?.apiVersion !== "0.1" ||
      typeof runtimeInfo?.runtimeVersion !== "string" ||
      !runtimeInfo.runtimeVersion
    ) {
      throw new Error("Cloud MCP runtime_info did not return Runtime contract evidence.");
    }

    const failedInvocation = await gateway({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "owl_call",
        arguments: {
          deviceId: settings.cloudDeviceId,
          toolName: "__owl_e2e_missing_tool__",
          arguments: {},
          waitMs: 15_000,
        },
      },
    });
    const failedResult = failedInvocation?.result;
    const failedCallId =
      failedResult?._meta?.owlCallId ??
      failedResult?.structuredContent?.callId ??
      null;
    if (!failedCallId || failedResult?.isError !== true) {
      throw new Error(
        "Cloud MCP did not preserve a local MCP tool failure as a failed durable call.",
      );
    }

    await consumer.stop();
    const offlineRequest = {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "owl_call",
        arguments: {
          deviceId: settings.cloudDeviceId,
          toolName: "runtime_info",
          arguments: {},
          waitMs: 0,
        },
      },
    };
    const queuedWhileOffline = await gateway(offlineRequest);
    const retriedWhileOffline = await gateway(offlineRequest);
    const offlineCallId =
      queuedWhileOffline?.result?._meta?.owlCallId ??
      queuedWhileOffline?.result?.structuredContent?.callId ??
      null;
    const retryCallId =
      retriedWhileOffline?.result?._meta?.owlCallId ??
      retriedWhileOffline?.result?.structuredContent?.callId ??
      null;
    if (
      !offlineCallId ||
      offlineCallId !== retryCallId ||
      queuedWhileOffline?.result?.structuredContent?.pending !== true
    ) {
      throw new Error(
        "Cloud MCP offline queue did not preserve one durable retry identity.",
      );
    }

    await consumer.start();
    const resumed = await gateway({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "owl_call_status",
        arguments: {
          callId: offlineCallId,
          waitMs: 15_000,
        },
      },
    });
    if (
      resumed?.result?._meta?.owlCallId !== offlineCallId ||
      resumed?.result?.isError === true ||
      resumed?.result?.structuredContent?.pending === true
    ) {
      throw new Error(
        "Cloud MCP queued call did not resume through the same durable call identity.",
      );
    }

    const snapshot = consumer.snapshot();
    if ((snapshot?.processed ?? 0) < 2) {
      throw new Error("Cloud MCP consumer did not record both successful calls.");
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          gateway: "frankfurt",
          durableCall: "completed",
          callId,
          consumerReady: snapshot.ready === true,
          processed: snapshot.processed,
          runtimeEvidence: true,
          runtimeVersion: runtimeInfo.runtimeVersion,
          runtimeApiVersion: runtimeInfo.apiVersion,
          failureObserved: true,
          failedCallId,
          offlineQueueRecovered: true,
          offlineCallId,
          retryIdentityPreserved: offlineCallId === retryCallId,
          secretsPrinted: false,
        },
        null,
        2,
      ),
    );
    return { ok: true, callId };
  } finally {
    await consumer.stop().catch(() => undefined);
  }
}

const hasLock =
  connectivityRecoveryOnly ||
  cloudMcpLiveProbeOnly ||
  packagedConnectivityHostLiveProbeOnly ||
  packagedConnectivityHostSoakOnly ||
  connectivityHostOnly
    ? true
    : app.requestSingleInstanceLock();

if (packagedConnectivityHostSoakOnly) {
  const soakProfileRoot = path.join(
    os.tmpdir(),
    `owl-packaged-connectivity-soak-profile-${process.pid}`,
  );
  app.setPath("userData", soakProfileRoot);
  app.setPath("sessionData", path.join(soakProfileRoot, "session"));
  app
    .whenReady()
    .then(async () => {
      app.dock?.hide();
      const { runPackagedConnectivityHostSoak } = await import(
        "../scripts/verify-packaged-connectivity-host-soak.mjs"
      );
      await runPackagedConnectivityHostSoak();
      app.exit(0);
    })
    .catch((error) => {
      console.error(
        `Packaged Connectivity Host soak failed: ${
          error instanceof Error ? error.stack || error.message : String(error)
        }`,
      );
      app.exit(1);
    });
} else if (packagedConnectivityHostLiveProbeOnly) {
  const probeProfileRoot = path.join(
    os.tmpdir(),
    `owl-packaged-connectivity-live-profile-${process.pid}`,
  );
  app.setPath("userData", probeProfileRoot);
  app.setPath("sessionData", path.join(probeProfileRoot, "session"));
  app
    .whenReady()
    .then(async () => {
      app.dock?.hide();
      const { runPackagedConnectivityHostLiveGate } = await import(
        "../scripts/verify-packaged-connectivity-host-live.mjs"
      );
      await runPackagedConnectivityHostLiveGate();
      app.exit(0);
    })
    .catch((error) => {
      console.error(
        `Packaged Connectivity Host live gate failed: ${
          error instanceof Error ? error.stack || error.message : String(error)
        }`,
      );
      app.exit(1);
    });
} else if (connectivityHostOnly) {
  const hostProfileRoot = path.join(
    os.tmpdir(),
    `owl-connectivity-host-profile-${process.pid}`,
  );
  app.setPath("userData", hostProfileRoot);
  app.setPath("sessionData", path.join(hostProfileRoot, "session"));
  app
    .whenReady()
    .then(async () => {
      app.dock?.hide();
      await runConnectivityHostOnly();
    })
    .catch((error) => {
      console.error(
        `Connectivity Host startup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      app.exit(1);
    });
} else if (cloudMcpLiveProbeOnly) {
  const probeProfileRoot = path.join(
    os.tmpdir(),
    `owl-cloud-mcp-live-profile-${process.pid}`,
  );
  app.setPath("userData", probeProfileRoot);
  app.setPath("sessionData", path.join(probeProfileRoot, "session"));
  app
    .whenReady()
    .then(async () => {
      await runCloudMcpLiveProbeOnly();
      app.exit(0);
    })
    .catch((error) => {
      console.error(
        `Cloud MCP live probe failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      app.exit(1);
    });
} else if (connectivityRecoveryOnly) {
  storageLayout = configureOwlDesktopStorage(app);
  app
    .whenReady()
    .then(async () => {
      await runConnectivityRecoveryOnly();
      app.exit(0);
    })
    .catch((error) => {
      console.error(
        `Connectivity recovery failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      app.exit(1);
    });
} else if (!hasLock) {
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

  app.on("before-quit",stopWindowsDevRuntime);
  app.whenReady().then(async () => {
    usageStatistics = new UsageStatisticsStore({ file: path.join(app.getPath("userData"), "usage-statistics-v1.json") });
    for (const entry of [...activity].reverse()) usageStatistics.ingest(entry);
    store = new DesktopStore();
    mailService = new OwlMailService({
      file:path.join(app.getPath("userData"),"mail-accounts.json"),
      store,
      approveSend:async({from,to,cc,subject,preview,attachments=[]})=>{
        if(!mainWindow||mainWindow.isDestroyed())return false;
        const reply=await dialog.showMessageBox(mainWindow,{
          type:"question",title:"Approve email send",buttons:["Cancel","Send email"],
          defaultId:0,cancelId:0,noLink:true,
          message:"Send this email from "+from+"?",
          detail:"To: "+to.join(", ")+"\n"+
            (cc.length?"CC: "+cc.join(", ")+"\n":"")+
            "Subject: "+subject+"\n"+(attachments.length?"Attachments ("+attachments.length+"): "+attachments.map(a=>a.name+" ("+a.size+" B)").join(", ")+"\n":"")+"\nMessage preview:\n"+preview,
        });
        return reply.response===1;
      },
    });
    // Windows development only. Production uses the signed Runtime Host
    // lifecycle and never starts a runtime from a developer path.
    if (!app.isPackaged) {
      await startWindowsDevRuntime({
        store,
        baseUrl: store.getSettings().runtimeBaseUrl
      });
    }
    if (app.isPackaged) {
      const token = connectivityHostControlToken({ create: true });
      setExternalConnectionHost({
        baseUrl: "http://127.0.0.1:8791",
        token,
      });
    } else if (externalConnectionHostEnabled) {
      setExternalConnectionHost({
        baseUrl: externalConnectionHostUrl,
        token: externalConnectionHostToken,
      });
    }
    identityVault = new IdentityVault();
    cloudBridgeStore = new CloudBridgeStore({
      file: path.join(app.getPath("userData"), "cloud-bridge-state.json"),
    });
    remoteSubmissionStore = new RemoteSubmissionStore({
      file: path.join(app.getPath("userData"), "remote-submissions.json"),
    });
    if (externalConnectionHostEnabled) {
      plannerContinuationStore = null;
    } else {
      plannerContinuationStore = new PlannerContinuationStore({
        file: path.join(app.getPath("userData"), "planner-continuation.json"),
      });
      plannerContinuationStore.recoverConnectedTransports("desktop_restart");
    }
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
    if (externalConnectionHostEnabled) {
      desktopCapabilityBridge = await startDesktopCapabilityBridge({
        port: desktopCapabilityBridgePort,
        token: externalConnectionHostToken,
        agentInbox,
        remoteDeviceControl,
        mailService,
        providerOperations:providerOperations(),
        onEvent(level, message, meta) {
          record(level, "connection-host", message, meta);
        },
      });
      await refreshConnectionHost().catch((error) => {
        record("info", "connection-host", "Background Connectivity Host is not ready yet", {
          code: error?.code ?? error?.name ?? "ERROR",
        });
      });
      await syncConnectionHostCloudMcp().catch((error) => {
        record("warn", "cloud-mcp", "Initial Connection Host Cloud MCP sync failed", {
          code: error?.code ?? error?.name ?? "ERROR",
        });
      });
    } else {
      tunnelSupervisor = new TunnelSupervisor({
        onEvent(level, message, meta) {
          record(level, "tunnel", message, meta);
        },
      });
    }
    registerIpc();
    record("info", "desktop", "OWL Desktop started", { version: app.getVersion() });
    const settings = store.getSettings();
    connectivityJournal=createConnectivityIncidentJournal({file:path.join(app.getPath("userData"),"connectivity-incidents.json")});
    createWindow();
    // Runtime approvals can arrive while OWL Desktop is in the background.
    // Never reveal paths or command arguments in OS notification previews.
    const pollApprovalNotifications=async()=>{
      if(!mainWindow||mainWindow.isDestroyed())return;
      try{
        const response=await runtimeClient().approvals();
        const rows=Array.isArray(response)?response:
          Array.isArray(response?.approvals)?response.approvals:
          Array.isArray(response?.result?.approvals)?response.result.approvals:[];
        const active=new Set();
        for(const row of rows){
          if(row?.state!=="pending"||typeof row.id!=="string")continue;
          active.add(row.id);
          if(announcedApprovalIds.has(row.id))continue;
          announcedApprovalIds.add(row.id);
          if(mainWindow.isFocused()||!Notification.isSupported())continue;
          const notice=new Notification({
            title:"OWL LAB · Action approval required",
            body:"A protected action is waiting. Open OWL LAB to review its exact target."
          });
          notice.on("click",()=>{
            if(mainWindow&&!mainWindow.isDestroyed()){mainWindow.show();mainWindow.focus();}
          });
          notice.show();
        }
        for(const id of announcedApprovalIds)if(!active.has(id))announcedApprovalIds.delete(id);
      }catch{/* Transport failures never approve protected actions. */}
    };
    approvalNotificationTimer=setInterval(()=>void pollApprovalNotifications(),5000);
    approvalNotificationTimer.unref?.();
    void pollApprovalNotifications();
    // Poll connection health independently from the renderer and from approval
    // requests. A hidden Desktop still informs the user once per incident.
    let connectivityPollInFlight=false;
    const pollConnectivityNotifications=async()=>{
      if(connectivityPollInFlight)return;
      connectivityPollInFlight=true;
      try{
        const prefs=store.getSettings();
        const enabled=prefs.connectivityMode==="managed_tunnel"||
          (prefs.connectivityMode==="custom_tunnel"&&prefs.tunnelEnabled===true);
        const tunnel=enabled?await tunnelStatus().catch(()=>({state:"unavailable"})):null;
        // A cheap OS-only interface check catches local link loss promptly,
        // even before a stale Tunnel health proof expires.
        const interfaceState=enabled?readLocalNetworkLink():"unknown";
        const freshNetworkEvidence=interfaceState==="missing"?
          {link:"missing",dns:"skipped",internet:"skipped"}:
          connectivityNetworkEvidence;
        let state=connectivityTracker.sample({enabled,tunnel,
          network:freshNetworkEvidence,official:connectivityOfficialEvidence});
        const change=state.event;
        // Investigate only sustained incidents, at most once per 60s.
        // Never send credentials or network identifiers to probe endpoints.
        let sampledNewEvidence=false;
        if(state.active&&prefs.diagnosticsEnabled===true&&Date.now()-connectivityProbeAt>60_000){
          connectivityProbeAt=Date.now();
          connectivityNetworkEvidence=await probeLocalNetwork();
          connectivityOfficialEvidence=connectivityNetworkEvidence.internet==="reachable"?
            await probeOpenAiIncidents({at:Date.now(),since:Date.parse(state.incidentSince??"")||Date.now()}):
            {state:"unknown",overlap:false};
          state=connectivityTracker.sample({enabled,tunnel,
            network:connectivityNetworkEvidence,official:connectivityOfficialEvidence});
          sampledNewEvidence=true;
        }
        connectivityIncidentState={...state,event:change};
        const recordEvidence=(kind)=>connectivityJournal?.record({
          kind,at:new Date().toISOString(),
          layer:state.layer,link:connectivityNetworkEvidence?.link,
          dns:connectivityNetworkEvidence?.dns,internet:connectivityNetworkEvidence?.internet,
          tunnel:tunnel?.reachability?.state??"unknown",
          officialStatus:connectivityOfficialEvidence?.state,
          officialOverlap:connectivityOfficialEvidence?.overlap,
          officialImpact:connectivityOfficialEvidence?.impact,
          durationMs:kind==="recovered"&&connectivityIncidentStartedAt?
            Math.max(0,Date.now()-Date.parse(connectivityIncidentStartedAt)):null
        });
        if(change==="degraded"){
          connectivityIncidentStartedAt=state.incidentSince;
          connectivityRecordedLayer=state.layer;
          recordEvidence("degraded");
        }else if(change==="recovered"){
          recordEvidence("recovered");
          connectivityNetworkEvidence=null;
          connectivityOfficialEvidence=null;
          connectivityProbeAt=0;
          connectivityRecordedLayer=null;
          connectivityIncidentStartedAt=null;
        }else if(state.phase==="disabled"){
          connectivityNetworkEvidence=null;
          connectivityOfficialEvidence=null;
          connectivityProbeAt=0;
          connectivityRecordedLayer=null;
          connectivityIncidentStartedAt=null;
        }else if(sampledNewEvidence&&state.active&&state.layer!==connectivityRecordedLayer){
          connectivityRecordedLayer=state.layer;
          recordEvidence("evidence");
        }
        if(!change)return;
        record(change==="degraded"?"warn":"info","tunnel",
          change==="degraded"?"Remote Tunnel reachability degraded":"Remote Tunnel reachability recovered",{
            code:change==="degraded"?"TUNNEL_REACHABILITY_DEGRADED":"TUNNEL_REACHABILITY_RECOVERED"
          });
        if(mainWindow?.isDestroyed()!==false||mainWindow.isFocused()||!Notification.isSupported())return;
        const notice=new Notification({
          title:change==="degraded"?"OWL LAB · Remote connection unstable":"OWL LAB · Remote connection recovered",
          body:change==="degraded"?
            state.layer==="device_network"?"Local network interface unavailable. Check Wi-Fi/Ethernet; local work may continue.":
            state.layer==="dns"?"Device DNS lookup failed. Check router/DNS settings; local work may continue.":
            state.layer==="internet_path"?"Independent internet check failed. Check local router/ISP; cause not confirmed.":
            state.layer==="control_plane"?"Local Tunnel ready but remote control plane degraded. Cause not confirmed.":
            "Remote tasks may be delayed. Cause unknown; local work may continue. Open OWL LAB to check status.":
            "Remote reachability is verified again. Check task results in OWL LAB."
        });
        notice.on("click",()=>{
          if(mainWindow&&!mainWindow.isDestroyed()){mainWindow.show();mainWindow.focus();}
        });
        notice.show();
      }catch{/* Connectivity diagnostics must not interrupt Runtime or Desktop. */}
      finally{connectivityPollInFlight=false;}
    };
    connectivityNotificationTimer=setInterval(()=>void pollConnectivityNotifications(),5000);
    connectivityNotificationTimer.unref?.();
    void pollConnectivityNotifications();
    await ensurePackagedLocalRuntime(settings);
    await ensurePackagedConnectivityHost().catch((error) => {
      record("error", "connectivity-host-service", "Background Connectivity Host bootstrap failed", {
        code: error?.code ?? "CONNECTIVITY_HOST_BOOTSTRAP_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    });
    if (externalConnectionHostEnabled) {
      if (!desktopCapabilityBridge) {
        desktopCapabilityBridge = await startDesktopCapabilityBridge({
          port: desktopCapabilityBridgePort,
          token: externalConnectionHostToken,
          agentInbox,
          remoteDeviceControl,
          mailService,
          providerOperations:providerOperations(),
          onEvent(level, message, meta) {
            record(level, "connection-host", message, meta);
          },
        });
      }
      await refreshConnectionHost().catch(() => null);
      await syncConnectionHostCloudMcp().catch(() => null);
    }
    if (settings.cloudBaseUrl?.trim()) {
      await resumeCloudAccountSession();
    }
    if (pendingCloudAuthCallbackUrl) {
      const callbackUrl = pendingCloudAuthCallbackUrl;
      pendingCloudAuthCallbackUrl = null;
      await completeCloudAccountLogin(callbackUrl).catch(() => undefined);
    }
    startRuntimeLeaseMaintenance();
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
      (settings.connectivityMode === "custom_tunnel" &&
        settings.tunnelEnabled &&
        settings.tunnelAutoStart)
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
      if (settings.connectivityMode === "managed_tunnel") {
        await reconcileManagedTunnel({ settings }).catch((error) => {
          record("warn", "managed-tunnel", "Managed Tunnel startup reconciliation failed", {
            code: error?.code ?? error?.name ?? "ERROR",
          });
        });
      }
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", () => {
    if(connectivityNotificationTimer)clearInterval(connectivityNotificationTimer);
    if(approvalNotificationTimer)clearInterval(approvalNotificationTimer);
    usageStatistics?.flush();
    void devAuthCallbackServer?.stop();
    void cloudBridge?.stop();
    runtimeAgentRequestEventBridge?.stop();
    void desktopCapabilityBridge?.close();
    if (!externalConnectionHostEnabled) {
      void tunnelSupervisor?.stop();
      void stopMcp();
      void windowsDevBrowser?.close();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
