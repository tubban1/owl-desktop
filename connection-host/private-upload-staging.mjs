import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import {execFileSync} from "node:child_process";

// POSIX 0700 is not a Windows DACL. Never treat chmod/stat.mode as
// evidence of Windows file confidentiality.
export async function secureUploadStagingRoot(root){
  await fs.mkdir(root,{recursive:true,mode:0o700});
  const stat=await fs.lstat(root);
  if(!stat.isDirectory()||stat.isSymbolicLink())
    throw Error("UPLOAD_STAGING_ROOT_NOT_PRIVATE");
  if(process.platform!=="win32"){
    if((stat.mode&0o077)!==0 ||
      (process.getuid&&stat.uid!==process.getuid()))
      throw Error("UPLOAD_STAGING_ROOT_NOT_PRIVATE");
    return;
  }
  try {
    const sids=execFileSync("whoami.exe",["/user","/fo","csv","/nh"],
      {encoding:"utf8",timeout:8000,maxBuffer:65536});
    const owner=sids.match(/S-\d+(?:-\d+)+/)?.[0];
    if(!owner)throw Error("WINDOWS_SID_MISSING");
    // Set an explicit DACL; don't inherit broad Users/Everyone access
    // from the Windows TEMP parent. Preserve SYSTEM and Administrators.
    const trusted=[owner,"S-1-5-18","S-1-5-32-544"];
    execFileSync("icacls.exe",[root,"/inheritance:r",
      "/grant:r",...trusted.map(x=>"*"+x+":(OI)(CI)F")],
      {timeout:10000,windowsHide:true,maxBuffer:65536});
    // Fail closed if an untrusted explicit ACE was already attached to the
    // staging root, or if protection failed. No parsing localized icacls text.
    const verify=[
      "$ErrorActionPreference='Stop'",
      "$acl=Get-Acl -LiteralPath $args[0]",
      "if(-not $acl.AreAccessRulesProtected){exit 21}",
      "$trusted=@($args[1], 'S-1-5-18', 'S-1-5-32-544')",
      "foreach($ace in $acl.Access){",
      "try{$sid=$ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value}",
      "catch{exit 22}",
      "if($sid -notin $trusted){exit 23}",
      "}",
      "exit 0"
    ].join(";");
    execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",verify,root,owner],
      {timeout:15000,windowsHide:true,maxBuffer:65536});
  }catch{
    throw Error("UPLOAD_STAGING_ROOT_NOT_PRIVATE");
  }
}
