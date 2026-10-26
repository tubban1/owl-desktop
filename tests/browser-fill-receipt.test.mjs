import {describe,it,expect} from "vitest";
import {createNativeChromeBridge} from "../connection-host/native-user-chrome-bridge.mjs";
const owner="agent-owned";
function setup(result){
 const calls=[];
 const broker={
   status:()=>({connected:true}),
   request:async(_owner,op,args)=>{
     calls.push([op,args]);
     if(op==="snapshot")return {pageId:7,snapshot:{
       url:"https://ads.google.com/local",controls:[{uid:"owl-agent-4",tag:"div",
         role:"textbox",type:"",editable:true}]}};
     if(op==="fill")return result;
     throw Error("UNEXPECTED_BROKER_CALL");
   }
 };
 return {bridge:createNativeChromeBridge({broker}),calls};
}
describe("Native Agent Browser fill receipt",()=>{
 it("rejects page-id-only false success from old custom field adapter",async()=>{
   const {bridge,calls}=setup({pageId:7});
   await expect(bridge.fill(owner,"owl-agent-4","shiatsu therapie"))
     .rejects.toThrow("BROWSER_FILL_NOT_CONFIRMED");
   expect(calls.map(x=>x[0])).toEqual(["snapshot","fill"]);
 });
 it("accepts new trusted input DOM evidence but never claims a site save",async()=>{
   const {bridge}=setup({pageId:7,filled:true,domVerified:true,
     websitePersisted:false,inputMethod:"tab_scoped_chromium_trusted_text"});
   const r=await bridge.fill(owner,"owl-agent-4","osteopathie");
   expect(r).toMatchObject({filled:true,domVerified:true,websitePersisted:false});
 });
 it("identifies legacy plain input's lack of DOM verification",async()=>{
   const {bridge}=setup({pageId:7,filled:true,length:10});
   const r=await bridge.fill(owner,"owl-agent-4","older-value");
   expect(r).toMatchObject({filled:true,domVerified:false,websitePersisted:false});
 });
 it("rejects completely absent extension responses",async()=>{
   const {bridge}=setup(null);
   await expect(bridge.fill(owner,"owl-agent-4","test"))
     .rejects.toThrow("BROWSER_FILL_NOT_CONFIRMED");
 });
});
