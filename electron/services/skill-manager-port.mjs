function titleFromId(id) {
  const leaf = String(id ?? "").split(".").pop() ?? String(id ?? "");
  return leaf
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizeContract(contract = {}) {
  return {
    riskLevel: contract.riskLevel ?? "low",
    idempotent: contract.idempotent === true,
    sideEffects: asArray(contract.sideEffects),
    requiresVerification: contract.requiresVerification === true,
    retryPolicy: contract.retryPolicy ?? "manual",
    resources: asArray(contract.resources),
  };
}

function availabilityFor(skill, primitiveIds, primitiveAbiVersion) {
  if (typeof skill.availability === "string") {
    return {
      state: skill.availability,
      reasons: asArray(skill.validationErrors),
    };
  }

  const requiredAbi = Number(skill.requiredPrimitiveAbi ?? 0);
  if (
    Number.isFinite(requiredAbi) &&
    Number.isFinite(primitiveAbiVersion) &&
    requiredAbi > primitiveAbiVersion
  ) {
    return {
      state: "incompatible",
      reasons: [
        `Requires Primitive ABI ${requiredAbi}; Runtime exposes ${primitiveAbiVersion}.`,
      ],
    };
  }

  const requiredPrimitives = asArray(skill.requiredPrimitives);
  const missing = requiredPrimitives.filter((id) => !primitiveIds.has(id));
  if (missing.length) {
    return {
      state: "missing_capability",
      reasons: [`Missing Primitives: ${missing.join(", ")}`],
    };
  }

  return {
    state: skill.enabled === false ? "disabled" : "ready",
    reasons: [],
  };
}

function normalizeSkill(skill, context) {
  const contract = normalizeContract(skill.contract);
  const availability = availabilityFor(
    skill,
    context.primitiveIds,
    context.primitiveAbiVersion,
  );
  const source = skill.source === "user" ? "user" : "builtin";

  return {
    id: skill.id,
    title: skill.title ?? titleFromId(skill.id),
    domain: skill.domain ?? (source === "user" ? "user" : "unknown"),
    description: skill.description ?? "",
    version: skill.skillVersion ?? skill.activeVersion ?? "unknown",
    source,
    scope: source === "user" ? "user" : "runtime",
    enabled: skill.enabled !== false,
    availability: availability.state,
    availabilityReasons: availability.reasons,
    executionMode: skill.executionMode ?? "inline",
    requiredPrimitiveAbi: skill.requiredPrimitiveAbi ?? null,
    requiredPrimitives: asArray(skill.requiredPrimitives),
    memoryPolicy: skill.memoryPolicy ?? null,
    riskLevel: contract.riskLevel,
    idempotent: contract.idempotent,
    sideEffects: contract.sideEffects,
    requiresVerification: contract.requiresVerification,
    retryPolicy: contract.retryPolicy,
    resources: contract.resources,
    inputs: asObject(skill.inputs),
    lifecycle: {
      canInstall: false,
      canEnableDisable: source === "user" && context.registrySupported,
      canUpdate: source === "user" && context.registrySupported,
      canRollback: source === "user" && context.registrySupported,
      canUninstall: source === "user" && context.registrySupported,
      reason:
        source === "user" && context.registrySupported
          ? "Managed by canonical Runtime User Skill Registry"
          : "Built-in Runtime Skill",
    },
  };
}

function extensionVersion(capabilities, name) {
  const value = capabilities?.extensions?.[name]?.version;
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizeUserSkillRegistryList(value) {
  return asArray(value?.skills).map((skill) => ({
    skillId: skill.skillId,
    enabled: skill.enabled === true,
    activeVersion: skill.activeVersion ?? null,
    versions: asArray(skill.versions),
    createdAt: skill.createdAt ?? null,
    updatedAt: skill.updatedAt ?? null,
  }));
}

function currentCandidateManifest(candidate) {
  const revisions = asArray(candidate?.revisions);
  return (
    revisions.find((revision) => revision?.digest === candidate?.currentDigest)
      ?.manifest ?? null
  );
}

export class RuntimeSkillManagerPort {
  constructor({ client }) {
    this.client = client;
  }

  async snapshot() {
    const [catalog, primitives, capabilities] = await Promise.all([
      this.client.skillCatalog(),
      this.client.primitiveCatalog(),
      this.client.capabilities(""),
    ]);

    const registrySupported =
      extensionVersion(capabilities, "userSkillRegistry") >= 1;
    const discoverySupported =
      extensionVersion(capabilities, "workflowSkillDiscovery") >= 1;

    const [candidateRecords, userSkillResult] = await Promise.all([
      registrySupported ? this.client.listSkillCandidates() : Promise.resolve([]),
      registrySupported
        ? this.client.listUserSkills()
        : Promise.resolve({ skills: [] }),
    ]);

    const primitiveList = asArray(primitives);
    const primitiveIds = new Set(
      primitiveList.map((item) => item?.id).filter(Boolean),
    );
    const primitiveAbiVersion =
      Number(capabilities?.architecture?.primitiveAbi?.version ?? 0) || 0;
    const context = {
      primitiveIds,
      primitiveAbiVersion,
      registrySupported,
    };
    const skills = asArray(catalog).map((skill) =>
      normalizeSkill(skill, context),
    );
    const candidates = asArray(candidateRecords);
    const userSkills = normalizeUserSkillRegistryList(userSkillResult);

    const providers = asArray(capabilities?.providers).map((provider) => ({
      id: provider.id,
      label: provider.label ?? provider.id,
      enabled: provider.enabled === true,
      available: provider.available === true,
      capabilities: asArray(provider.capabilities),
      executionTargets: asArray(provider.executionTargets),
      details: provider.details ?? null,
    }));

    const summary = {
      installed: skills.length,
      ready: skills.filter((skill) => skill.availability === "ready").length,
      needsAttention: skills.filter((skill) =>
        [
          "needs_attention",
          "missing_capability",
          "missing_permission",
          "incompatible",
          "integrity_failed",
        ].includes(skill.availability),
      ).length,
      disabled: skills.filter(
        (skill) => skill.availability === "disabled",
      ).length,
      candidates: candidates.filter(
        (candidate) => candidate?.status === "active",
      ).length,
      updates: 0,
    };

    return {
      source: registrySupported ? "runtime-1.x" : "runtime-1.0",
      fetchedAt: new Date().toISOString(),
      primitiveAbiVersion,
      skills,
      primitives: primitiveList,
      providers,
      candidates,
      userSkills,
      summary,
      lifecycle: {
        registrySupported,
        candidatesSupported: registrySupported,
        discoverySupported,
        librarySupported: false,
        reason: registrySupported
          ? "Runtime User Skill Registry v1 available"
          : "Requires Runtime 1.x User Skill Registry",
      },
    };
  }

  async getSkill(skillId) {
    const snapshot = await this.snapshot();
    return snapshot.skills.find((skill) => skill.id === skillId) ?? null;
  }

  async dryRun(skillId, args = {}) {
    return this.client.runSkill({
      skill: skillId,
      args,
      dryRun: true,
    });
  }

  async run(skillId, args = {}) {
    return this.client.runSkill({
      skill: skillId,
      args,
      dryRun: false,
    });
  }

  async discover(request = {}) {
    return await this.client.discoverWorkflowSkillCandidates(request);
  }

  async submitCandidate(manifest) {
    return await this.client.submitSkillCandidate(manifest);
  }

  async getCandidate(candidateId) {
    return await this.client.getSkillCandidate(candidateId);
  }

  async reviseCandidate(candidateId, expectedDigest, manifest) {
    return await this.client.reviseSkillCandidate(
      candidateId,
      expectedDigest,
      manifest,
    );
  }

  async validateCandidate(candidateId, expectedDigest) {
    return await this.client.validateSkillCandidate(
      candidateId,
      expectedDigest,
    );
  }

  async dismissCandidate(candidateId, expectedDigest) {
    return await this.client.dismissSkillCandidate(
      candidateId,
      expectedDigest,
    );
  }

  async compileCandidateTest(candidateId, expectedDigest, inputs = {}) {
    return await this.client.compileSkillCandidateTest(
      candidateId,
      expectedDigest,
      inputs,
    );
  }

  async runCandidateTest(taskId) {
    return await this.client.runTask(taskId, {
      maxWaves: 100,
      timeBudgetMs: 120_000,
      timeoutMs: 130_000,
    });
  }

  async inspectCandidate(candidateId, testTaskId) {
    return await this.client.inspectSkillCandidate(candidateId, testTaskId);
  }

  async promoteCandidate(candidateId, expectedDigest, testTaskId, confirm) {
    return await this.client.promoteSkillCandidate(
      candidateId,
      expectedDigest,
      testTaskId,
      confirm,
    );
  }

  async setEnabled(skillId, enabled) {
    return await this.client.setUserSkillEnabled(skillId, enabled);
  }

  async activateVersion(skillId, version) {
    return await this.client.activateUserSkillVersion(skillId, version);
  }

  async rollback(skillId, version) {
    return await this.client.rollbackUserSkill(skillId, version);
  }

  async uninstall(skillId, version) {
    return await this.client.uninstallUserSkill(skillId, version);
  }

  currentCandidateManifest(candidate) {
    return currentCandidateManifest(candidate);
  }
}
