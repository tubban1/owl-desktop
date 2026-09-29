import type {
  SkillCandidateInspection,
  SkillCandidateRecord,
  SkillCandidateValidationReport,
  SkillManagerSnapshot,
  SkillRunResult,
  SkillSummary,
  UserSkillManifest,
  UserSkillRegistrySummary,
  WorkflowSkillDiscoveryResult,
} from "../types";

export interface SkillManagerPort {
  listSkills(): Promise<SkillSummary[]>;
  getSkill(skillId: string): Promise<SkillSummary | null>;
  snapshot(): Promise<SkillManagerSnapshot>;
  dryRun(
    skillId: string,
    args: Record<string, unknown>,
  ): Promise<SkillRunResult>;
  run(
    skillId: string,
    args: Record<string, unknown>,
  ): Promise<SkillRunResult>;

  discover(request?: {
    minSuccessfulRuns?: number;
    scanLimit?: number;
    limit?: number;
    includeBlocked?: boolean;
  }): Promise<WorkflowSkillDiscoveryResult>;

  submitCandidate(manifest: UserSkillManifest): Promise<{
    idempotent: boolean;
    candidate: SkillCandidateRecord;
  }>;
  getCandidate(candidateId: string): Promise<SkillCandidateRecord>;
  reviseCandidate(
    candidateId: string,
    expectedDigest: string,
    manifest: UserSkillManifest,
  ): Promise<{
    idempotent: boolean;
    candidate: SkillCandidateRecord;
  }>;
  validateCandidate(
    candidateId: string,
    expectedDigest?: string,
  ): Promise<SkillCandidateValidationReport>;
  dismissCandidate(
    candidateId: string,
    expectedDigest?: string,
  ): Promise<SkillCandidateRecord>;
  compileCandidateTest(
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
  runCandidateTest(taskId: string): Promise<unknown>;
  inspectCandidate(
    candidateId: string,
    testTaskId?: string,
  ): Promise<SkillCandidateInspection>;
  promoteCandidate(
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

  setUserSkillEnabled(
    skillId: string,
    enabled: boolean,
  ): Promise<{ idempotent: boolean; skill: UserSkillRegistrySummary }>;
  activateUserSkillVersion(
    skillId: string,
    version: string,
  ): Promise<{ idempotent: boolean; skill: UserSkillRegistrySummary }>;
  rollbackUserSkill(
    skillId: string,
    version?: string,
  ): Promise<{ idempotent: boolean; skill: UserSkillRegistrySummary }>;
  uninstallUserSkill(
    skillId: string,
    version?: string,
  ): Promise<{ idempotent: boolean; skill: UserSkillRegistrySummary }>;
}

export const desktopSkillManagerPort: SkillManagerPort = {
  async snapshot() {
    return window.owlDesktop.skillSnapshot();
  },

  async listSkills() {
    const snapshot = await window.owlDesktop.skillSnapshot();
    return snapshot.skills;
  },

  async getSkill(skillId) {
    const snapshot = await window.owlDesktop.skillSnapshot();
    return snapshot.skills.find((skill) => skill.id === skillId) ?? null;
  },

  async dryRun(skillId, args) {
    return window.owlDesktop.skillDryRun(skillId, args);
  },

  async run(skillId, args) {
    return window.owlDesktop.skillRun(skillId, args);
  },

  async discover(request = {}) {
    return window.owlDesktop.skillDiscover(request);
  },

  async submitCandidate(manifest) {
    return window.owlDesktop.skillCandidateSubmit(manifest);
  },

  async getCandidate(candidateId) {
    return window.owlDesktop.skillCandidateGet(candidateId);
  },

  async reviseCandidate(candidateId, expectedDigest, manifest) {
    return window.owlDesktop.skillCandidateRevise(
      candidateId,
      expectedDigest,
      manifest,
    );
  },

  async validateCandidate(candidateId, expectedDigest) {
    return window.owlDesktop.skillCandidateValidate(
      candidateId,
      expectedDigest,
    );
  },

  async dismissCandidate(candidateId, expectedDigest) {
    return window.owlDesktop.skillCandidateDismiss(
      candidateId,
      expectedDigest,
    );
  },

  async compileCandidateTest(candidateId, expectedDigest, inputs) {
    return window.owlDesktop.skillCandidateCompileTest(
      candidateId,
      expectedDigest,
      inputs,
    );
  },

  async runCandidateTest(taskId) {
    return window.owlDesktop.skillCandidateRunTest(taskId);
  },

  async inspectCandidate(candidateId, testTaskId) {
    return window.owlDesktop.skillCandidateInspect(candidateId, testTaskId);
  },

  async promoteCandidate(
    candidateId,
    expectedDigest,
    testTaskId,
    confirm,
  ) {
    return window.owlDesktop.skillCandidatePromote(
      candidateId,
      expectedDigest,
      testTaskId,
      confirm,
    );
  },

  async setUserSkillEnabled(skillId, enabled) {
    return window.owlDesktop.userSkillSetEnabled(skillId, enabled);
  },

  async activateUserSkillVersion(skillId, version) {
    return window.owlDesktop.userSkillActivateVersion(skillId, version);
  },

  async rollbackUserSkill(skillId, version) {
    return window.owlDesktop.userSkillRollback(skillId, version);
  },

  async uninstallUserSkill(skillId, version) {
    return window.owlDesktop.userSkillUninstall(skillId, version);
  },
};
