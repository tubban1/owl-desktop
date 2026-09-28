import type { DesktopEnvironment, RuntimeSnapshot, SecretMeta, Settings } from "./types";

declare global {
  interface Window {
    owlDesktop: {
      environment(): Promise<DesktopEnvironment>;
      refreshRuntime(): Promise<RuntimeSnapshot>;
      getSettings(): Promise<Settings>;
      updateSettings(patch: Partial<Settings>): Promise<Settings>;
      listSecrets(): Promise<SecretMeta[]>;
      upsertSecret(input: { id?: string; name: string; project: string; value: string }): Promise<SecretMeta>;
      deleteSecret(id: string): Promise<{ ok: boolean }>;
    };
  }
}

export {};
