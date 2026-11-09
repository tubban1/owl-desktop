import {describe,it,expect,vi,afterEach} from "vitest";
import {withNativeCommandDeadline} from "../chrome-agent-native/command-watchdog.mjs";
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.doUnmock("../chrome-agent-native/agent-executor.mjs");});
const flush=()=>Promise.resolve().then(()=>Promise.resolve()).then(()=>Promise.resolve());
describe("Native command deadline and worker recovery",()=>{
  it("passes prompt results and propagates ordinary failures",async()=>{
    vi.useFakeTimers();
    await expect(withNativeCommandDeadline(async()=>42)).resolves.toBe(42);
    await expect(withNativeCommandDeadline(async()=>{throw Error("NO_ACCESS")}))
      .rejects.toThrow("NO_ACCESS");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects a never-resolving Chrome API at the bounded deadline",async()=>{
    vi.useFakeTimers();
    const task=withNativeCommandDeadline(()=>new Promise(()=>{}),100);
    const rejected=expect(task).rejects.toMatchObject({code:"AGENT_NATIVE_COMMAND_STALLED"});
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("returns explicit error to Native Host, checkpoints ownership then reloads only its extension",async()=>{
    vi.useFakeTimers();
    const messages=[],listeners={};
    const owned={"35":{owner:"owner-qa",adopted:false}};
    const selected={"owner-qa":35};
    const store={owlNativeOwned:owned,owlNativeSelected:selected};
    const persisted={};
    let reloads=0,executed=0;
    const port={
      postMessage(m){messages.push(m)},
      onMessage:{addListener(fn){listeners.command=fn}},
      onDisconnect:{addListener(fn){listeners.disconnect=fn}}
    };
    const chrome={
      runtime:{
        connectNative:()=>port,
        reload:()=>{reloads++},
        onInstalled:{addListener(){}},onStartup:{addListener(){}},
        onMessage:{addListener(){}}
      },
      alarms:{create(){},onAlarm:{addListener(){}}},
      tabs:{onRemoved:{addListener(){}}},
      storage:{
        session:{get:async()=>store},
        local:{set:async v=>Object.assign(persisted,v)}
      }
    };
    vi.stubGlobal("chrome",chrome);
    vi.doMock("../chrome-agent-native/agent-executor.mjs",()=>({
      createNativeAgentExecutor:()=>({
        run:async message=>{
          executed++;
          if(message.op==="hang")return new Promise(()=>{});
          return {responsive:true};
        },
        tabRemoved:async()=>{}
      })
    }));
    vi.resetModules();
    await import("../chrome-agent-native/service-worker.mjs");
    listeners.command({type:"command",id:"c1",owner:"owner-qa",op:"hang"});
    listeners.command({type:"command",id:"c2",owner:"owner-qa",op:"extension_info"});
    await flush();
    expect(messages.filter(m=>m.type==="command_received")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(16_000);
    await flush();
    expect(messages.find(m=>m.id==="c1"&&m.type==="result")).toMatchObject({
      ok:false,error:"AGENT_NATIVE_COMMAND_STALLED"
    });
    expect(messages.find(m=>m.id==="c2"&&m.type==="result")).toMatchObject({
      ok:false,error:"EXTENSION_RELOAD_IN_PROGRESS"
    });
    expect(executed).toBe(1);
    expect(persisted.owlNativeReloadCheckpoint).toMatchObject({
      version:1,owned,selected
    });
    expect(reloads).toBe(1);
    expect(chrome.tabs.update).toBeUndefined();
    expect(chrome.windows).toBeUndefined();
  });
});
