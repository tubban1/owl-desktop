import type {
  AccountMeta,
  CloudBridgeStatus,
  DesktopEnvironment,
  HostStatus,
  RuntimeSnapshot,
  SecretMeta,
  Settings,
  SkillManagerSnapshot,
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
      skillSnapshot(): Promise<SkillManagerSnapshot>;
      skillDryRun(skillId: string, args: Record<string, unknown>): Promise<unknown>;
      skillRun(skillId: string, args: Record<string, unknown>): Promise<unknown>;
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
