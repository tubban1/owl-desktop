import type {
  AccountMeta,
  DesktopEnvironment,
  HostStatus,
  RuntimeSnapshot,
  SecretMeta,
  Settings,
  TunnelStatus,
} from "./types";

declare global {
  interface Window {
    owlDesktop: {
      environment(): Promise<DesktopEnvironment>;
      refreshRuntime(): Promise<RuntimeSnapshot>;
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
