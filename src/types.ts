export type Settings = {
  runtimeBaseUrl: string;
  autoConnectRuntime: boolean;
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

export type ActivityEntry = {
  id: string;
  at: string;
  level: "info" | "warn" | "error" | string;
  source: string;
  message: string;
  meta?: Record<string, unknown>;
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
  activity: ActivityEntry[];
};

export type DesktopEnvironment = {
  appVersion: string;
  platform: string;
  arch: string;
  electronVersion: string;
};
