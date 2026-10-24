import http from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

const digest = value => createHash("sha256").update(value).digest("hex");
const originOK = origin => /^chrome-extension:\/\/[a-p]{32}$/.test(origin || "");
const HOST = "127.0.0.1";
const invalid = code => Object.assign(new Error(code),{code});

export async function startChromeCompanionBroker({port=8794}={}) {
  let pairing=null, linked=null, failures=0, queue=[];
  const waiting=new Map();
  const completed=new Map();
  function clear(code="COMPANION_DISCONNECTED") {
    pairing=null;linked=null;queue=[];completed.clear();
    for(const item of waiting.values()) {clearTimeout(item.timer);item.reject(invalid(code));}
    waiting.clear();
  }
  function pair() {
    clear("COMPANION_REPAIRED");
    const code=randomBytes(8).toString("hex").toUpperCase();
    pairing={digest:digest(code),deadline:Date.now()+120000};failures=0;
    return {code,expiresAt:new Date(pairing.deadline).toISOString()};
  }
  function status() {
    return {connected:!!linked&&linked.deadline>Date.now(),extensionId:linked?.extensionId||null,pending:waiting.size};
  }
  async function command(op,args={}) {
    if(!["snapshot","fill","click","screenshot"].includes(op))throw invalid("OP_NOT_ALLOWED");
    if(!status().connected)throw invalid("COMPANION_NOT_PAIRED");
    if(waiting.size>=2)throw invalid("COMPANION_BUSY");
    if(!["snapshot","screenshot"].includes(op)&&(typeof args.selector!=="string"||args.selector.length>320||args.selector.length===0))
      throw invalid("INVALID_SELECTOR");
    if(op==="fill"&&(typeof args.text!=="string"||args.text.length>4000))throw invalid("INVALID_TEXT");
    const id=randomBytes(16).toString("hex");
    const operation=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        waiting.delete(id);queue=queue.filter(x=>x.id!==id);reject(invalid("COMPANION_ACTION_TIMEOUT"));
      },op==="click"?90000:45000);
      waiting.set(id,{resolve,reject,timer});
      queue.push({id,op,args});
    });
    if(op==="click"){
      void operation.then(value=>completed.set(id,{done:true,ok:true,result:value,at:Date.now()}),
        error=>completed.set(id,{done:true,ok:false,error:error.code||"ACTION_FAILED",at:Date.now()}));
      return {pending:true,requestId:id,requiresUserConfirmation:true};
    }
    return await operation;
  }
  function result(id){
    if(!/^[a-f0-9]{32}$/.test(id))throw invalid("INVALID_REQUEST_ID");
    for(const [key,value] of completed)if(value.at<Date.now()-600000)completed.delete(key);
    if(waiting.has(id))return {pending:true,requestId:id};
    if(completed.has(id))return {pending:false,requestId:id,...completed.get(id)};
    throw invalid("COMPANION_RESULT_NOT_FOUND");
  }
  const server=http.createServer(async(req,res)=>{
    const origin=req.headers.origin;
    const headers={"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff"};
    const addr=req.socket.remoteAddress;
    if(req.headers.host!=="127.0.0.1:"+server.address().port||
       !["127.0.0.1","::ffff:127.0.0.1"].includes(addr)||
       !originOK(origin)) {
      res.writeHead(403,headers);res.end('{"ok":false,"error":"ORIGIN_FORBIDDEN"}');return;
    }
    headers["access-control-allow-origin"]=origin;
    headers["access-control-allow-methods"]="POST,OPTIONS";
    headers["access-control-allow-headers"]="authorization,content-type";
    if(req.method==="OPTIONS"){res.writeHead(204,headers);res.end();return;}
    try{
      if(req.method!=="POST")throw invalid("METHOD_NOT_ALLOWED");
      let raw="";
      for await(const chunk of req){raw+=chunk;if(raw.length>5_000_000)throw invalid("BODY_TOO_LARGE");}
      let body;try{body=JSON.parse(raw||"{}");}catch{throw invalid("INVALID_JSON");}
      let data;
      if(req.url==="/v1/pair"){
        if(!pairing||pairing.deadline<Date.now()||failures>=5)throw invalid("PAIRING_EXPIRED");
        const code=String(body.code||"").trim().toUpperCase();
        if(!/^[0-9A-F]{16}$/.test(code)||
          !timingSafeEqual(Buffer.from(digest(code),"hex"),Buffer.from(pairing.digest,"hex"))){
          failures++;throw invalid("PAIRING_INVALID");
        }
        const token=randomBytes(32).toString("hex");
        linked={digest:digest(token),extensionId:origin.slice(19),deadline:Date.now()+900000};
        pairing=null;
        data={token,expiresAt:new Date(linked.deadline).toISOString()};
      } else {
        const match=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization||"");
        if(!linked||linked.deadline<=Date.now()||
          linked.extensionId!==origin.slice(19)||!match||digest(match[1])!==linked.digest)
          throw invalid("COMPANION_UNAUTHORIZED");
        if(req.url==="/v1/poll")data={requests:queue.splice(0,2)};
        else if(req.url==="/v1/result"){
          const item=waiting.get(body.id);
          if(!item)throw invalid("COMPANION_REQUEST_EXPIRED");
          waiting.delete(body.id);clearTimeout(item.timer);
          if(body.ok===true)item.resolve(body.result);
          else item.reject(invalid("COMPANION_ACTION_REJECTED"));
          data={received:true};
        } else if(req.url==="/v1/revoke"){clear();data={revoked:true};}
        else throw invalid("NOT_FOUND");
      }
      res.writeHead(200,headers);res.end(JSON.stringify({ok:true,data}));
    }catch(error){
      res.writeHead(error.code==="COMPANION_UNAUTHORIZED"?401:400,headers);
      res.end(JSON.stringify({ok:false,error:error.code||"BROKER_ERROR"}));
    }
  });
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(port,HOST,resolve);});
  return {pair,status,command,result,url:"http://127.0.0.1:"+server.address().port,
    close:async()=>{clear();await new Promise(resolve=>server.close(resolve));}};
}
