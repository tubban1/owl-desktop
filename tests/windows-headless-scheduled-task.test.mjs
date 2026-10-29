import {describe,expect,it} from "vitest";
import fs from "node:fs";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"..");
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");

describe("Windows scheduled maintenance stays out of the user's desktop",()=>{
  it("launches every periodic maintenance task with WScript, not a console exe",()=>{
    const ota=read("scripts/install-auto-ota.mjs");
    const stage=read("scripts/install-version-stager.mjs");
    expect(ota).toContain('hidden-scheduled-task.vbs');
    expect(stage).toContain('hidden-scheduled-task.vbs');
    for(const source of [ota,stage]){
      expect(source).toContain('wscript.exe');
      expect(source).toContain('//B //Nologo');
    }
    expect(ota).not.toContain('powershell.exe -NoProfile -ExecutionPolicy Bypass -File');
    expect(stage).not.toContain('const command=\'"\'+process.execPath');
  });

  it("uses a hidden wait-and-propagate launcher for heartbeat/watch/promote/stage",()=>{
    const vbs=read("scripts/windows/hidden-scheduled-task.vbs");
    for(const mode of ["heartbeat","watch","promote","stage","cutover"])
      expect(vbs).toContain('Case "'+mode+'"');
    expect(vbs).toContain("shell.Run(command, 0, True)");
    expect(vbs).toContain("WScript.Quit result");
    expect(vbs).toContain("If args.Count <> 5 Then WScript.Quit 87");
    expect(vbs).toContain("If Not IsSha(CStr(args.Item(4))) Then WScript.Quit 87");
    expect(vbs).toContain("If Not IsReleaseRoot(CStr(args.Item(1))) Then WScript.Quit 87");
  });

  it("keeps one-shot cutover unattended and preserves expected version checks",()=>{
    const updater=read("scripts/auto-version-updater.mjs");
    expect(updater).toContain("ROLL_WIN_HEADLESS_LAUNCHER_MISSING");
    expect(updater).toContain("cutover");
    expect(updater).toContain("New-ScheduledTaskAction -Execute '+q(host)");
    expect(updater).not.toContain('New-ScheduledTaskAction -Execute "powershell.exe"');
    expect(updater).toContain("Register-ScheduledTask");
  });
});
