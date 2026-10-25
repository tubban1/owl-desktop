import {describe,it,expect,vi,afterEach} from "vitest";
import {locateVirtualCursorTarget} from "../chrome-agent-native/virtual-cursor.mjs";

afterEach(()=>vi.unstubAllGlobals());
function mockPage({label="Details",form=false,type="button",offscreen=true}={}){
  let rect=offscreen?{left:15,right:110,top:1450,bottom:1480,width:95,height:30}:
    {left:15,right:110,top:45,bottom:75,width:95,height:30};
  let scrolls=0;
  const el={
    tagName:"BUTTON",textContent:label,disabled:false,
    getAttribute(name){return name==="type"?type:null;},
    hasAttribute(){return false;},
    closest(name){return form&&name==="form"?{}:null;},
    contains(node){return node===el;},
    getRootNode(){return {};},
    getBoundingClientRect(){return rect;},
    scrollIntoView(){scrolls++;rect={left:15,right:110,top:45,bottom:75,width:95,height:30};}
  };
  vi.stubGlobal("location",{origin:"https://careers.axpo.com"});
  vi.stubGlobal("CSS",{escape:x=>x});
  vi.stubGlobal("innerWidth",1280);
  vi.stubGlobal("innerHeight",720);
  vi.stubGlobal("document",{querySelector:()=>el,elementFromPoint:()=>el});
  vi.stubGlobal("getComputedStyle",()=>({visibility:"visible",display:"block",pointerEvents:"auto"}));
  return {get scrolls(){return scrolls;}};
}
describe("background Agent cursor",()=>{
  it("scrolls offscreen benign controls into view without affecting OS pointer",()=>{
    const p=mockPage();
    const r=locateVirtualCursorTarget("owl-agent-7","https://careers.axpo.com","move");
    expect(r.valid).toBe(true);
    expect(r.y).toBe(60);
    expect(p.scrolls).toBe(1);
  });
  it("still denies form submit despite bringing offscreen control into view",()=>{
    const p=mockPage({label:"Submit application",form:true,type:"submit"});
    const r=locateVirtualCursorTarget("owl-agent-7","https://careers.axpo.com","click");
    expect(r).toMatchObject({error:"CURSOR_ACTION_REQUIRES_HUMAN"});
    expect(p.scrolls).toBe(1);
  });
});
