import {describe,it,expect} from "vitest";
import {createNativeAgentExecutor} from "../chrome-agent-native/agent-executor.mjs";
import {inspectP2Capabilities} from "../chrome-agent-native/p2-capabilities.mjs";

describe("P2 owner-isolated capability probe",()=>{
  it("does not probe another owner's tab",async()=>{
    const store={};let probeCalls=0;
    const storage={get:async k=>({[k]:store[k]}),set:async o=>Object.assign(store,o)};
    const chrome={tabs:{query:async()=>[],create:async o=>({id:17,url:o.url}),get:async id=>({id,url:"https://example.org"})},scripting:{executeScript:async ({func})=>{probeCalls++;expect(func).toBe(inspectP2Capabilities);return [{result:{origin:"https://example.org",counts:{frames:0}}}];}}};
    const x=createNativeAgentExecutor(chrome,storage);
    await x.run({owner:"owner-A",op:"open",args:{url:"https://example.org"}});
    await expect(x.run({owner:"owner-B",op:"p2_capabilities"})).rejects.toThrow("AGENT_TAB_NOT_OWNED");
    expect(probeCalls).toBe(0);
    expect(await x.run({owner:"owner-A",op:"p2_capabilities"})).toMatchObject({pageId:17,origin:"https://example.org",counts:{frames:0}});
    expect(probeCalls).toBe(1);
  });
});
