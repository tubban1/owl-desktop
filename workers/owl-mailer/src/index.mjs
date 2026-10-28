const EMAIL=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
const validEmail=x=>typeof x==="string"&&x.length<=254&&EMAIL.test(x)&&!/[\r\n]/.test(x);
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(path==="/health"&&request.method==="GET"){
      return json({service:"owl-mailer",version:"1.0.0",provider:"brevo",ready:Boolean(env.BREVO_API_KEY),transport:"service-binding"});
    }
    if(path!=="/v1/send"||request.method!=="POST") return json({error:"not_found"},404);
    if(!env.MAILER_CALL_TOKEN)return json({error:"mailer_auth_not_configured"},503);
    if(request.headers.get("authorization")!=="Bearer "+env.MAILER_CALL_TOKEN)return json({error:"unauthorized"},401);
    if(!env.BREVO_API_KEY)return json({error:"mailer_not_configured"},503);
    const length=Number(request.headers.get("content-length")||0);
    if(length>110000)return json({error:"payload_too_large"},413);
    let data;
    try{const raw=await request.text();if(raw.length>110000)return json({error:"payload_too_large"},413);data=JSON.parse(raw);}
    catch{return json({error:"invalid_json"},400);}
    if(!data||typeof data!=="object")return json({error:"invalid_payload"},400);
    const sender=typeof data.from==="string"?data.from.toLowerCase().trim():"";
    const allowed=(env.MAIL_FROM_ALLOWLIST||"agent@tbn.cc").split(",").map(x=>x.trim().toLowerCase());
    if(!validEmail(sender)||!allowed.includes(sender))return json({error:"sender_not_allowed"},403);
    const recipients=Array.isArray(data.to)?data.to:[data.to];
    if(!recipients.length||recipients.length>5||recipients.some(x=>!validEmail(x)))return json({error:"invalid_recipient"},400);
    if(typeof data.subject!=="string"||!data.subject.trim()||data.subject.length>220||/[\r\n]/.test(data.subject))return json({error:"invalid_subject"},400);
    const hasText=typeof data.text==="string"&&data.text.trim()&&data.text.length<=50000;
    const hasHtml=typeof data.html==="string"&&data.html.trim()&&data.html.length<=50000;
    if(!hasText&&!hasHtml)return json({error:"missing_body"},400);
    if((data.text&&(!hasText))||(data.html&&(!hasHtml)))return json({error:"invalid_body"},400);
    if(data.replyTo&&!validEmail(data.replyTo))return json({error:"invalid_reply_to"},400);
    const outgoing={sender:{email:sender,name:typeof data.senderName==="string"?data.senderName.slice(0,80):"OWL LAB"},to:recipients.map(email=>({email})),subject:data.subject};
    if(hasText)outgoing.textContent=data.text;
    if(hasHtml)outgoing.htmlContent=data.html;
    if(data.replyTo)outgoing.replyTo={email:data.replyTo};
    let response;
    try{response=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{"api-key":env.BREVO_API_KEY,"accept":"application/json","content-type":"application/json"},body:JSON.stringify(outgoing),signal:AbortSignal.timeout(12000)});}
    catch{return json({error:"upstream_transport_uncertain",retrySafe:false},502);}
    if(!response.ok)return json({error:"brevo_rejected",upstreamStatus:response.status},502);
    const result=await response.json().catch(()=>({}));
    return json({accepted:true,provider:"brevo",messageId:typeof result.messageId==="string"?result.messageId:null},202);
  }
};
