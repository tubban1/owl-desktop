// Isolated Chromium test of the real CDP DOM.setFileInputFiles method.
// Does not attach to or modify the user's personal Chrome profile.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {chromium}=require("/Users/wahaha/node_modules/playwright");
const dir=await fs.mkdtemp(path.join(os.tmpdir(),"owl-cdp-upload-smoke-"));
const file=path.join(dir,"owl-test-image.png");
await fs.writeFile(file,Buffer.from("OWL local file upload smoke test"));
const server=http.createServer((req,res)=>{
  res.writeHead(200,{"content-type":"text/html"});
  res.end(`<!doctype html><html><body>
    <input type=file id=normal accept=".png">
    <input type=file id=hidden style="display:none" multiple accept="image/png">
    <span id=change-count>0</span>
    <script>
      for(const input of document.querySelectorAll('input[type=file]')){
        input.addEventListener('change',()=>{
          document.querySelector('#change-count').textContent=
          String(Number(document.querySelector('#change-count').textContent)+1);
        });
      }
    </script></body></html>`);
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
let browser;
try{
  const port=server.address().port;
  browser=await chromium.launch({headless:true,channel:"chromium"});
  const page=await browser.newPage();
  await page.goto("http://127.0.0.1:"+port);
  const result=[];
  const cdp=await page.context().newCDPSession(page);
  for(const [id,uid] of [["normal","owl-file-0"],["hidden","owl-file-1"]]){
    await page.evaluate(({id,uid})=>document.getElementById(id).setAttribute("data-owl-file-uid",uid),{id,uid});
    const doc=await cdp.send("DOM.getDocument",{depth:0});
    const node=await cdp.send("DOM.querySelector",{
      nodeId:doc.root.nodeId,
      selector:`input[type="file"][data-owl-file-uid="${uid}"]`
    });
    if(!node.nodeId)throw Error("NO_DOM_FILE_INPUT");
    await cdp.send("DOM.setFileInputFiles",{nodeId:node.nodeId,files:[file]});
    const selected=await page.evaluate(id=>({
      files:[...document.getElementById(id).files].map(f=>f.name),
      count:document.getElementById(id).files.length
    }),id);
    if(selected.count!==1||selected.files[0]!=="owl-test-image.png"){
      throw Error("UPLOAD_SELECTION_UNCONFIRMED");
    }
    result.push({id,selected});
  }
  await cdp.detach();
  console.log(JSON.stringify({ok:true,isolatedChromium:true,methods:["DOM.getDocument","DOM.querySelector","DOM.setFileInputFiles"],result,websiteUploadVerified:false}));
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
  await fs.rm(dir,{recursive:true,force:true});
}
