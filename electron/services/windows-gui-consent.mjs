import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";

// Consent exists ONLY in this user's Desktop settings, never as a remote
// MCP/Agent tool operation. Defaults to off on every new device.
export const WINDOWS_GUI_MODES=Object.freeze([
  "off", "inspect", "semantic", "foreground",
]);
export function normalizeWindowsGuiMode(input) {
  return WINDOWS_GUI_MODES.includes(input) ? input : "off";
}
export function assertWindowsGuiMode(input) {
  if (!WINDOWS_GUI_MODES.includes(input))
    throw Error("WINDOWS_GUI_MODE_INVALID");
  return input;
}
export function inspectWindowsGuiHelper(executable) {
  try {
    if(typeof executable!=="string" || !path.isAbsolute(executable) ||
      path.basename(executable).toLowerCase()!=="owlhelper.exe")
      return {verified:false,reason:"WINDOWS_GUI_HELPER_INVALID_PATH"};
    if(!fs.existsSync(executable) || fs.lstatSync(executable).isSymbolicLink() ||
      !fs.statSync(executable).isFile())
      return {verified:false,reason:"WINDOWS_GUI_HELPER_NOT_INSTALLED"};
    const receiptPath=path.join(path.dirname(executable),"component.json");
    const proof=JSON.parse(fs.readFileSync(receiptPath,"utf8").replace(/^\uFEFF/,""));
    const digest=createHash("sha256").update(fs.readFileSync(executable)).digest("hex");
    if(proof.component!=="owl-windows-gui-helper" ||
       proof.architecture!=="win32-x64" || proof.sha256!==digest)
      return {verified:false,reason:"WINDOWS_GUI_HELPER_INTEGRITY_FAILED"};
    return {verified:true,reason:null,kind:proof.kind||"unknown"};
  }catch{
    return {verified:false,reason:"WINDOWS_GUI_HELPER_INTEGRITY_FAILED"};
  }
}
export function windowsGuiRuntimeFlags(mode,helperProof={verified:false}) {
  const requested=normalizeWindowsGuiMode(mode);
  const effective=helperProof.verified===true?requested:"off";
  return {
    requested,
    effective,
    ALLOW_GUI:effective!=="off"?"true":"false",
    OWL_WIN_GUI_INPUT:effective==="semantic"||effective==="foreground"?"true":"false",
    OWL_WIN_GUI_FOREGROUND_INPUT:effective==="foreground"?"true":"false",
    helperVerified:helperProof.verified===true,
    reason:helperProof.reason??null,
  };
}
export function windowsGuiConsentCopy(mode) {
  assertWindowsGuiMode(mode);
  const details={
    off:"Disable Windows UI inspection and all native GUI input.",
    inspect:"Permit window information, UI tree and screenshots. Do not allow clicks or text changes.",
    semantic:"Permit Windows UI Automation Invoke/Toggle/Select and edit ValuePattern, without native pointer/keyboard takeover. Some controls may refuse these background actions.",
    foreground:"Permit everything in Semantic plus SendInput keyboard and physical mouse movement when UI Automation cannot act. This may steal focus and interfere with your current task. Never overrides UAC/secure desktop.",
  };
  return {title:"OWL Windows desktop control",message:"Change Windows native GUI mode to "+mode+"?",detail:details[mode]+" The permission is local to this device. The managed Runtime must restart before it becomes active."};
}
