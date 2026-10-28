import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

const URL = "https://owl-mailer.internal/v1/send";
const env = {
  MAILER_CALL_TOKEN: "test-token",
  MAIL_FROM_ALLOWLIST: "agent@tbn.cc",
  BREVO_API_KEY: "test-brevo-key"
};
const example = { from: "agent@tbn.cc", to: ["qa@example.org"], subject: "Test", text: "Hello" };
async function call(data, environment=env, headers={authorization:"Bearer test-token"}) {
  return worker.fetch(new Request(URL,{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(data)}),environment);
}
test("health reports service readiness",async()=>{
  const res=await worker.fetch(new Request("https://owl-mailer.internal/health"),env);
  assert.equal(res.status,200);
  assert.equal((await res.json()).ready,true);
});
test("cannot send without a caller credential",async()=>{
  const res=await call(example,env,{});
  assert.equal(res.status,401);
});
test("cannot send without Brevo credentials",async()=>{
  const res=await call(example,{...env,BREVO_API_KEY:undefined});
  assert.equal(res.status,503);
});
test("rejects unauthorized from address",async()=>{
  const res=await call({...example,from:"unauthorized@example.com"});
  assert.equal(res.status,403);
});
test("rejects bad subject, bad recipients and empty body",async()=>{
  assert.equal((await call({...example,subject:"Hello\r\nBcc: bad@example.com"})).status,400);
  assert.equal((await call({...example,to:["bad"]})).status,400);
  assert.equal((await call({...example,text:""})).status,400);
});
test("sends correctly with Brevo without logging or returning the API key",async()=>{
  const original=globalThis.fetch;
  let request;
  try {
    globalThis.fetch=async (url,init)=> {
      request={url,init};
      return new Response(JSON.stringify({messageId:"12345"}),{status:201,headers:{"content-type":"application/json"}});
    };
    const res=await call(example);
    assert.equal(res.status,202);
    const payload=await res.json();
    assert.equal(payload.messageId,"12345");
    assert.equal(request.url,"https://api.brevo.com/v3/smtp/email");
    assert.equal(request.init.headers["api-key"],env.BREVO_API_KEY);
    assert.deepEqual(JSON.parse(request.init.body).to,[{email:"qa@example.org"}]);
    assert.ok(!JSON.stringify(payload).includes(env.BREVO_API_KEY));
  } finally {globalThis.fetch=original;}
});
test("failed provider response does not expose response body or key",async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response('Internal secret-provider output',{status:403});
    const res=await call(example);
    assert.equal(res.status,502);
    const body=await res.text();
    assert.ok(!body.includes("Internal secret-provider output"));
  } finally {globalThis.fetch=original;}
});
