export type Settings = {
  wakeName: string;
  wakeAliases: string[];
  allowedDirectories: string[];
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



export type RuntimeAccessState = {
  schemaVersion: 1;
  mode: "compat" | "enforced";
  state: "LOCKED" | "READY" | "REVOKED";
  updatedAt: string;
  reasonCode: string | null;
  grant: null | {
    grantId: string;
    deviceId: string;
    organizationId: string | null;
    principalId: string | null;
    issuedAt: string;
    expiresAt: string;
    evidenceDigest: string;
    source?: "cloud-signed-lease" | "legacy-desktop-projection";
    cloudLeaseId?: string;
    entitlementPlan?: string;
    entitlementStatus?: string;
    entitlementVersion?: number;
    features?: Record<string, boolean>;
    limits?: Record<string, number>;
    signatureVerified?: boolean;
  };
};

export type CloudEntitlement = {
  entitlementId: string;
  userId: string;
  organizationId: string;
  plan: "trial" | "credit" | "pro" | "business";
  status:
    | "trial_active"
    | "active"
    | "trial_expired"
    | "payment_required"
    | "suspended";
  canRun: boolean;
  trialStartedAt: string;
  trialEndsAt: string;
  trialExtensionDays: number;
  subscriptionEndsAt: string | null;
  suspendedAt: string | null;
  walletBalanceMinor: number;
  currency: "CHF";
  version: number;
  updatedAt: string;
  features: Record<string, boolean>;
  limits: {
    devices: number;
    concurrentTasks: number;
    cloudWorkerMinutes: number;
    storageMb: number;
  };
};

export type CloudAccountStatus = {
  status:
    | "signed_out"
    | "authorizing"
    | "ready"
    | "device_enrolled"
    | "needs_login"
    | "error";
  account: null | Record<string, unknown>;
  access: null | {
    deviceId?: string;
    organizationId?: string;
    role?: string;
    canView?: boolean;
    canRun?: boolean;
    canSchedule?: boolean;
    canApprove?: boolean;
  };
  entitlement: CloudEntitlement | null;
  runtimeAccess: RuntimeAccessState | null;
  deviceId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

export type CloudDeviceSummary = {
  deviceId: string;
  organizationId: string;
  displayName: string;
  platform: string;
  registrationState: string;
  lastSeenAt: string | null;
  capabilities: Record<string, unknown>;
  runtimeCompatibility: Record<string, unknown>;
  createdAt: string | null;
};

export type CloudRemoteCommandSummary = {
  commandId: string;
  deviceId: string;
  kind: string;
  kindVersion: number;
  status: string;
  label: string;
  clientSubmissionId: string | null;
  orchestration: {
    orchestrationId: string | null;
    label: string | null;
    parentTaskId: string | null;
  } | null;
  createdAt: string | null;
  expiresAt: string | null;
  dispatchedAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
  rejectionReason: string | null;
  runtimeTaskId: string | null;
  runtimeRunId: string | null;
};

export type CloudRemoteCommandInput = {
  kind: "runtime.task.create" | "runtime.task.create-and-start";
  payload: Record<string, unknown>;
  expiresAt?: string;
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


export type AgentRequestPriority = "low" | "normal" | "high" | "urgent";
export type AgentRequestStatus = "pending" | "claimed" | "completed" | "cancelled";

export type AgentRequest = {
  requestId: string;
  type: string;
  producer: "desktop" | "runtime" | "cloud" | "worker";
  priority: AgentRequestPriority;
  subject: {
    kind: string;
    id: string;
    revision?: string;
  };
  reasonCode: string;
  errorCodes: string[];
  contextRefs: Array<{
    kind: string;
    id: string;
    revision?: string;
  }>;
  allowedActions: string[];
  requiresUserConfirmation: boolean;
  correlationId?: string;
  dedupeKey?: string;
  availableAt?: string;
  expiresAt?: string;
  status: AgentRequestStatus;
  claim: null | {
    ownerId: string;
    ownerStable: boolean;
    claimedAt: string;
    leaseExpiresAt: string;
  };
  resolution: null | {
    outcome: string;
    resultRef?: string;
    completedAt: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type AgentInboxSummary = {
  pending: number;
  claimed: number;
  highestPriority: AgentRequestPriority | null;
  byType: Record<string, number>;
};

export type RuntimeEventBridgeStatus = {
  version: 1;
  status:
    | "stopped"
    | "healthy"
    | "degraded"
    | "unsupported"
    | "needs_attention";
  supported: boolean | null;
  running: boolean;
  pollIntervalMs: number;
  lastPollAt: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  acceptedEvents: number;
  acceptedPages: number;
  retention: null | {
    strategy: "count";
    maxEvents: number;
    oldestSequence: number | null;
    newestSequence: number | null;
    oldestCursor: string | null;
    newestCursor: string | null;
  };
  reconciliation: null | {
    reasonCode: string;
    message: string;
    detectedAt: string;
    lastObservedAt?: string;
    savedCursor: string | null;
    savedSequence: number | null;
    requestedSequence?: number;
    oldestRetainedSequence?: number;
    pageNextCursor?: string;
  };
  consumer: {
    lastSequence: number | null;
    lastCursor: string | null;
    error?: string;
  };
};

export type PlannerCheckpoint = {
  schemaVersion: 1;
  revision: number;
  status:
    | "active"
    | "waiting_runtime"
    | "waiting_user"
    | "waiting_external"
    | "completed";
  goal: string;
  phase: string | null;
  summary: string | null;
  completed: string[];
  nextActions: string[];
  workspace: {
    repo?: string;
    worktree?: string;
    commit?: string;
  } | null;
  orchestrationId: string | null;
  taskIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type PlannerContinuationOwner = {
  ownerId: string;
  plannerConnected: boolean;
  connectedTransportCount: number;
  lastTransportSeenAt: string | null;
  lastDisconnectedAt: string | null;
  checkpoint: PlannerCheckpoint | null;
  updatedAt: string | null;
};

export type PlannerContinuationSummary = {
  activeCheckpointCount: number;
  connectedOwnerCount: number;
  latestActive: PlannerContinuationOwner | null;
};

export type RuntimeSnapshot = {
  mode: "live" | "offline";
  checkedAt: string;
  runtimeEndpoint?: string;
  latencyMs: number;
  info: null | { apiVersion?: string; runtimeVersion?: string; transport?: string };
  runtimeAccess: RuntimeAccessState | null;
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
    continuation?: PlannerContinuationSummary;
  };
  host: HostStatus | null;
  tunnel: TunnelStatus;
  cloud: CloudBridgeStatus;
  agentInbox: AgentInboxSummary;
  runtimeEvents: RuntimeEventBridgeStatus;
  accounts: AccountMeta[];
  activity: ActivityEntry[];
};

export type DesktopEnvironment = {
  appVersion: string;
  isPackaged: boolean;
  platform: string;
  arch: string;
  electronVersion: string;
  storage?: {
    version: number;
    productRoot: string;
    desktopRoot: string;
    stagingRoot: string;
    logsRoot: string;
    cacheRoot: string;
    diagnosticsRoot: string;
    migrationReportFile: string;
    migration: {
      copied: number;
      preservedExisting: number;
      missing: number;
      errors: number;
      legacyDetected: boolean;
    };
  };
};


export type UserSkillInputSpec = {
  type: "string" | "number" | "boolean";
  required?: boolean;
  default?: string | number | boolean;
  description?: string;
};

export type UserSkillManifest = {
  schemaVersion: 1;
  skillAbiVersion: 1;
  id: string;
  version: string;
  title: string;
  description: string;
  requiredPrimitiveAbi: number;
  requiredPrimitives: string[];
  executionMode: "durable";
  inputs: Record<string, UserSkillInputSpec>;
  contract: {
    riskLevel: "low" | "medium" | "high" | "critical";
    idempotent: boolean;
    sideEffects: string[];
    retryPolicy: "automatic" | "manual" | "never";
    requiresVerification: boolean;
    resources?: Array<{ key: string; mode: "shared" | "exclusive" }>;
  };
  steps: Array<{
    id: string;
    primitive: string;
    op: string;
    args?: Record<string, unknown>;
    dependsOn?: string[];
    verify?: unknown;
  }>;
  provenance?: {
    origin?: "external" | "workflow" | "semantic" | "user";
    sourceTaskIds?: string[];
    sourceMemoryIds?: string[];
  };
};

export type SkillValidationIssue = {
  code: string;
  file?: string;
  path: string;
  message: string;
  actual?: unknown;
  required?: unknown;
  allowed?: unknown;
};

export type SkillCandidateValidationReport = {
  reportVersion: 1;
  candidateId: string;
  candidateDigest: string;
  valid: boolean;
  targetSkillAbi: 1;
  primitiveAbi: {
    runtime: number;
    required: number | null;
  };
  requiredPrimitives: string[];
  allowedPrimitives: string[];
  derivedContract: Record<string, unknown> | null;
  effectiveContract: Record<string, unknown> | null;
  errors: SkillValidationIssue[];
  warnings: SkillValidationIssue[];
  validatedAt: string;
};

export type SkillCandidateRecord = {
  version: 1;
  id: string;
  status: "active" | "dismissed" | "promoted";
  createdAt: string;
  updatedAt: string;
  revision: number;
  currentDigest: string;
  revisions: Array<{
    revision: number;
    digest: string;
    createdAt: string;
    manifest: unknown;
  }>;
  validation?: SkillCandidateValidationReport;
  tests: Array<{
    candidateDigest: string;
    inputDigest: string;
    taskId: string;
    compiledAt: string;
  }>;
  promotion?: Record<string, unknown>;
  dismissedAt?: string;
};

export type UserSkillRegistrySummary = {
  skillId: string;
  enabled: boolean;
  activeVersion: string | null;
  versions: Array<{
    version: string;
    candidateDigest: string;
    installedAt: string;
    uninstalledAt: string | null;
    active: boolean;
  }>;
  createdAt: string | null;
  updatedAt: string | null;
};

export type WorkflowSkillProposal = {
  version: 1;
  proposalId: string;
  structuralDigest: string;
  source: "m2_episodic_evidence";
  support: {
    successfulRuns: number;
    sourceRunsUsed: number;
    distinctArgumentSets: number;
    recoveryFreeRuns: number;
    taskIds: string[];
    episodeIds: string[];
    evidenceDigests: string[];
  };
  parameterization: {
    inputNames: string[];
    variablePaths: string[];
  };
  manifestDigest: string;
  manifest: UserSkillManifest;
  validation: SkillCandidateValidationReport;
  governance: {
    state: "new" | "dismissed" | "candidate_exists" | "installed";
    evidenceRefreshAvailable: boolean;
    exactDigestCandidateIds: string[];
    exactLiveCandidateIds: string[];
    exactDismissedCandidateIds: string[];
    candidates: Array<{
      candidateId: string;
      status: string;
      currentDigest: string;
      exactDigest: boolean;
    }>;
    installed: null | {
      enabled: boolean;
      activeVersion: string | null;
      versions: string[];
    };
  };
  readyForSubmit: boolean;
  requiresExplicitSubmit: true;
  requiresTestBeforePromotion: true;
  autoPromoted: false;
};

export type WorkflowSkillDiscoveryResult = {
  version: 1;
  policy: Record<string, unknown>;
  scannedEpisodes: number;
  eligibleRuns: number;
  repeatedGroups: number;
  proposalCount: number;
  proposals: WorkflowSkillProposal[];
  blocked?: Array<Record<string, unknown>>;
};

export type SkillCandidateInspection = {
  candidate: SkillCandidateRecord;
  validation: SkillCandidateValidationReport;
  test: null | {
    binding: {
      candidateDigest: string;
      inputDigest: string;
      taskId: string;
      compiledAt: string;
    };
    task: Record<string, unknown>;
    provenanceValid: boolean;
    evidence: Record<string, unknown>;
    m2: null | {
      episodeId: string;
      contentDigest: string;
      evidenceDigest: string | null;
    };
    qualityGate: unknown;
    privacyGate: unknown;
  };
  readiness: {
    promotable: boolean;
    reasons: string[];
  };
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
  source: "runtime-1.0" | "runtime-1.x";
  fetchedAt: string;
  primitiveAbiVersion: number;
  skills: SkillSummary[];
  primitives: Array<Record<string, unknown> & { id?: string }>;
  providers: SkillProviderStatus[];
  candidates: SkillCandidateRecord[];
  userSkills: UserSkillRegistrySummary[];
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
    discoverySupported: boolean;
    librarySupported: boolean;
    reason: string;
  };
};

export type SkillRunResult = unknown;
