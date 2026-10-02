import type {
  AccountMeta,
  ActivityEntry,
  AgentInboxSummary,
  AgentRequest,
  AgentRequestStatus,
  CloudAccountStatus,
  CloudBridgeStatus,
  CloudDeviceSummary,
  CloudRemoteCommandInput,
  CloudRemoteCommandSummary,
  DesktopEnvironment,
  HostStatus,
  RuntimeEventBridgeStatus,
  RuntimeSnapshot,
  SecretMeta,
  Settings,
  SkillCandidateInspection,
  SkillCandidateRecord,
  SkillCandidateValidationReport,
  SkillManagerSnapshot,
  UserSkillManifest,
  UserSkillRegistrySummary,
  WorkflowSkillDiscoveryResult,
  TunnelStatus,
} from "./types";

declare global {
  interface Window {
    owlDesktop: {
      environment(): Promise<DesktopEnvironment>;
      listActivity(): Promise<ActivityEntry[]>;
      refreshRuntime(options?: { quiet?: boolean }): Promise<RuntimeSnapshot>;
      approveRuntimeApproval(approvalId: string): Promise<unknown>;
      denyRuntimeApproval(approvalId: string): Promise<unknown>;
      monitorTaskDetail(
        taskId: string,
        includeResults?: boolean,
      ): Promise<Record<string, unknown>>;
      cloudStatus(): Promise<CloudBridgeStatus>;
      cloudAccountStatus(): Promise<CloudAccountStatus>;
      cloudLogin(): Promise<{ status: string; provider: string; region: string | null; redirectUri: string }>;
      cloudReauthorize(): Promise<{
        status: string;
        interactionRequired: boolean;
        runtimeAccess?: { state?: string } | null;
        provider?: string;
        region?: string | null;
        redirectUri?: string;
      }>;
      cloudLogout(): Promise<CloudAccountStatus>;
      onCloudAccountUpdated(callback: (value: CloudAccountStatus) => void): () => void;
      cloudProbe(): Promise<{ ok?: boolean; service?: string; contractVersion?: string }>;
      cloudStart(): Promise<CloudBridgeStatus>;
      cloudStop(): Promise<CloudBridgeStatus>;
      cloudSync(): Promise<CloudBridgeStatus>;
      cloudListDevices(): Promise<CloudDeviceSummary[]>;
      cloudListCommands(
        deviceId: string,
        limit?: number,
      ): Promise<CloudRemoteCommandSummary[]>;
      cloudCreateCommand(
        deviceId: string,
        input: CloudRemoteCommandInput,
      ): Promise<CloudRemoteCommandSummary>;
      cloudCancelCommand(commandId: string): Promise<CloudRemoteCommandSummary>;
      agentInboxSummary(): Promise<AgentInboxSummary>;
      runtimeEventStatus(): Promise<RuntimeEventBridgeStatus>;
      runtimeEventSync(): Promise<RuntimeEventBridgeStatus>;
      runtimeEventRetrySavedCursor(): Promise<RuntimeEventBridgeStatus>;
      listAgentRequests(input?: {
        statuses?: AgentRequestStatus[];
        limit?: number;
      }): Promise<AgentRequest[]>;
      cancelAgentRequest(requestId: string): Promise<AgentRequest | null>;
      skillSnapshot(): Promise<SkillManagerSnapshot>;
      skillDryRun(skillId: string, args: Record<string, unknown>): Promise<unknown>;
      skillRun(skillId: string, args: Record<string, unknown>): Promise<unknown>;
      skillDiscover(request?: {
        minSuccessfulRuns?: number;
        scanLimit?: number;
        limit?: number;
        includeBlocked?: boolean;
      }): Promise<WorkflowSkillDiscoveryResult>;
      skillCandidateSubmit(manifest: UserSkillManifest): Promise<{
        idempotent: boolean;
        candidate: SkillCandidateRecord;
      }>;
      skillCandidateGet(candidateId: string): Promise<SkillCandidateRecord>;
      skillCandidateRevise(
        candidateId: string,
        expectedDigest: string,
        manifest: UserSkillManifest,
      ): Promise<{
        idempotent: boolean;
        candidate: SkillCandidateRecord;
      }>;
      skillCandidateValidate(
        candidateId: string,
        expectedDigest?: string,
      ): Promise<SkillCandidateValidationReport>;
      skillCandidateDismiss(
        candidateId: string,
        expectedDigest?: string,
      ): Promise<SkillCandidateRecord>;
      skillCandidateCompileTest(
        candidateId: string,
        expectedDigest: string,
        inputs: Record<string, unknown>,
      ): Promise<{
        compiled: boolean;
        idempotent?: boolean;
        candidateId?: string;
        candidateDigest?: string;
        inputDigest?: string;
        task?: Record<string, unknown> & { id?: string; status?: string };
        validation?: SkillCandidateValidationReport;
        inputErrors?: Array<Record<string, unknown>>;
        compileErrors?: Array<Record<string, unknown>>;
      }>;
      skillCandidateRunTest(taskId: string): Promise<unknown>;
      skillCandidateInspect(
        candidateId: string,
        testTaskId?: string,
      ): Promise<SkillCandidateInspection>;
      skillCandidatePromote(
        candidateId: string,
        expectedDigest: string,
        testTaskId: string,
        confirm: boolean,
      ): Promise<{
        promoted?: boolean;
        idempotent?: boolean;
        receipt?: Record<string, unknown>;
        registry?: Record<string, unknown>;
        readiness?: { promotable: boolean; reasons: string[] };
        validation?: SkillCandidateValidationReport;
        test?: unknown;
      }>;
      userSkillSetEnabled(
        skillId: string,
        enabled: boolean,
      ): Promise<{ idempotent: boolean; skill: UserSkillRegistrySummary }>;
      userSkillActivateVersion(
        skillId: string,
        version: string,
      ): Promise<{ idempotent: boolean; skill: UserSkillRegistrySummary }>;
      userSkillRollback(
        skillId: string,
        version?: string,
      ): Promise<{ idempotent: boolean; skill: UserSkillRegistrySummary }>;
      userSkillUninstall(
        skillId: string,
        version?: string,
      ): Promise<{ idempotent: boolean; skill: UserSkillRegistrySummary }>;
      hostStatus(): Promise<HostStatus>;
      hostRestart(): Promise<HostStatus>;
      hostStop(): Promise<HostStatus>;
      tunnelStatus(): Promise<TunnelStatus>;
      tunnelStart(): Promise<TunnelStatus>;
      tunnelStop(): Promise<TunnelStatus>;
      listAccounts(): Promise<AccountMeta[]>;
      upsertAccount(input: {
        id?: string;
        service: string;
        label: string;
        identifier?: string;
        authMethod: AccountMeta["authMethod"];
        secret?: string;
        browserProfileId?: string | null;
        notes?: string;
      }): Promise<AccountMeta>;
      deleteAccount(id: string): Promise<{ ok: boolean }>;
      setAccountStatus(
        id: string,
        status: string,
        options?: { expiresAt?: string | null },
      ): Promise<AccountMeta>;
      accountCapabilities(id: string): Promise<{
        canProvideStoredSecret: boolean;
        requiresHumanChallenge: boolean;
        browserSessionPreferred: boolean;
        nativeSessionPreferred: boolean;
      } | null>;
      getSettings(): Promise<Settings>;
      pickAllowedFolders(): Promise<string[]>;
      updateSettings(patch: Partial<Settings>): Promise<Settings>;
      listSecrets(): Promise<SecretMeta[]>;
      upsertSecret(input: {
        id?: string;
        name: string;
        project: string;
        value: string;
      }): Promise<SecretMeta>;
      deleteSecret(id: string): Promise<{ ok: boolean }>;
    };
  }
}

export {};
