import type {
  SkillManagerSnapshot,
  SkillRunResult,
  SkillSummary,
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
};
