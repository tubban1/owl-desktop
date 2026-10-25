/** Canonical, domain-separated Desktop human consent for a single OWL mission. */
import fs from "node:fs";
import path from "node:path";
import { createHash, createPublicKey, verify } from "node:crypto";

export function missionApprovalScope(owner) {
  const mission = owner?.workstream?.missionContract;
  if (!mission || !owner?.workstream?.workstreamId) return null;
  const root = owner?.checkpoint?.workspace?.worktree;
  return {
    domain: "OWL_MISSION_APPROVAL_V1",
    workstreamId: owner.workstream.workstreamId,
    originalGoal: mission.originalGoal,
    allowedRepositories: mission.allowedRepositories ?? [],
    prohibitedChanges: mission.prohibitedChanges ?? [],
    acceptanceCriteria: mission.acceptanceCriteria ?? [],
    // Never bind to an arbitrary caller-supplied path at execution time.
    workspaceRoot: typeof root === "string" ? path.resolve(root) : null,
  };
}

export function missionApprovalMessage(scope) {
  return JSON.stringify(scope);
}

export function missionApprovalDigest(scope) {
  return createHash("sha256").update(missionApprovalMessage(scope)).digest("hex");
}

export function missionApprovalStatus(owner, signerRecordFile, publicKeyOverride = null) {
  const mission = owner?.workstream?.missionContract;
  const scope = missionApprovalScope(owner);
  if (!scope) return { approved: false, reason: "MISSION_NOT_FOUND" };
  const proof = mission?.approval;
  if (!proof || typeof proof?.signature !== "string") {
    return { approved: false, reason: "MISSION_APPROVAL_REQUIRED", scope };
  }
  if (proof.digest !== missionApprovalDigest(scope) || !scope.workspaceRoot ||
      scope.allowedRepositories.length === 0 ||
      !scope.allowedRepositories.includes(path.basename(scope.workspaceRoot))) {
    return { approved: false, reason: "MISSION_SCOPE_CHANGED", scope };
  }
  try {
    const keyB64 = publicKeyOverride ??
      JSON.parse(fs.readFileSync(signerRecordFile, "utf8")).publicKeyB64;
    const key = createPublicKey({ key: Buffer.from(keyB64, "base64"), format: "der", type: "spki" });
    const good = verify(null, Buffer.from(missionApprovalMessage(scope), "utf8"), key,
      Buffer.from(proof.signature, "base64"));
    return { approved: good, reason: good ? "USER_CONFIRMED" : "MISSION_SIGNATURE_INVALID", scope };
  } catch {
    return { approved: false, reason: "MISSION_SIGNATURE_UNAVAILABLE", scope };
  }
}

export function withinMissionRoot(root, target) {
  if (typeof root !== "string" || typeof target !== "string" || !path.isAbsolute(target)) return false;
  try {
    const normalizedRoot = fs.realpathSync(root);
    let candidate = path.resolve(target);
    const suffix = [];
    while (!fs.existsSync(candidate)) {
      const parent = path.dirname(candidate);
      if (parent === candidate) return false;
      suffix.unshift(path.basename(candidate));
      candidate = parent;
    }
    const realTarget = path.resolve(fs.realpathSync(candidate), ...suffix);
    return realTarget === normalizedRoot || realTarget.startsWith(normalizedRoot + path.sep);
  } catch {
    return false;
  }
}

/**
 * Conservative opt-in action gate. Raw shell/task execution is not sandboxed
 * and must not be represented as scoped simply because cwd is in a repo.
 */
export function assertMissionAction(owner, signerRecordFile, toolName, args, publicKeyOverride = null) {
  const c = owner?.workstream?.missionContract;
  if (!c || !Array.isArray(c.allowedRepositories) || c.allowedRepositories.length === 0) return;
  const status = missionApprovalStatus(owner, signerRecordFile, publicKeyOverride);
  if (!status.approved) {
    const err = new Error("MISSION_APPROVAL_REQUIRED: review the exact mission in OWL Desktop before modifying this project (" + status.reason + ").");
    err.code = "MISSION_APPROVAL_REQUIRED";
    throw err;
  }
  const root = status.scope.workspaceRoot;
  const confined = {
    write_file: [args.path],
    edit_file: [args.path],
    batch_edit_files: (args.edits ?? []).map(x => x.path),
    create_directory: [args.path],
    git_add: [args.cwd, ...(args.paths ?? []).map(x => path.resolve(args.cwd, x))],
    git_commit: [args.cwd],
    git_pull: [args.cwd],
    git_push: [args.cwd],
  };
  if (!Object.hasOwn(confined, toolName)) {
    const err = new Error("MISSION_OPAQUE_ACTION_BLOCKED: action effects cannot be verified as inside the approved mission. Use structured tools or obtain separate execution authority.");
    err.code = "MISSION_OPAQUE_ACTION_BLOCKED";
    throw err;
  }
  const targets = confined[toolName];
  if (targets.length === 0 || targets.some(t => !withinMissionRoot(root, t))) {
    const err = new Error("MISSION_SCOPE_VIOLATION: action targets exceed the Desktop-confirmed workspace root.");
    err.code = "MISSION_SCOPE_VIOLATION";
    throw err;
  }
}
