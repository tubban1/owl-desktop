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
    state: "ready",
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

  return {
    id: skill.id,
    title: titleFromId(skill.id),
    domain: skill.domain ?? "unknown",
    description: skill.description ?? "",
    version: skill.skillVersion ?? "unknown",
    source: "builtin",
    scope: "runtime",
    enabled: true,
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
    inputs: skill.inputs ?? {},
    lifecycle: {
      canInstall: false,
      canEnableDisable: false,
      canUpdate: false,
      canRollback: false,
      canUninstall: false,
      reason: "Requires Runtime 1.x Skill Registry",
    },
  };
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

    const primitiveList = asArray(primitives);
    const primitiveIds = new Set(primitiveList.map((item) => item?.id).filter(Boolean));
    const primitiveAbiVersion =
      Number(capabilities?.architecture?.primitiveAbi?.version ?? 0) || 0;
    const context = { primitiveIds, primitiveAbiVersion };
    const skills = asArray(catalog).map((skill) => normalizeSkill(skill, context));

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
        ["needs_attention", "missing_capability", "missing_permission", "incompatible", "integrity_failed"]
          .includes(skill.availability),
      ).length,
      disabled: skills.filter((skill) => skill.availability === "disabled").length,
      candidates: 0,
      updates: 0,
    };

    return {
      source: "runtime-1.0",
      fetchedAt: new Date().toISOString(),
      primitiveAbiVersion,
      skills,
      primitives: primitiveList,
      providers,
      summary,
      lifecycle: {
        registrySupported: false,
        candidatesSupported: false,
        librarySupported: false,
        reason: "Requires Runtime 1.x Skill Registry",
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
}
