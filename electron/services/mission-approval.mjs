/** Canonical, domain-separated Desktop human consent for a single OWL mission. */
import fs from "node:fs";
import path from "node:path";
import {compileApprovedMissionProcess, compileApprovedCodexResume}
  from "../../mcp/mission-execution-policy.mjs";
import { createHash, createPublicKey, verify } from "node:crypto";
import toolPathPolicy from "../../mcp/config/mission-tool-paths.json" with {type:"json"};

/**
 * The on-page permission toggles authorize a signed subset of the planner's
 * proposed execution permissions. The digest of the FULL proposal is included
 * so a previously-disabled grant cannot silently change after signing.
 */
export function selectMissionExecutionPermissions(scope, permissionIds) {
  if (!scope || !Array.isArray(permissionIds) || permissionIds.length > 8 ||
      permissionIds.some(id => typeof id !== "string" || !/^[\w.-]{1,100}$/.test(id)) ||
      new Set(permissionIds).size !== permissionIds.length) {
    throw Object.assign(new Error("MISSION_PERMISSION_SELECTION_INVALID"), {code:"MISSION_PERMISSION_SELECTION_INVALID"});
  }
  const proposed = scope.executionPermissions ?? [];
  if (permissionIds.some(id => !proposed.some(grant => grant.id === id))) {
    throw Object.assign(new Error("MISSION_PERMISSION_NOT_PROPOSED"), {code:"MISSION_PERMISSION_NOT_PROPOSED"});
  }
  const selected = proposed.filter(grant => permissionIds.includes(grant.id));
  const {workspaceRoot, executionPermissions: _ignored, ...base} = scope;
  return {
    ...base,
    ...(selected.length ? {executionPermissions:selected} : {}),
    executionPermissionProposalDigest:createHash("sha256").update(JSON.stringify(proposed)).digest("hex"),
    workspaceRoot,
  };
}

export function missionApprovalScope(owner, permissionIds = undefined) {
  const mission = owner?.workstream?.missionContract;
  if (!mission || !owner?.workstream?.workstreamId) return null;
  const root = owner?.checkpoint?.workspace?.worktree;
  const base = {
    domain: "OWL_MISSION_APPROVAL_V1",
    workstreamId: owner.workstream.workstreamId,
    originalGoal: mission.originalGoal,
    allowedRepositories: mission.allowedRepositories ?? [],
    prohibitedChanges: mission.prohibitedChanges ?? [],
    acceptanceCriteria: mission.acceptanceCriteria ?? [],
    // Add explicit grants only when present: preserves legacy mission
    // signatures but never silently upgrades their execution authority.
    ...(mission.executionPermissions?.length
      ? {executionPermissions:mission.executionPermissions}
      : {}),
    // Never bind to an arbitrary caller-supplied path at execution time.
    workspaceRoot: typeof root === "string" ? path.resolve(root) : null,
  };
  // A null argument explicitly requests the full proposed scope for UI review.
  // Undefined reads the stored selection for signature validation. Legacy
  // approvals with no selected-ID metadata retain their exact old scope.
  const ids = permissionIds === undefined ? mission.approval?.enabledPermissionIds : permissionIds;
  return Array.isArray(ids) ? selectMissionExecutionPermissions(base, ids) : base;
}

export function missionApprovalMessage(scope) {
  return JSON.stringify(scope);
}

export function missionApprovalDigest(scope) {
  return createHash("sha256").update(missionApprovalMessage(scope)).digest("hex");
}

export function missionApprovalStatus(owner, signerRecordFile, publicKeyOverride = null) {
  const mission = owner?.workstream?.missionContract;
  let scope;
  try {scope = missionApprovalScope(owner);}
  catch {return {approved:false,reason:"MISSION_PERMISSION_SELECTION_INVALID",scope:missionApprovalScope(owner,null)};}
  if (!scope) return { approved: false, reason: "MISSION_NOT_FOUND" };
  const proof = mission?.approval;
  if (proof?.revokedAt) return {approved:false,reason:"MISSION_APPROVAL_REVOKED",scope};
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
  const executableGrants = status.scope.executionPermissions ?? [];
  // A signed exact-command grant may be used via the cached start_process
  // client. Any changed command byte, cwd or mode fails closed.
  if(toolName==="start_process" && executableGrants.length){
    const matched=executableGrants.some(grant=>{
      try{
        const compiled=compileApprovedMissionProcess(owner,{permission_id:grant.id});
        return args?.command===compiled.command &&
          args?.cwd===compiled.cwd &&
          args?.workspace_mode===compiled.workspace_mode;
      }catch{return false;}
    });
    if(matched)return;
  }
  if(toolName==="mission_process_start"){
    compileApprovedMissionProcess(owner,{permission_id:args?.permission_id});
    return;
  }
  if(toolName==="mission_codex_resume"){
    compileApprovedCodexResume(owner,args);
    return;
  }
  // Structured path effects are declared in a separate versioned policy
  // manifest, not as repo/tool-specific grants inside executable code.
  const rules=toolPathPolicy.pathTargets?.[toolName];
  if(!Array.isArray(rules)||rules.length===0){
    const err=new Error("MISSION_OPAQUE_ACTION_BLOCKED: no signed execution grant or path-scoped tool policy.");
    err.code="MISSION_OPAQUE_ACTION_BLOCKED";
    throw err;
  }
  const select=(value,steps)=>{
    if(!steps.length)return [value];
    const [key,...rest]=steps;
    if(key==="*")
      return Array.isArray(value)?value.flatMap(x=>select(x,rest)):[];
    return value&&typeof value==="object"?select(value[key],rest):[];
  };
  const targets=rules.flatMap(selector=>{
    const [expression,base]=selector.split("@");
    return select(args,expression.split("."))
      .map(value=>base==="cwd"&&typeof value==="string"&&typeof args?.cwd==="string"
        ? path.resolve(args.cwd,value):value);
  });
  const root = status.scope.workspaceRoot;
  if (targets.length === 0 || targets.some(t => !withinMissionRoot(root, t))) {
    const err = new Error("MISSION_SCOPE_VIOLATION: action targets exceed the Desktop-confirmed workspace root.");
    err.code = "MISSION_SCOPE_VIOLATION";
    throw err;
  }
}
