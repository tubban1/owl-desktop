import { createHash, randomUUID } from "node:crypto";

const SENSITIVE_KEY_PATTERN =
  /(secret|token|password|passwd|credential|api[_-]?key|authorization|cookie|private[_-]?key|client[_-]?secret|access[_-]?key|refresh[_-]?token)/i;

const SECRET_VALUE_PATTERNS = [
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}\b/i,
];

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function secretLike(value) {
  return (
    typeof value === "string" &&
    SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))
  );
}

function pathJoin(parent, key) {
  if (!parent) return String(key);
  if (/^\d+$/.test(String(key))) return `${parent}[${key}]`;
  return `${parent}.${key}`;
}

function shouldRedactExecutionLiteral(path, value, secretBlocked) {
  if (!secretBlocked || typeof value !== "string") return false;
  return (
    /(?:^|\.)steps\[\d+\]\.args(?:\.|$)/.test(path) ||
    /(?:^|\.)inputs\.[^.]+\.default$/.test(path) ||
    /(?:^|\.)verify(?:\.|$)/.test(path)
  );
}

function redactValue(value, {
  path = "$",
  parentKey = "",
  secretBlocked = false,
  redactions,
} = {}) {
  if (Array.isArray(value)) {
    return value.map((child, index) =>
      redactValue(child, {
        path: pathJoin(path, index),
        parentKey,
        secretBlocked,
        redactions,
      }),
    );
  }

  if (isObject(value)) {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      const childPath = pathJoin(path, key);
      if (
        SENSITIVE_KEY_PATTERN.test(key) &&
        (typeof child === "string" || typeof child === "number")
      ) {
        redactions.push({ path: childPath, reason: "sensitive_key" });
        result[key] = "<redacted:secret>";
        continue;
      }
      result[key] = redactValue(child, {
        path: childPath,
        parentKey: key,
        secretBlocked,
        redactions,
      });
    }
    return result;
  }

  if (
    secretLike(value) ||
    shouldRedactExecutionLiteral(path, value, secretBlocked) ||
    (SENSITIVE_KEY_PATTERN.test(parentKey) && value != null)
  ) {
    redactions.push({
      path,
      reason: secretLike(value)
        ? "secret_pattern"
        : secretBlocked
          ? "secret_blocked_execution_literal"
          : "sensitive_key",
    });
    return "<redacted:secret>";
  }

  return value;
}

export function sanitizeValidationForAgent(validation) {
  if (!isObject(validation)) return null;
  const secretBlocked = Array.isArray(validation.errors) &&
    validation.errors.some(
      (issue) => issue?.code === "USER_SKILL_EMBEDDED_SECRET_BLOCKED",
    );

  const sanitizeIssue = (issue) => {
    if (!isObject(issue)) return issue;
    const safe = {
      code: issue.code ?? "UNKNOWN",
      ...(issue.file ? { file: issue.file } : {}),
      path: issue.path ?? "$",
      message: issue.message ?? "",
      ...(Object.prototype.hasOwnProperty.call(issue, "required")
        ? { required: issue.required }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(issue, "allowed")
        ? { allowed: issue.allowed }
        : {}),
    };
    if (
      Object.prototype.hasOwnProperty.call(issue, "actual") &&
      !secretBlocked &&
      issue.code !== "USER_SKILL_EMBEDDED_SECRET_BLOCKED"
    ) {
      safe.actual = issue.actual;
    } else if (Object.prototype.hasOwnProperty.call(issue, "actual")) {
      safe.actual = {
        redacted: true,
        ...(Array.isArray(issue.actual)
          ? { matchCount: issue.actual.length }
          : {}),
      };
    }
    return safe;
  };

  return {
    reportVersion: validation.reportVersion ?? 1,
    candidateId: validation.candidateId ?? null,
    candidateDigest: validation.candidateDigest ?? null,
    valid: validation.valid === true,
    targetSkillAbi: validation.targetSkillAbi ?? null,
    primitiveAbi: validation.primitiveAbi ?? null,
    requiredPrimitives: Array.isArray(validation.requiredPrimitives)
      ? validation.requiredPrimitives
      : [],
    allowedPrimitives: Array.isArray(validation.allowedPrimitives)
      ? validation.allowedPrimitives
      : [],
    derivedContract: validation.derivedContract ?? null,
    effectiveContract: validation.effectiveContract ?? null,
    errors: Array.isArray(validation.errors)
      ? validation.errors.map(sanitizeIssue)
      : [],
    warnings: Array.isArray(validation.warnings)
      ? validation.warnings.map(sanitizeIssue)
      : [],
    validatedAt: validation.validatedAt ?? null,
  };
}

export function projectSkillRepairContext(request, candidate) {
  if (!request || !candidate) {
    throw new Error("Skill repair context requires request and candidate.");
  }
  const currentRevision = Array.isArray(candidate.revisions)
    ? candidate.revisions.find(
        (revision) => revision?.digest === candidate.currentDigest,
      )
    : null;
  if (!currentRevision) {
    const error = new Error(
      "SKILL_REPAIR_CANDIDATE_CORRUPT: current revision manifest is missing.",
    );
    error.code = "SKILL_REPAIR_CANDIDATE_CORRUPT";
    throw error;
  }

  const validation = sanitizeValidationForAgent(candidate.validation);
  const secretBlocked = validation?.errors?.some(
    (issue) => issue.code === "USER_SKILL_EMBEDDED_SECRET_BLOCKED",
  ) === true;
  const redactions = [];
  const manifest = redactValue(currentRevision.manifest, {
    path: "$",
    secretBlocked,
    redactions,
  });

  return {
    request: {
      requestId: request.requestId,
      type: request.type,
      producer: request.producer,
      reasonCode: request.reasonCode,
      errorCodes: request.errorCodes ?? [],
      allowedActions: request.allowedActions ?? [],
      requiresUserConfirmation: request.requiresUserConfirmation === true,
      subject: request.subject,
    },
    candidate: {
      id: candidate.id,
      status: candidate.status,
      revision: candidate.revision,
      currentDigest: candidate.currentDigest,
      createdAt: candidate.createdAt ?? null,
      updatedAt: candidate.updatedAt ?? null,
      manifest,
      validation,
    },
    privacy: {
      mode: secretBlocked ? "secret_blocked_conservative" : "standard",
      redacted: redactions.length > 0,
      redactions,
      rawManifestExposed: false,
    },
  };
}

export function requireClaimedSkillRepair({
  agentInbox,
  requestId,
  ownerId,
  ownerStable,
  action,
}) {
  if (!agentInbox) {
    const error = new Error("OWL Agent Inbox is unavailable.");
    error.code = "AGENT_INBOX_UNAVAILABLE";
    throw error;
  }
  const request = agentInbox.get(requestId);
  if (!request) {
    const error = new Error("AgentRequest not found.");
    error.code = "AGENT_REQUEST_NOT_FOUND";
    throw error;
  }
  if (
    request.type !== "skill.repair" ||
    request.producer !== "runtime" ||
    request.subject?.kind !== "skill_candidate"
  ) {
    const error = new Error(
      "AgentRequest is not a Runtime Skill Candidate repair request.",
    );
    error.code = "SKILL_REPAIR_REQUEST_TYPE_MISMATCH";
    throw error;
  }
  if (request.status !== "claimed" || request.claim?.ownerId !== ownerId) {
    const error = new Error(
      "Skill repair AgentRequest must be claimed by this logical owner.",
    );
    error.code = "SKILL_REPAIR_CLAIM_REQUIRED";
    throw error;
  }
  if (ownerStable !== true || request.claim?.ownerStable !== true) {
    const error = new Error(
      "Skill repair requires a stable logical MCP owner identity.",
    );
    error.code = "SKILL_REPAIR_STABLE_OWNER_REQUIRED";
    throw error;
  }
  if (!request.allowedActions?.includes(action)) {
    const error = new Error(
      `AgentRequest does not allow coordination action ${action}.`,
    );
    error.code = "SKILL_REPAIR_ACTION_NOT_ALLOWED";
    throw error;
  }
  return request;
}

export function assertCandidateMatchesRepairRequest(request, candidate) {
  if (!candidate || candidate.id !== request.subject?.id) {
    const error = new Error(
      "Runtime Candidate does not match the claimed AgentRequest subject.",
    );
    error.code = "SKILL_REPAIR_CANDIDATE_MISMATCH";
    throw error;
  }
  if (
    request.subject?.revision !== undefined &&
    String(candidate.revision) !== String(request.subject.revision)
  ) {
    const error = new Error(
      `SKILL_REPAIR_REQUEST_STALE: request revision=${request.subject.revision} runtime revision=${candidate.revision}.`,
    );
    error.code = "SKILL_REPAIR_REQUEST_STALE";
    throw error;
  }
  return candidate;
}

export function assertRepairSourceRevision(
  request,
  candidate,
  expectedDigest,
) {
  if (!candidate || candidate.id !== request.subject?.id) {
    const error = new Error(
      "Runtime Candidate does not match the claimed AgentRequest subject.",
    );
    error.code = "SKILL_REPAIR_CANDIDATE_MISMATCH";
    throw error;
  }

  const requestedRevision = String(request.subject?.revision ?? "");
  const source = Array.isArray(candidate.revisions)
    ? candidate.revisions.find(
        (revision) => String(revision?.revision) === requestedRevision,
      )
    : null;

  if (!source) {
    const error = new Error(
      `SKILL_REPAIR_SOURCE_REVISION_MISSING: request revision=${requestedRevision}.`,
    );
    error.code = "SKILL_REPAIR_SOURCE_REVISION_MISSING";
    throw error;
  }
  if (
    typeof expectedDigest !== "string" ||
    !expectedDigest ||
    source.digest !== expectedDigest
  ) {
    const error = new Error(
      "SKILL_REPAIR_EXPECTED_DIGEST_MISMATCH: expected digest must identify the AgentRequest source revision.",
    );
    error.code = "SKILL_REPAIR_EXPECTED_DIGEST_MISMATCH";
    throw error;
  }

  return source;
}

export function repairIdempotencyKey(requestId, operation) {
  return `agent-repair:${hash(requestId).slice(0, 24)}:${operation}`;
}

export function repairTransportRequestId(ownerId, operation) {
  return (
    `owl-mcp-repair:${hash(ownerId).slice(0, 12)}:${operation}:` +
    randomUUID()
  );
}

export function manifestDigestForRepair(manifest) {
  return hash(JSON.stringify(stableValue(manifest)));
}
