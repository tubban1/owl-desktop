import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startWindowsDevNativeBrowser } from "../electron/services/windows-dev-native-browser.mjs";
const roots=[];
afterEach(async () => {
  for(const dir of roots.splice(0))await fs.rm(dir,{recursive:true,force:true});
});
describe("Windows DEV reuses macOS Native Messaging bridge",()=>{
  it("cannot start in a Mac build, Windows package or without opt-in", async()=>{
    const brokerFactory=vi.fn();
    for(const input of [
      {platform:"darwin",enabled:true},
      {platform:"win32",packaged:true,enabled:true},
      {platform:"win32",enabled:false}
    ]){
      expect(await startWindowsDevNativeBrowser({...input,brokerFactory})).toBeNull();
    }
    expect(brokerFactory).not.toHaveBeenCalled();
  });
  it("fails closed when the broker cannot enforce Windows ACL", async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),"owl-win-native-reject-"));
    roots.push(root);
    const brokerFactory=vi.fn();
    await expect(startWindowsDevNativeBrowser({
      platform:"win32",enabled:true,userDataRoot:root,
      protectAcl:()=>{throw Error("ACL_DENIED");},brokerFactory
    })).rejects.toThrow("ACL_DENIED");
    expect(brokerFactory).not.toHaveBeenCalled();
  });
  it("starts private loopback broker, exposes native bridge, and closes only its broker",async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),"owl-win-native-"));
    roots.push(root);
    const acl=vi.fn();
    const close=vi.fn(async()=>{});
    const brokerFactory=vi.fn(async opts => ({
      configPath:opts.configPath,
      request:vi.fn(async()=>({foo:"bar"})),
      status:vi.fn(()=>({connected:false,transport:"chrome-native-messaging"})),
      close,
    }));
    const agent=await startWindowsDevNativeBrowser({
      platform:"win32",packaged:false,enabled:true,userDataRoot:root,
      protectAcl:acl,brokerFactory,
      uploadFactory:()=>({close:vi.fn(),capabilities:()=>({uploadFile:true})})
    });
    expect(agent.configPath.endsWith(path.join("native-chrome","broker.json"))).toBe(true);
    expect(brokerFactory).toHaveBeenCalledWith({port:8795,configPath:agent.configPath});
    expect(acl).toHaveBeenCalledWith(path.dirname(agent.configPath),"dir");
    expect(acl).toHaveBeenCalledWith(agent.configPath,"file");
    expect(agent.bridge.status()).toMatchObject({connected:false});
    expect(agent.bridge.capabilities().transport).toBe("chrome-native-messaging");
    await agent.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
