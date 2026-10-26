import {describe,it,expect} from "vitest";
import {readFile} from "node:fs/promises";
import {windowsDevWorkspacePermissions} from "../electron/services/windows-dev-runtime.mjs";

describe("Windows DEV opt-in workspace permissions",()=>{
  it("is closed by default and cannot enable with casual truthy values",()=>{
    for(const flag of [undefined,"false","1","TRUE","yes"]){
      const p=windowsDevWorkspacePermissions(flag===undefined?{}:{OWL_WIN_DEV_WORKSPACE_ACCESS:flag});
      expect(p).toMatchObject({ALLOW_WRITE:"false",ALLOW_SHELL:"false",
        ALLOW_GIT_PUSH:"false",ALLOW_DELETE:"false",ALLOW_ROLLBACK:"false"});
      expect(p.OWL_SCOPED_CAPABILITIES).toBeUndefined();
    }
  });
  it("explicit user-opt-in enables workspace Git/write without unrestricted shell or delete",()=>{
    const p=windowsDevWorkspacePermissions({OWL_WIN_DEV_WORKSPACE_ACCESS:"true"});
    expect(p).toMatchObject({
      ALLOW_WRITE:"true",ALLOW_GIT_PUSH:"true",ALLOW_SHELL:"false",
      ALLOW_DELETE:"false",ALLOW_ROLLBACK:"false",
      OWL_APPROVAL_MODE:"enforce",OWL_HUMAN_APPROVAL_ENFORCE:"1",
      OWL_SCOPED_CAPABILITIES:"1"
    });
    for(const action of ["shell.exec","shell.start","shell.input",
      "shell.kill","fs.delete","tx.rollback"]){
      expect(p.OWL_SCOPED_ACTION_ALLOWLIST.split(",")).toContain(action);
      expect(p.OWL_APPROVAL_ACTIONS.split(",")).toContain(action);
    }
  });
  it("DEV launcher does not silently grant permission to all Windows users",async()=>{
    const source=await readFile(new URL("../scripts/windows/dev-desktop.ps1",import.meta.url),"utf8");
    expect(source).toContain('$env:OWL_WIN_DEV_WORKSPACE_ACCESS -eq "true"');
    expect(source).not.toMatch(/\$env:OWL_WIN_DEV_WORKSPACE_ACCESS\s*=\s*["']true["']/);
    const runtime=await readFile(new URL("../electron/services/windows-dev-runtime.mjs",import.meta.url),"utf8");
    expect(runtime).toContain('...windowsDevWorkspacePermissions()');
    expect(runtime).toContain('OWL_WIN_DEV_MANAGE_RUNTIME!=="true"');
    expect(runtime).toContain('ALLOW_BROWSER:"false"');
  });
});
