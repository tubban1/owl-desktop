export type Settings = {
  runtimeBaseUrl: string;
  autoConnectRuntime: boolean;
  mcpEnabled: boolean;
  mcpPort: number;
  tunnelEnabled: boolean;
  tunnelAutoStart: boolean;
  tunnelBinaryPath: string;
  tunnelId: string;
  cloudEnabled: boolean;
  cloudAutoStart: boolean;
  cloudBaseUrl: string;
  cloudDeviceId: string;
  cloudPollIntervalMs: number;
  cloudPresenceIntervalMs: number;
  cloudTelemetryEnabled: boolean;
  launchAtLogin: boolean;
  diagnosticsEnabled: boolean;
  sessionId: string;
};

export type SecretMeta = {
  id: string;
  name: string;
  project: string;
  createdAt: string;
  updatedAt: string;
};

export type AccountMeta = {
  id: string;
  service: string;
  label: string;
  identifier: string;
  authMethod:
    | "password"
    | "oauth"
    | "third_party_oauth"
    | "qr"
    | "sms_otp"
    | "email_otp"
    | "totp"
    | "authenticator_push"
    | "passkey"
    | "device_code"
    | "native_app_session";
  status: string;
  browserProfileId: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  lastAuthenticatedAt: string | null;
  expiresAt: string | null;
};

export type ActivityEntry = {
  id: string;
  at: string;
  level: "info" | "warn" | "error" | string;
  source: string;
  message: string;
  meta?: Record<string, unknown>;
};

export type HostStatus = {
  host: {
    installed: boolean;
    path: string;
    bundleIdentifier: string | null;
    version: string | null;
    error?: string;
  };
  service: {
    loaded: boolean;
    state: string;
    pid: number | null;
  };
  runtime: {
    reachable: boolean;
    apiVersion?: string | null;
    runtimeVersion?: string | null;
    status?: number;
    error?: string;
  };
  authority: "owl-runtime";
  desktopRole: "lifecycle-consumer";
};

export type TunnelStatus = {
  state: "running" | "stopped";
  pid?: number | null;
  startedAt?: string | null;
  lastExit?: { at: string; code: number | null; signal: string | null } | null;
  binaryPath?: string | null;
  tunnelIdConfigured?: boolean;
  mcpUrl?: string | null;
  secretStorage?: string;
};



export type CloudBridgeCommandRecord = {
  commandId: string;
  deviceId: string;
  kind: string;
  digest: string;
  status: "processing" | "accepted" | "rejected" | "uncertain";
  receivedAt: string;
  updatedAt: string;
  runtimeTaskId: string | null;
  runtimeRunId: string | null;
  rejectionReason: string | null;
  lastErrorCode: string | null;
};

export type CloudBridgeStatus = {
  status:
    | "stopped"
    | "starting"
    | "connected"
    | "degraded"
    | "needs_configuration"
    | "needs_enrollment"
    | "error";
  running: boolean;
  configured: boolean;
  baseUrl: string;
  deviceId: string | null;
  lastHeartbeatAt?: string | null;
  lastPollAt?: string | null;
  lastCloudContactAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorAt?: string | null;
  recoveredUncertain?: number;
  supportedCommandKinds?: string[];
  commandCounts: {
    processing: number;
    accepted: number;
    rejected: number;
    uncertain: number;
  };
  outboxPending: number;
  commands: CloudBridgeCommandRecord[];
};

export type RuntimeSnapshot = {
  mode: "live" | "offline";
  checkedAt: string;
  latencyMs: number;
  info: null | { apiVersion?: string; runtimeVersion?: string; transport?: string };
  health: unknown;
  tasks: unknown;
  approvals: unknown;
  processes: unknown;
  diagnostics: unknown;
  error: string | null;
  metrics: { tasks: number; approvals: number; processes: number };
  mcp: {
    status: "stopped" | "starting" | "running" | "error";
    url: string | null;
    error: string | null;
    sessionCount: number;
    sessions: Array<{
      transportSessionId: string;
      runtimeSessionId: string | null;
      ownerStable: boolean;
      ownerSource: string;
      createdAt: string;
      lastSeenAt: string;
    }>;
  };
  host: HostStatus | null;
  tunnel: TunnelStatus;
  cloud: CloudBridgeStatus;
  accounts: AccountMeta[];
  activity: ActivityEntry[];
};

export type DesktopEnvironment = {
  appVersion: string;
  platform: string;
  arch: string;
  electronVersion: string;
};

export type SkillAvailability =
  | "ready"
  | "disabled"
  | "needs_attention"
  | "incompatible"
  | "missing_capability"
  | "missing_permission"
  | "integrity_failed";

export type SkillSource =
  | "builtin"
  | "user"
  | "distilled"
  | "team"
  | "cloud_library";

export type SkillSummary = {
  id: string;
  title: string;
  domain: string;
  description: string;
  version: string;
  source: SkillSource;
  scope: string;
  enabled: boolean;
  availability: SkillAvailability;
  availabilityReasons: string[];
  executionMode: "inline" | "durable" | string;
  requiredPrimitiveAbi: number | null;
  requiredPrimitives: string[];
  memoryPolicy: Record<string, unknown> | null;
  riskLevel: "low" | "medium" | "high" | "critical" | string;
  idempotent: boolean;
  sideEffects: string[];
  requiresVerification: boolean;
  retryPolicy: string;
  resources: unknown[];
  inputs: Record<string, string>;
  lifecycle: {
    canInstall: boolean;
    canEnableDisable: boolean;
    canUpdate: boolean;
    canRollback: boolean;
    canUninstall: boolean;
    reason: string;
  };
};

export type SkillProviderStatus = {
  id: string;
  label: string;
  enabled: boolean;
  available: boolean;
  capabilities: string[];
  executionTargets: string[];
  details: unknown;
};

export type SkillManagerSnapshot = {
  source: "runtime-1.0";
  fetchedAt: string;
  primitiveAbiVersion: number;
  skills: SkillSummary[];
  primitives: Array<Record<string, unknown> & { id?: string }>;
  providers: SkillProviderStatus[];
  summary: {
    installed: number;
    ready: number;
    needsAttention: number;
    disabled: number;
    candidates: number;
    updates: number;
  };
  lifecycle: {
    registrySupported: boolean;
    candidatesSupported: boolean;
    librarySupported: boolean;
    reason: string;
  };
};

export type SkillRunResult = unknown;
