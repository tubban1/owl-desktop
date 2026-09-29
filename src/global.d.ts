import type {
  AccountMeta,
  AgentInboxSummary,
  AgentRequest,
  AgentRequestStatus,
  CloudBridgeStatus,
  DesktopEnvironment,
  HostStatus,
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
      refreshRuntime(): Promise<RuntimeSnapshot>;
      cloudStatus(): Promise<CloudBridgeStatus>;
      cloudProbe(): Promise<{ ok?: boolean; service?: string; contractVersion?: string }>;
      cloudStart(): Promise<CloudBridgeStatus>;
      cloudStop(): Promise<CloudBridgeStatus>;
      cloudSync(): Promise<CloudBridgeStatus>;
      agentInboxSummary(): Promise<AgentInboxSummary>;
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
