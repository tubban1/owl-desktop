import {describe,it,expect,vi,afterEach} from "vitest";
import {createNativeChromeBridge} from "../connection-host/native-user-chrome-bridge.mjs";
import {executeFormAction} from "../chrome-agent-native/form-controls.mjs";
const PAGE="https://careers.axpo.com/jobs/8585631-genai-product-manager-f-m-d";
const NOTICE="Approximately 1 month after accepting an offer (available by arrangement).";
const owner="owl-test-owner";
const args={pageUrl:PAGE,submitUid:"owl-agent-49",salary:"130000",notice:NOTICE,referralValue:"no"};
const grant=()=>JSON.stringify({...args,expiresAt:new Date(Date.now()+120000).toISOString(),
  requiredConsent:true,optionalRetention:false,approvedByUser:true});
const review={ready:true,salary:"130000",notice:NOTICE,referralValue:"no",
  consentChecked:true,optionalRetention:false,cvAttached:true};
function testBridge(reader,reviewValue=review){
  const seen=[];
  const broker={status:()=>({connected:true}),request:async(_owner,op,data)=>{
    seen.push([op,data]);
    if(op==="form_review")return reviewValue;
    if(op==="form_submit")return {dispatched:true,siteConfirmed:false};
    return {};
  }};
  return {bridge:createNativeChromeBridge({broker,submissionGrantReader:reader}),seen};
}
describe("Explicitly user-approved form submission",()=>{
 it("fails closed without an owner-managed grant and on different application",async()=>{
  const {bridge}=testBridge(()=>null);
  await expect(bridge.submitReviewed(owner,args)).rejects.toThrow("FORM_SUBMISSION_REQUIRES_SCOPED_USER_GRANT");
  const {bridge:expired}=testBridge(()=>JSON.stringify({...JSON.parse(grant()),
    expiresAt:"2024-01-01T00:00:00.000Z"}));
  await expect(expired.submitReviewed(owner,args)).rejects.toThrow("FORM_SUBMISSION_REQUIRES_SCOPED_USER_GRANT");
  const {bridge:otherJob}=testBridge(grant);
  await expect(otherJob.submitReviewed(owner,{...args,pageUrl:PAGE+"?evil"}))
    .rejects.toThrow("FORM_SUBMISSION_REQUIRES_SCOPED_USER_GRANT");
  const {bridge:missingConsent}=testBridge(grant,{...review,consentChecked:false});
  await expect(missingConsent.submitReviewed(owner,args)).rejects.toThrow("FORM_SUBMISSION_PREVIEW_MISMATCH");
 });
 it("accepts exactly one authorized reviewed dispatch and does not claim site success",async()=>{
  const {bridge,seen}=testBridge(grant);
  const r=await bridge.submitReviewed(owner,args);
  expect(r).toMatchObject({dispatched:true,siteConfirmed:false,
    submittedToSiteNotVerified:true,grantConsumed:true,detailsReviewed:true});
  expect(seen.map(x=>x[0])).toEqual(["form_review","form_submit"]);
  await expect(bridge.submitReviewed(owner,args)).rejects.toThrow("FORM_SUBMISSION_GRANT_ALREADY_USED");
  expect(seen.map(x=>x[0])).toEqual(["form_review","form_submit"]);
 });
 it("rejects altered salary, notice, referral choice and optional retention",async()=>{
  for(const altered of [
    {...args,salary:"140000"},
    {...args,notice:"Immediate"},
    {...args,referralValue:"yes"}
  ]){
    const {bridge}=testBridge(grant);
    await expect(bridge.submitReviewed(owner,altered))
      .rejects.toThrow("FORM_SUBMISSION_REQUIRES_SCOPED_USER_GRANT");
  }
  const {bridge}=testBridge(grant,{...review,optionalRetention:true});
  await expect(bridge.submitReviewed(owner,args)).rejects.toThrow("FORM_SUBMISSION_PREVIEW_MISMATCH");
 });
});
describe("Scoped consent field permissions",()=>{
 const control=(name,type="checkbox")=>({uid:"owl-agent-45",name,type,label:name});
 const connect=(getGrant,row)=>createNativeChromeBridge({
   broker:{status:()=>({connected:true}),request:async(_owner,op)=>{
     if(op==="form_controls")return {pageUrl:PAGE,controls:[row]};
     if(op==="form_set")return {checked:true};
     throw Error("unexpected "+op);
   }},submissionGrantReader:getGrant
 });
 it("rejects unchecked legal approval or optional retention without explicit grant",async()=>{
   const row=control("candidate[consent_given]");
   const bridge=connect(()=>null,row);
   await expect(bridge.formSet(owner,row.uid,{checked:true}))
     .rejects.toThrow("FORM_LEGAL_CONSENT_REQUIRES_USER_GRANT");
   const approved=connect(grant,row);
   await expect(approved.formSet(owner,row.uid,{checked:false}))
     .rejects.toThrow("FORM_LEGAL_CONSENT_REQUIRES_USER_GRANT");
   expect(await approved.formSet(owner,row.uid,{checked:true})).toMatchObject({checked:true});
 });
 it("only allows approved Axpo salary and never opts into future retention",async()=>{
   const salary=control("candidate[answers_attributes][2][number]","number");
   const a=connect(grant,salary);
   await expect(a.formSet(owner,salary.uid,{value:"160000"}))
     .rejects.toThrow("FORM_SALARY_NOT_APPROVED");
   expect(await a.formSet(owner,salary.uid,{value:"130000"}))
     .toMatchObject({checked:true});
   const retention=control("candidate[consent_given_future_jobs]");
   await expect(connect(grant,retention).formSet(owner,retention.uid,{checked:true}))
     .rejects.toThrow("FORM_OPTIONAL_RETENTION_NOT_APPROVED");
 });
});
afterEach(()=>vi.unstubAllGlobals());
function mockFormControl(type,initial=""){
  let value=initial,checked=false;
  const el={
    tagName:"INPUT",name:"candidate[answers_attributes][2][number]",
    disabled:false,readOnly:false,min:"",max:"",
    getAttribute:key=>key==="type"?type:key==="name"?"candidate[answers_attributes][2][number]":null,
    click:()=>{checked=true},
    dispatchEvent:()=>true
  };
  Object.defineProperty(el,"value",{get:()=>value,set:x=>{value=x}});
  Object.defineProperty(el,"checked",{get:()=>checked,set:x=>{checked=x}});
  vi.stubGlobal("location",{origin:"https://careers.axpo.com"});
  vi.stubGlobal("CSS",{escape:x=>x});
  vi.stubGlobal("Event",class{constructor(type,opts){this.type=type;this.bubbles=opts?.bubbles;}});
  vi.stubGlobal("HTMLInputElement",class{});
  Object.defineProperty(HTMLInputElement.prototype,"value",{configurable:true,set(v){this.value=v}});
  vi.stubGlobal("document",{querySelector:()=>el});
  return el;
}
describe("Native extension isolated form controls",()=>{
 it("requires exact radio option value to prevent Yes/No mistakes",()=>{
  const el=mockFormControl("radio","no");
  const x={origin:"https://careers.axpo.com",uid:"owl-agent-27"};
  expect(executeFormAction("set",{...x,change:{checked:true,expectedValue:"yes"}}))
    .toMatchObject({error:"FORM_OPTION_VALUE_MISMATCH"});
  expect(el.checked).toBe(false);
  expect(executeFormAction("set",{...x,change:{checked:true,expectedValue:"no"}}))
    .toMatchObject({checked:true,domVerified:true});
 });
 it("requires exact origin and rejects unsupported type",()=>{
  mockFormControl("password");
  expect(executeFormAction("set",{origin:"https://evil.test",uid:"owl-agent-3",
    change:{checked:true}})).toMatchObject({error:"FORM_ORIGIN_CHANGED"});
  expect(executeFormAction("set",{origin:"https://careers.axpo.com",uid:"owl-agent-3",
    change:{checked:true}})).toMatchObject({error:"SENSITIVE_OR_INVALID_FIELD"});
 });
});
