import {describe,it,expect} from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {auditAgentBrowserInstall,EXTENSION_ID} from "../scripts/lib/agent-browser-install-audit.mjs";

async function withChromeFixture(fn){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"owl-browser-install-audit-"));
  const chrome=path.join(root,"Chrome");
  const source=path.join(root,"expected");
  const installed=path.join(root,"installed");
  await Promise.all([fs.mkdir(chrome),fs.mkdir(source),fs.mkdir(installed)]);
  const files=["manifest.json","service-worker.mjs","agent-executor.mjs",
    "download-workflow.mjs","p2-capabilities.mjs","p2-interactions.mjs","file-inputs.mjs","file-drop-zone.mjs","rich-editor.mjs","virtual-cursor.mjs"];
  for(const f of files){
    await fs.writeFile(path.join(source,f),f+" expected bytes");
    await fs.writeFile(path.join(installed,f),f+" expected bytes");
  }
  const profile=path.join(chrome,"Profile 4");await fs.mkdir(profile);
  const setSource=async pathValue=>fs.writeFile(path.join(profile,"Secure Preferences"),
    JSON.stringify({extensions:{settings:{[EXTENSION_ID]:{path:pathValue,location:4,manifest:{version:"0.2.0"}}}}}));
  try{await fn({chrome,source,installed,files,setSource});}
  finally{await fs.rm(root,{recursive:true,force:true});}
}
describe("Chrome Agent Browser install drift check",()=>{
  it("matches unpacked source without falsely claiming a live reload",async()=>{
    await withChromeFixture(async({chrome,source,installed,files,setSource})=>{
      await setSource(installed);
      const a=await auditAgentBrowserInstall({chromeRoot:chrome,expectedRoot:source});
      expect(a).toMatchObject({installed:true,ready:true,reloadVerified:false});
      expect(a.profiles[0]).toMatchObject({profile:"Profile 4",matched:files.length,ready:true});
    });
  });
  it("reports absent P2 module in a stale local Chrome installation",async()=>{
    await withChromeFixture(async({chrome,source,installed,setSource})=>{
      await setSource(installed);await fs.rm(path.join(installed,"p2-interactions.mjs"));
      const a=await auditAgentBrowserInstall({chromeRoot:chrome,expectedRoot:source});
      expect(a.ready).toBe(false);
      expect(a.profiles[0].mismatched).toContain("p2-interactions.mjs");
      expect(a.profiles[0].reason).toBe("EXTENSION_SOURCE_STALE");
    });
  });
  it("is read-only and handles absent profiles without guessing installation",async()=>{
    await withChromeFixture(async({chrome,source})=>{
      const a=await auditAgentBrowserInstall({chromeRoot:chrome,expectedRoot:source});
      expect(a).toMatchObject({installed:false,ready:false,reason:"AGENT_BROWSER_NOT_INSTALLED"});
    });
  });
});
