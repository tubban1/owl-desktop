import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * One restricted, OS-sandboxed Codex continuation for the user-approved
 * botanical32 art mission. Generic shell execution remains denied.
 */
function reject(code, message=code) {
  const e=new Error(message); e.code=code; throw e;
}
const real=p=>fs.realpathSync(p);
const shQuote=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
function sbQuote(p) {
  if(typeof p!=="string"||/[\0\r\n"\\]/.test(p)) reject("MISSION_SANDBOX_PATH_UNSAFE");
  return '"'+p+'"';
}
export function compileApprovedCodexResume(owner, args, {
  platform=process.platform,
  userHome=os.homedir(),
  codexBin=path.join(userHome,".codex/plugins/.plugin-appserver/codex-cli/bin/codex"),
  sandboxExecutable="/usr/bin/sandbox-exec",
}={}) {
  if(platform!=="darwin"||!fs.existsSync(sandboxExecutable))
    reject("MISSION_SANDBOX_UNAVAILABLE","Verified macOS Seatbelt is required.");
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.thread_id||""))
    reject("MISSION_CODEX_THREAD_INVALID");
  const mission=owner?.workstream?.missionContract;
  const worktree=owner?.checkpoint?.workspace?.worktree;
  if(!mission||typeof worktree!=="string"||
    !/Bloomroom botanical32/i.test(mission.originalGoal||"")||
    !mission.prohibitedChanges?.some(s=>s.includes(".tmp/botanical32-quality/art-directed"))||
    !mission.prohibitedChanges?.some(s=>s.includes("public/models")))
    reject("MISSION_CODEX_PROFILE_NOT_AUTHORIZED");
  const root=real(worktree);
  if(root!==real(args.cwd)||!root.endsWith("/.tmp/botanical32-assessment-20261028/worktree"))
    reject("MISSION_CODEX_WORKTREE_MISMATCH");
  const art=real(path.join(root,".tmp/botanical32-quality/art-directed"));
  const reports=real(path.join(art,"reports"));
  if(path.basename(args.instruction_file)!=="CODEX_R3_ART_REWORK_ORDER_20261029.md"||
     real(path.dirname(args.instruction_file))!==reports||
     real(args.instruction_file)!==path.join(reports,"CODEX_R3_ART_REWORK_ORDER_20261029.md"))
    reject("MISSION_CODEX_INSTRUCTION_OUTSIDE_SCOPE");
  const fileStat=fs.lstatSync(args.instruction_file);
  if(!fileStat.isFile()||fileStat.isSymbolicLink())
    reject("MISSION_CODEX_INSTRUCTION_FILE_INVALID");
  const brief=fs.readFileSync(args.instruction_file,"utf8");
  if(!brief.includes("Garden Rose")||!brief.includes("No edits to"))
    reject("MISSION_CODEX_INSTRUCTION_INCOMPLETE");
  const output=real(path.join(art,"r3"));
  if(output!==path.join(art,"r3")) reject("MISSION_CODEX_OUTPUT_SYMLINK");
  const tmp=real(path.join(output,".codex-tmp"));
  if(tmp!==path.join(output,".codex-tmp")) reject("MISSION_CODEX_TMP_SYMLINK");
  const home=real(userHome);
  const cli=real(codexBin);
  if(!cli.startsWith(path.join(home,".codex/plugins/.plugin-appserver/"))||
     !fs.statSync(cli).isFile())
     reject("MISSION_CODEX_BINARY_UNTRUSTED");
  const sessionPaths=[
    path.join(home,".codex","sessions"),
    path.join(home,".codex","log"),
  ].filter(fs.existsSync).map(real);
  const allowed=[
    "(version 1)","(deny default)","(allow process*)",
    "(allow file-read*)","(allow mach-lookup)","(allow network*)",
    "(allow file-write* (subpath "+sbQuote(output)+"))",
    ...sessionPaths.map(p=>"(allow file-write* (subpath "+sbQuote(p)+"))"),
    '(allow file-write* (literal "/dev/null"))',
  ];
  const policy=allowed.join(" ");
  const prompt="Continue the original botanical32 art rework session. Read "+
    args.instruction_file+" completely. Only write NEW outputs inside "+output+
    ", never modify old reports/candidates/evidence, production models, product app or any other project. "+
    "No push/merge/deploy, no purchases, no Blender/Next/browser. "+
    "If permissions or quota prevent completion, record status and stop without retry. "+
    "Do not claim artistic pass; OWL independently renders and tests.";
  const command=[
    "env","TMPDIR="+shQuote(tmp+"/"),"TMP="+shQuote(tmp),"TEMP="+shQuote(tmp),
    sandboxExecutable,"-p",shQuote(policy),shQuote(codexBin),
    "exec","resume","--json",shQuote(args.thread_id),shQuote(prompt)
  ].join(" ");
  return {command,cwd:root,workspace_mode:"write",
    sandbox:{policy,writeDir:output,metadataPaths:sessionPaths},
    threadId:args.thread_id,instructionFile:args.instruction_file};
}
