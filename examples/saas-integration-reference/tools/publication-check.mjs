import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
const allowed=new Set([
 "README.md","SECURITY.md","LICENSE",".gitignore","package.json","manifest.json",
 "lib/context-guard.cjs","extension/content.js","demo/index.html",
 "demo/server.mjs","demo/client.js","tests/context-guard.test.mjs","tools/publication-check.mjs"
]);
const forbiddenPaths=/(^|\/)(?:\.env(?:\.|$)|cookies?|auth|sessions?|credentials?|\.ssh|\.git)(?:\/|$)|\.(?:pem|p12|pfx|db|sqlite|har|key)$/i;
const forbiddenContents=[
 /et818\.com/i,/\/ZJLY\//i, /ASP\.NET_SessionId/i, /\bPlanRegId\b/i,
 /\/Users\//, /liang\.rao@/i,/gmail\.com/i,
 /(?:ghp|github_pat|sk-proj|sk_live)_[A-Za-z0-9_-]{10,}/i,
 /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/
];
const files=execFileSync("git",["ls-files","--cached"],{encoding:"utf8"})
 .split("\n").filter(Boolean);
let problems=[];
for (const file of files) {
 if (!allowed.has(file) || forbiddenPaths.test(file)) problems.push("UNEXPECTED_PATH:"+file);
 if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink())problems.push("NOT_REGULAR:"+file);
 else {
  const data=fs.readFileSync(file,"utf8");
  for(const pattern of forbiddenContents) if(pattern.test(data))
   problems.push("FORBIDDEN_CONTENT:"+file+":"+pattern.source);
 }
}
if(files.length!==allowed.size)problems.push("MISSING_FILES:"+[...allowed].filter(x=>!files.includes(x)).join(","));
if(problems.length){console.error("PUBLICATION_BLOCKED\n"+problems.join("\n"));process.exit(1);}
console.log("PUBLICATION_SAFE_SCOPE_CHECK_PASSED: "+files.length+" allowlisted files, no forbidden code/data patterns");
