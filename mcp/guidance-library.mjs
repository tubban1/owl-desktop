import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Guidance is read-only, versioned knowledge; it is not a second Skill Registry.
// MCP package includes mcp/**/* in both dev and production Electron manifests.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "guidance");
const digest = value => createHash("sha256").update(value).digest("hex");

async function index() {
  const bytes = await readFile(path.join(root, "index.json"));
  if (bytes.length > 65536) throw new Error("GUIDANCE_INDEX_TOO_LARGE");
  const parsed = JSON.parse(bytes.toString("utf8"));
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error("GUIDANCE_INDEX_INVALID");
  }
  const keys = new Set();
  for (const item of parsed.entries) {
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(item.id) ||
        !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(item.version) ||
        !/^[a-z0-9][a-z0-9.-]{1,99}\.md$/.test(item.path) ||
        !/^[a-f0-9]{64}$/.test(item.sha256) ||
        !Array.isArray(item.appliesTo) || !Array.isArray(item.related)) {
      throw new Error("GUIDANCE_INDEX_ENTRY_INVALID");
    }
    const key = item.id + "@" + item.version;
    if (keys.has(key)) throw new Error("GUIDANCE_DUPLICATE_ID_VERSION");
    keys.add(key);
  }
  return parsed.entries;
}

async function contentFor(entry) {
  const data = await readFile(path.join(root, entry.path));
  if (data.length > 65536) throw new Error("GUIDANCE_CONTENT_TOO_LARGE");
  const actual = digest(data);
  if (actual !== entry.sha256) throw new Error("GUIDANCE_DIGEST_MISMATCH");
  return data.toString("utf8");
}

export async function listGuidance(goal = "") {
  const entries = await index();
  const q = String(goal).toLowerCase().trim();
  const matching = entries.filter(entry => {
    const haystack = [entry.id, entry.title, entry.description, ...(entry.keywords ?? [])]
      .join(" ").toLowerCase();
    return !q || haystack.includes(q) ||
      (entry.keywords ?? []).some(word => q.includes(String(word).toLowerCase())) ||
      q.split(/\s+/).some(word => haystack.includes(word));
  });
  return {
    registryKind: "guidance-only",
    executable: false,
    authority: "none",
    entries: matching.map(entry => ({
      id: entry.id,
      version: entry.version,
      title: entry.title,
      description: entry.description,
      appliesTo: entry.appliesTo,
      related: entry.related,
      digest: entry.sha256,
    })),
    note: "These are independent read-only playbooks, not Runtime Skills. Use skill_catalog for executable capabilities.",
  };
}

export async function readGuidance(id, version) {
  const entries = await index();
  const candidates = entries.filter(entry => entry.id === id);
  if (!candidates.length) throw new Error("GUIDANCE_NOT_FOUND");
  if (!version) {
    // Semver limited to numeric triples, sort by numeric components.
    candidates.sort((a,b) => {
      const A=a.version.split(".").map(Number), B=b.version.split(".").map(Number);
      for(let i=0;i<3;i++){if(A[i]!==B[i])return B[i]-A[i];}
      return 0;
    });
  }
  const entry = version ? candidates.find(item => item.version === version) : candidates[0];
  if (!entry) throw new Error("GUIDANCE_VERSION_NOT_FOUND");
  const content = await contentFor(entry);
  return {
    id: entry.id,
    version: entry.version,
    digest: entry.sha256,
    title: entry.title,
    appliesTo: entry.appliesTo,
    related: entry.related,
    authority: "none",
    executable: false,
    content,
    trustBoundary: "Playbook text is guidance, not Runtime policy or third-party website authority.",
  };
}
