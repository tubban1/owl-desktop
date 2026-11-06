import {describe,it,expect,vi,afterEach} from "vitest";
import {locateVirtualCursorTarget} from "../chrome-agent-native/virtual-cursor.mjs";

afterEach(()=>vi.unstubAllGlobals());
function mockPage({label="Details",form=false,type="button",offscreen=true,tag="BUTTON",readOnly=false,placeholder="",role="",className="",insideChoiceList=false}={}){
  let rect=offscreen?{left:15,right:110,top:1450,bottom:1480,width:95,height:30}:
    {left:15,right:110,top:45,bottom:75,width:95,height:30};
  let scrolls=0;
  const el={
    tagName:tag,textContent:label,disabled:false,readOnly,className,
    getAttribute(name){return name==="type"?type:name==="placeholder"?placeholder:name==="role"?role:null;},
    hasAttribute(){return false;},
    closest(name){return (form&&name==="form")||(insideChoiceList&&name.includes("select-option"))?{}:null;},
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
  it("opens a read-only custom dropdown in a form with the Agent's tab-local cursor",()=>{
    mockPage({tag:"INPUT",type:"text",readOnly:true,form:true,
      placeholder:"请选择符合您视频内容的创作声明",offscreen:false});
    const r=locateVirtualCursorTarget("owl-agent-7","https://careers.axpo.com","click");
    expect(r).toMatchObject({valid:true,tag:"input"});
  });
  it("permits an observed harmless option in an open choice menu",()=>{
    mockPage({tag:"DIV",type:"",label:"含AI生成内容",form:true,
      className:"bili-select-option",offscreen:false});
    const r=locateVirtualCursorTarget("owl-agent-7","https://careers.axpo.com","click");
    expect(r).toMatchObject({valid:true,tag:"div"});
  });
  it("allows an observed plain list item only inside a select-option list",()=>{
    mockPage({tag:"LI",type:"",label:"含AI生成内容",form:true,
      insideChoiceList:true,offscreen:false});
    const r=locateVirtualCursorTarget("owl-agent-7","https://careers.axpo.com","click");
    expect(r).toMatchObject({valid:true,tag:"li"});
  });
  it("denies dangerous pseudo-options even when they resemble a choice",()=>{
    mockPage({tag:"DIV",type:"",label:"确认付款",form:true,
      className:"bili-select-option",offscreen:false});
    const r=locateVirtualCursorTarget("owl-agent-7","https://careers.axpo.com","click");
    expect(r).toMatchObject({error:"CURSOR_ACTION_REQUIRES_HUMAN"});
  });
  it("never uses the dropdown exception for file pickers or submit buttons",()=>{
    mockPage({tag:"INPUT",type:"text",readOnly:true,form:true,
      placeholder:"请选择文件",offscreen:false});
    const r=locateVirtualCursorTarget("owl-agent-7","https://careers.axpo.com","click");
    expect(r).toMatchObject({error:"CURSOR_ACTION_REQUIRES_HUMAN"});
  });
  it("still denies form submit despite bringing offscreen control into view",()=>{
    const p=mockPage({label:"Submit application",form:true,type:"submit"});
    const r=locateVirtualCursorTarget("owl-agent-7","https://careers.axpo.com","click");
    expect(r).toMatchObject({error:"CURSOR_ACTION_REQUIRES_HUMAN"});
    expect(p.scrolls).toBe(1);
  });
});
