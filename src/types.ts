export type Settings = {
  runtimeBaseUrl: string;
  autoConnectRuntime: boolean;
  mcpEnabled: boolean;
  mcpPort: number;
  tunnelEnabled: boolean;
  tunnelAutoStart: boolean;
  tunnelBinaryPath: string;
  tunnelId: string;
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
  accounts: AccountMeta[];
  activity: ActivityEntry[];
};

export type DesktopEnvironment = {
  appVersion: string;
  platform: string;
  arch: string;
  electronVersion: string;
};
