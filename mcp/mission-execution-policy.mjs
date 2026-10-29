import fs from "node:fs";
import path from "node:path";

/**
 * A process may run only when its exact executable, argv, working directory,
 * write roots, and sandbox intent were included in a human-signed Mission.
 *
 * No repository name, user home, binary path, thread ID or allowlist is
 * embedded in this implementation. The runtime is default-deny.
 */
function deny(code, detail=code) {
  throw Object.assign(new Error(detail), {code});
}
const quoted=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
const text=value=>typeof value==="string"&&value.length>0&&value.length<=4096&&!value.includes("\0");
const inside=(root,target)=>target===root||target.startsWith(root+path.sep);
const real=value=>{
  if(!text(value)||!path.isAbsolute(value))deny("MISSION_PERMISSION_PATH_INVALID");
  try {return fs.realpathSync(value);} catch {deny("MISSION_PERMISSION_PATH_NOT_FOUND");}
};
const safeArg=value=>{
  if(!text(value)||value.length>2048||/[\r\n]/.test(value))deny("MISSION_EXEC_ARG_INVALID");
  return value;
};
const subsequence=(haystack,needles)=>{
  if(!needles.length)return false;
  return haystack.some((v,i)=>needles.every((arg,j)=>haystack[i+j]===arg));
};

export function executionGrant(owner, permissionId) {
  if(!text(permissionId)||!/^[\w.-]{1,100}$/.test(permissionId))
    deny("MISSION_PERMISSION_ID_INVALID");
  const mission=owner?.workstream?.missionContract;
  const grants=mission?.executionPermissions;
  // The user can sign fewer permissions than the planner proposed.
  const selected=mission?.approval?.enabledPermissionIds;
  if(Array.isArray(selected)&&!selected.includes(permissionId))
    deny("MISSION_EXEC_PERMISSION_NOT_GRANTED");
  const found=Array.isArray(grants)?grants.filter(grant=>grant?.id===permissionId):[];
  if(found.length!==1)deny("MISSION_EXEC_PERMISSION_NOT_GRANTED");
  return found[0];
}

export function compileApprovedMissionProcess(owner, {permission_id}={}) {
  const grant=executionGrant(owner, permission_id);
  const root=real(owner?.checkpoint?.workspace?.worktree);
  const signedRepositories=owner?.workstream?.missionContract?.allowedRepositories;
  if(!Array.isArray(signedRepositories)||!signedRepositories.includes(path.basename(root)))
    deny("MISSION_EXEC_WORKSPACE_NOT_APPROVED");
  const cwd=real(grant.cwd);
  if(!inside(root,cwd)||!fs.statSync(cwd).isDirectory())
    deny("MISSION_EXEC_WORKSPACE_VIOLATION");
  const executable=real(grant.executable);
  if(!fs.statSync(executable).isFile()||
      (fs.statSync(executable).mode & 0o111)===0)
    deny("MISSION_EXECUTABLE_UNTRUSTED");
  if(!Array.isArray(grant.argv)||grant.argv.length<1||grant.argv.length>64)
    deny("MISSION_EXEC_ARGV_REQUIRED");
  const argv=grant.argv.map(safeArg);
  const writableRoots=grant.writableRoots;
  if(!Array.isArray(writableRoots)||writableRoots.length>12)
    deny("MISSION_EXEC_WRITABLE_ROOTS_INVALID");
  const roots=writableRoots.map(p=>{
    const r=real(p);
    if(!inside(root,r)||!fs.statSync(r).isDirectory())
      deny("MISSION_EXEC_WRITE_SCOPE_VIOLATION");
    return r;
  });
  const workspaceMode=grant.workspaceMode;
  if(!["read","write"].includes(workspaceMode))
    deny("MISSION_EXEC_WORKSPACE_MODE_INVALID");
  if(workspaceMode==="write"&&(!roots.length||!roots.some(r=>inside(r,cwd))))
    deny("MISSION_EXEC_WRITE_SCOPE_VIOLATION");
  if(workspaceMode==="read"&&roots.length)
    deny("MISSION_EXEC_READONLY_HAS_WRITES");
  // A tool-native sandbox is not the same as kernel-level confinement.
  // Its invocation requirements must be present in the signed exact argv.
  // The OS/runtime must NOT claim unverified containment.
  const sandbox=grant.sandbox;
  if(!sandbox||sandbox.type!=="tool-native"||
    !Array.isArray(sandbox.requiredArgvSegments)||!sandbox.requiredArgvSegments.length)
    deny("MISSION_EXEC_SANDBOX_UNSPECIFIED");
  for(const segment of sandbox.requiredArgvSegments){
    if(!Array.isArray(segment)||!segment.length||segment.length>8||
       !subsequence(argv,segment.map(safeArg)))
      deny("MISSION_EXEC_SANDBOX_ARGUMENT_MISSING");
  }
  const command="exec "+[executable,...argv].map(quoted).join(" ");
  return {
    command,cwd,workspace_mode:workspaceMode,
    permissionId:permission_id,executable,argv,writableRoots:roots,
    sandboxType:sandbox.type,
  };
}

/** Legacy client adaptor: no embedded Codex ID, path or permission. */
export function compileApprovedCodexResume(owner, args={}) {
  const grants=owner?.workstream?.missionContract?.executionPermissions;
  const matching=(Array.isArray(grants)?grants:[]).filter(grant=>
    grant?.compatibility?.threadId===args.thread_id &&
    grant?.compatibility?.instructionFile===args.instruction_file &&
    grant?.cwd===args.cwd
  );
  if(matching.length!==1)deny("MISSION_EXEC_PERMISSION_NOT_GRANTED");
  return compileApprovedMissionProcess(owner,{permission_id:matching[0].id});
}
