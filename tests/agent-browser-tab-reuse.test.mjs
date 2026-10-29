import {describe,it,expect} from "vitest";
import {createNativeAgentExecutor} from "../chrome-agent-native/agent-executor.mjs";
import {locateVirtualCursorTarget,showVirtualCursor} from "../chrome-agent-native/virtual-cursor.mjs";

const target="https://careers.axpo.com/jobs/8585631-genai-product-manager-f-m-d";
function fakeChrome(initial=[]){
  const tabMap=new Map(initial.map(v=>[v.id,{active:false,windowId:1,...v}]));
  const data={},events=[],focusEvents=[];
  let nextId=500;
  const onEvent={addListener:()=>{},removeListener:()=>{}};
  const chrome={
    storage:{session:{
      get:async key=>({[key]:data[key]}),
      set:async obj=>Object.assign(data,obj)
    }},
    tabs:{
      query:async()=>[...tabMap.values()],
      create:async({url,active})=>{
        events.push(["create",url,active]);
        const t={id:nextId++,url,active,windowId:1};
        tabMap.set(t.id,t);return t;
      },
      get:async id=>{const t=tabMap.get(id);if(!t)throw Error("not found");return t;},
      remove:async id=>{events.push(["remove",id]);tabMap.delete(id);},
      update:async(id,change)=>{
        focusEvents.push(["tab-update",id,change]);
        Object.assign(tabMap.get(id),change);return tabMap.get(id);
      }
    },
    windows:{update:async(...args)=>focusEvents.push(["window-update",...args])},
    scripting:{executeScript:async({target:{tabId},func,args})=>{
      events.push(["inject",func.name,tabId]);
      if(func===locateVirtualCursorTarget)
        return [{result:{valid:true,x:55,y:45,uid:args[0],origin:args[1]}}];
      if(func===showVirtualCursor)return [{result:{visible:true}}];
      return [{result:{title:"Test",url:tabMap.get(tabId).url,text:"Apply",controls:[]}}];
    }},
    debugger:{
      onEvent,
      attach:async()=>{},
      detach:async()=>{},
      sendCommand:async(_target,method,params)=>{events.push(["debugger",method,params]);return {};}
    }
  };
  return {chrome,tabMap,events,focusEvents};
}

describe("Agent Browser foreground control and exact-URL tab reuse",()=>{
  it("adopts a pre-existing inactive matching tab and never duplicates it",async()=>{
    const c=fakeChrome([
      {id:13,url:target,active:false},
      {id:14,url:"https://careers.axpo.com/jobs/different",active:true}
    ]);
    const agent=createNativeAgentExecutor(c.chrome,c.chrome.storage.session);
    const first=await agent.run({owner:"agent-A",op:"open",args:{url:target}});
    expect(first).toMatchObject({pageId:13,background:true,reusedExistingTab:true,
      adoptedHumanTab:true,tabCreated:false});
    expect(c.events.filter(e=>e[0]==="create")).toHaveLength(0);
    expect((await agent.run({owner:"agent-A",op:"open",args:{url:target}})).pageId).toBe(13);
    expect((await agent.run({owner:"agent-A",op:"tabs"})).tabs).toHaveLength(1);
    expect(c.focusEvents).toHaveLength(0);
    const result=await agent.run({owner:"agent-A",op:"close_tab",args:{pageId:13}});
    expect(result).toMatchObject({closed:false,tabPreserved:true,released:true});
    expect(c.tabMap.has(13)).toBe(true);
    await expect(agent.run({owner:"agent-A",op:"snapshot"}))
      .rejects.toThrow("AGENT_TAB_NOT_OWNED");
  });

  it("does not adopt another Session's tab or a pre-existing foreground tab",async()=>{
    const c=fakeChrome([{id:100,url:target,active:false}]);
    const agent=createNativeAgentExecutor(c.chrome,c.chrome.storage.session);
    expect((await agent.run({owner:"agent-A",op:"open",args:{url:target}})).pageId).toBe(100);
    const other=await agent.run({owner:"agent-B",op:"open",args:{url:target}});
    expect(other).toMatchObject({reusedExistingTab:false,tabCreated:true});
    expect(other.pageId).not.toBe(100);
    await expect(agent.run({owner:"agent-B",op:"use",args:{pageId:100}}))
      .rejects.toThrow("AGENT_TAB_NOT_OWNED");
    const fg=fakeChrome([{id:101,url:target,active:true}]);
    const one=createNativeAgentExecutor(fg.chrome,fg.chrome.storage.session);
    const opened=await one.run({owner:"agent-A",op:"open",args:{url:target}});
    expect(opened).toMatchObject({reusedExistingTab:false,background:true});
    expect(fg.focusEvents).toHaveLength(0);
  });

  it("requires exact URL, skips pinned and incognito tabs",async()=>{
    const c=fakeChrome([
      {id:12,url:target+"?source=elsewhere",active:false},
      {id:13,url:target,pinned:true,active:false},
      {id:14,url:target,incognito:true,active:false},
      {id:15,url:target+"#other",active:false}
    ]);
    const agent=createNativeAgentExecutor(c.chrome,c.chrome.storage.session);
    const page=await agent.run({owner:"agent-A",op:"open",args:{url:target}});
    expect(page).toMatchObject({tabCreated:true,reusedExistingTab:false});
    expect(page.pageId).toBe(500);
  });

  it("permits benign clicks in foreground and background without stealing focus",async()=>{
    const c=fakeChrome([{id:31,url:target,active:false}]);
    const agent=createNativeAgentExecutor(c.chrome,c.chrome.storage.session);
    await agent.run({owner:"agent-A",op:"open",args:{url:target}});
    // Human makes this tab active after Agent adopts it: no ban on clicking.
    c.tabMap.get(31).active=true;
    const clicked=await agent.run({owner:"agent-A",op:"click",args:{uid:"owl-agent-3"}});
    expect(clicked).toMatchObject({pageId:31,clicked:true,foregroundUnchanged:true,
      systemMouseUsed:false});
    expect(c.events.some(v=>v[0]==="debugger"&&v[1]==="Input.dispatchMouseEvent")).toBe(true);
    expect(c.focusEvents).toHaveLength(0);
    // Active Agent tab works without simulated focus and without stealing it.
    expect(c.events.some(v=>v[1]==="Emulation.setFocusEmulationEnabled")).toBe(false);
    c.tabMap.get(31).active=false;
    const background=await agent.run({owner:"agent-A",op:"cursor_click",
      args:{uid:"owl-agent-3"}});
    expect(background).toMatchObject({clicked:true,virtualFocusEmulated:true,
      foregroundUnchanged:true,osPointerMoved:false});
    const emulation=c.events.filter(v=>v[1]==="Emulation.setFocusEmulationEnabled");
    expect(emulation.map(v=>v[2]?.enabled)).toEqual([true,false]);
    expect(c.focusEvents).toHaveLength(0);
  });

  it("restores tab-local focus emulation when background dispatch fails",async()=>{
    const c=fakeChrome([{id:78,url:target,active:false}]);
    const agent=createNativeAgentExecutor(c.chrome,c.chrome.storage.session);
    await agent.run({owner:"agent-A",op:"open",args:{url:target}});
    const send=c.chrome.debugger.sendCommand;
    c.chrome.debugger.sendCommand=async(target,method,params)=>{
      if(method==="Input.dispatchMouseEvent"&&params?.type==="mousePressed")
        throw Error("MOUSE_DISPATCH_FAILED");
      return send(target,method,params);
    };
    await expect(agent.run({owner:"agent-A",op:"cursor_click",
      args:{uid:"owl-agent-3"}})).rejects.toThrow("MOUSE_DISPATCH_FAILED");
    expect(c.events.filter(v=>v[1]==="Emulation.setFocusEmulationEnabled")
      .map(v=>v[2]?.enabled)).toEqual([true,false]);
    expect(c.focusEvents).toHaveLength(0);
  });

  it("fails closed when a reused human tab changes origin, but still lets go",async()=>{
    const c=fakeChrome([{id:44,url:target,active:false}]);
    const agent=createNativeAgentExecutor(c.chrome,c.chrome.storage.session);
    await agent.run({owner:"agent-A",op:"open",args:{url:target}});
    c.tabMap.get(44).url="https://other-site.example/account";
    await expect(agent.run({owner:"agent-A",op:"snapshot"}))
      .rejects.toThrow("AGENT_REUSED_TAB_ORIGIN_CHANGED");
    const result=await agent.run({owner:"agent-A",op:"close_tab",args:{pageId:44}});
    expect(result.tabPreserved).toBe(true);
    expect(c.tabMap.has(44)).toBe(true);
  });

  it("closes created Agent tabs normally",async()=>{
    const c=fakeChrome();
    const agent=createNativeAgentExecutor(c.chrome,c.chrome.storage.session);
    const page=await agent.run({owner:"agent-A",op:"open",args:{url:target}});
    expect(page.tabCreated).toBe(true);
    expect((await agent.run({owner:"agent-A",op:"close_tab",args:{pageId:page.pageId}})))
      .toMatchObject({closed:true,tabPreserved:false});
    expect(c.tabMap.has(page.pageId)).toBe(false);
  });
});
