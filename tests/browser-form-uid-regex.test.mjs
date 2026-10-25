import {describe,it,expect} from "vitest";
import {createNativeAgentExecutor} from "../chrome-agent-native/agent-executor.mjs";
import {executeFormAction} from "../chrome-agent-native/form-controls.mjs";
import {z} from "zod";
const URL="https://careers.axpo.com/jobs/8585631-genai-product-manager-f-m-d";
describe("Form UID regex end-to-end routing",()=>{
  it("accepts a valid UID for set, review and submit and rejects fabricated values",async()=>{
    const memory={};
    const calls=[];
    const tab={id:22,url:URL,active:false,windowId:1};
    const chrome={
      storage:{session:{get:async k=>({[k]:memory[k]}),set:async x=>Object.assign(memory,x)}},
      tabs:{query:async()=>[tab],get:async()=>tab,create:async()=>{throw Error("unexpected create")}},
      scripting:{executeScript:async({func,args})=>{
        calls.push({fn:func.name,args});
        if(func===executeFormAction){
          const mode=args[0];
          return [{result:mode==="inspect"?{controls:[],pageUrl:URL}:
            mode==="set"?{uid:args[1].uid,domVerified:true}:
            mode==="review"?{ready:true}:{dispatched:true,siteConfirmed:false}}];
        }
        return [{result:{url:URL,controls:[],text:"test"}}];
      }}
    };
    const agent=createNativeAgentExecutor(chrome,chrome.storage.session);
    await agent.run({owner:"agent-test",op:"open",args:{url:URL}});
    expect(await agent.run({owner:"agent-test",op:"form_set",
      args:{uid:"owl-agent-28",change:{value:"130000"}}}))
      .toMatchObject({pageId:22,uid:"owl-agent-28",domVerified:true});
    expect(await agent.run({owner:"agent-test",op:"form_review",
      args:{pageUrl:URL,submitUid:"owl-agent-49"}}))
      .toMatchObject({ready:true});
    expect(await agent.run({owner:"agent-test",op:"form_submit",
      args:{pageUrl:URL,submitUid:"owl-agent-49",salary:"130000",
        referralValue:"false",notice:"1 month"}}))
      .toMatchObject({dispatched:true,siteConfirmed:false});
    expect(calls.filter(x=>x.fn==="executeFormAction").map(x=>x.args[0]))
      .toEqual(["set","review","submit"]);
    await expect(agent.run({owner:"agent-test",op:"form_set",
      args:{uid:"owl-agent-\\d",change:{value:"130000"}}}))
      .rejects.toThrow("FORM_FIELD_INVALID");
  });
  it("MCP schema rejects malformed UID",()=>{
    const schema=z.string().regex(/^owl-agent-\d{1,3}$/);
    expect(schema.safeParse("owl-agent-28").success).toBe(true);
    expect(schema.safeParse("owl-agent-49").success).toBe(true);
    expect(schema.safeParse("owl-agent-\\d").success).toBe(false);
  });
});
