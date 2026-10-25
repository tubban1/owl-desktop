// One-time Windows *development* Desktop/Runtime token link.
// Run as an Electron entry point, NOT as regular node. No token bytes are logged.
// This does not grant Cloud device access or register a production Windows service.
import fs from "node:fs";
import path from "node:path";
import {app,safeStorage} from "electron";
import {DesktopStore} from "../../electron/store.mjs";

const flag=name=>{
  const idx=process.argv.indexOf(name);
  return idx>=0?process.argv[idx+1]:null;
};
async function main(){
  if(process.platform!=="win32")throw Error("WINDOWS_TOKEN_BOOTSTRAP_ONLY");
  const tokenFile=flag("--token-file"),root=flag("--desktop-data-root");
  if(!tokenFile||!root)throw Error("TOKEN_FILE_AND_DESKTOP_ROOT_REQUIRED");
  const tokenPath=path.resolve(tokenFile),dataRoot=path.resolve(root);
  const base=path.resolve(process.env.APPDATA||"");
  if(dataRoot!==path.join(base,"OWL LAB","desktop"))
    throw Error("DESKTOP_DATA_ROOT_NOT_EXPECTED");
  // The encrypted secret is bound to Electron's profile key on Windows.
  // Set userData BEFORE app.whenReady() so this bootstrap uses the exact
  // same OS encryption profile as the real OWL Desktop process.
  app.setPath("userData",dataRoot);
  const raw=fs.readFileSync(tokenPath,"utf8").trim();
  if(!/^[A-Za-z0-9_-]{40,80}$/.test(raw))throw Error("TOKEN_FORMAT_INVALID");
  await app.whenReady();
  if(!safeStorage.isEncryptionAvailable())throw Error("WINDOWS_DPAPI_NOT_AVAILABLE");
  const store=new DesktopStore({root:dataRoot});
  store.upsertSecret({name:"OWL_RUNTIME_API_TOKEN",project:"owl-runtime",value:raw});
  if(store.readSecret("OWL_RUNTIME_API_TOKEN","owl-runtime")!==raw)
    throw Error("WINDOWS_DESKTOP_TOKEN_VERIFICATION_FAILED");
  console.log(JSON.stringify({ok:true,osEncryption:true,project:"owl-runtime",
    runtimeApiTokenConfigured:true,tokenLogged:false}));
  app.quit();
}
main().catch(error=>{
  console.error("Windows development token provisioning failed: "+error.message);
  app.exit(1);
});
