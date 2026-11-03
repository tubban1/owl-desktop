import http from "node:http";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const {capture} = require("../lib/context-guard.cjs");
const HOST = "127.0.0.1";
const PORT = 8765;
let saved = null; // RAM only. Never persisted, no real data.
const demoRoot = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(demoRoot, "index.html");

function json(res, status, payload) {
  const buf = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {"content-type":"application/json; charset=utf-8",
    "cache-control":"no-store", "content-length":buf.length,
    "x-content-type-options":"nosniff", "referrer-policy":"no-referrer"});
  res.end(buf);
}

export function app(req, res) {
  const host = req.headers.host || "";
  // Restrict this demonstration to loopback; reject DNS rebinding hosts.
  if (!/^127\.0\.0\.1:\d{1,5}$/.test(host)) return json(res,403,{error:"LOCAL_HOST_ONLY"});
  res.setHeader("cache-control","no-store");
  res.setHeader("x-content-type-options","nosniff");
  res.setHeader("referrer-policy","no-referrer");
  if(req.method==="GET" && req.url==="/") {
    readFile(htmlPath).then(data=>{
      res.writeHead(200,{"content-type":"text/html; charset=utf-8",
        "content-security-policy":"default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "content-length":data.length});res.end(data);
    }).catch(()=>json(res,500,{error:"DEMO_PAGE_MISSING"}));
    return;
  }
  if(req.method==="GET" && req.url==="/client.js") {
    readFile(path.join(demoRoot,"client.js")).then(data=>{
      res.writeHead(200,{"content-type":"application/javascript; charset=utf-8",
        "content-length":data.length});res.end(data);
    }).catch(()=>json(res,500,{error:"DEMO_SCRIPT_MISSING"}));
    return;
  }
  if(req.method==="GET" && req.url==="/health") return json(res,200,{ok:true,synthetic:true});
  if(req.method==="POST" && req.url==="/notes") {
    const acceptedOrigin = "http://" + host;
    if(req.headers.origin!==acceptedOrigin) return json(res,403,{error:"ORIGIN_MISMATCH"});
    if(!/^application\/json(?:;|$)/i.test(req.headers["content-type"]||""))
      return json(res,415,{error:"JSON_REQUIRED"});
    let data="", done=false;
    req.on("data",chunk=>{
      data+=chunk.toString("utf8");
      if(data.length>4096 && !done){done=true;json(res,413,{error:"REQUEST_TOO_LARGE"});req.destroy();}
    });
    req.on("end",()=>{
      if(done)return;
      let item;try{item=JSON.parse(data);}catch{return json(res,400,{error:"INVALID_JSON"});}
      if(!capture(item).ok || typeof item.note!=="string" ||
        !item.note.startsWith("[SYNTHETIC DEMO]") || item.note.length>1500)
        return json(res,422,{error:"ONLY_SYNTHETIC_DEMO_DATA"});
      saved={context:{patientId:item.patientId,visitId:item.visitId,clinicianId:item.clinicianId},note:item.note};
      json(res,200,{ok:true,receipt:"DEMO-SAVED-IN-MEMORY",verified:!!saved});
    });return;
  }
  json(res,404,{error:"NOT_FOUND"});
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  http.createServer(app).listen(PORT,HOST,()=>console.log("Synthetic-only demo: http://"+HOST+":"+PORT));
}
