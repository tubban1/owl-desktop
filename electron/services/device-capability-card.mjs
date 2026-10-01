function providerMap(manifest) {
  const providers = Array.isArray(manifest?.providers)
    ? manifest.providers
    : [];
  return new Map(
    providers
      .filter((entry) => entry && typeof entry === "object" && entry.id)
      .map((entry) => [entry.id, entry]),
  );
}

export function buildSafeDeviceCapabilityCard(manifest) {
  const providers = providerMap(manifest);
  const provider = (id) => providers.get(id) ?? null;
  const ready = (id) => {
    const entry = provider(id);
    return entry?.enabled === true && entry?.available === true;
  };
  const filesystem = provider("filesystem");
  const git = provider("git");

  return {
    providers: {
      filesystem: {
        available: ready("filesystem"),
        write: filesystem?.details?.write === true,
        delete: filesystem?.details?.delete === true,
      },
      shell: { available: ready("shell") },
      git: {
        available: ready("git"),
        push: git?.details?.push === true,
      },
      browser: { available: ready("browser") },
      desktop: { available: ready("desktop") },
    },
    skillRegistry:
      manifest?.extensions?.userSkillRegistry?.status === "candidate" ||
      manifest?.extensions?.userSkillRegistry?.status === "stable",
    verification: manifest?.architecture?.verifierAbi?.version === 1,
    primitiveAbiVersion:
      manifest?.architecture?.primitiveAbi?.version ?? null,
  };
}
