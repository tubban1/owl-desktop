import fs from "node:fs/promises";
import {constants} from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {unzipSync} from "fflate";

const EXTENSIONS=new Set([".pdf",".docx",".xlsx",".pptx"]);
const MAX_SOURCE_BYTES=15*1024*1024,MAX_UNZIPPED_BYTES=28*1024*1024,MAX_ENTRIES=220,MAX_TEXT_CHARS=100000;
function fail(code,message=code){const e=new Error(message);e.code=code;throw e;}
function decode(s){return String(s).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,x)=>{
 if(x[0]==="#"){const n=x[1].toLowerCase()==="x"?parseInt(x.slice(2),16):Number(x.slice(1));return Number.isInteger(n)&&n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):"";}
 return ({amp:"&",lt:"<",gt:">",quot:'"',apos:"'"})[x.toLowerCase()]??"";
});}
function pieces(xml,tag){const a=[],re=new RegExp("<"+tag+"\\b[^>]*>([\\s\\S]*?)<\\/"+tag+">","g");let m;while((m=re.exec(xml)))a.push(decode(m[1]));return a;}
function officeText(xml,ext){
 const word=ext===".docx",para=word?"w:p":"a:p",txt=word?"w:t":"a:t";
 return xml.replace(new RegExp("</"+para+">","g"),"\n").replace(/<w:tab\b[^>]*\/>/g,"\t")
  .replace(/<w:br\b[^>]*\/>/g,"\n")
  .replace(new RegExp("<"+txt+"\\b[^>]*>([\\s\\S]*?)<\\/"+txt+">","g"),(_,v)=>decode(v))
  .replace(/<[^>]*>/g,"").replace(/\n{3,}/g,"\n\n").trim();
}
function zipText(bytes,ext){
 const wanted=(n)=>ext===".docx"?/^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(n)
  :ext===".pptx"?/^ppt\/slides\/slide\d+\.xml$/i.test(n)
  :n==="xl/sharedStrings.xml"||/^xl\/worksheets\/sheet\d+\.xml$/i.test(n);
 if(bytes[0]!==0x50||bytes[1]!==0x4b)fail("DOCUMENT_NOT_OFFICE_ZIP");
 let count=0,total=0;
 const files=unzipSync(new Uint8Array(bytes),{filter:e=>{
  if(++count>MAX_ENTRIES)fail("DOCUMENT_ARCHIVE_TOO_MANY_ENTRIES");
  if(!wanted(e.name))return false;
  if(!Number.isSafeInteger(e.originalSize)||e.originalSize>MAX_UNZIPPED_BYTES||total+e.originalSize>MAX_UNZIPPED_BYTES)fail("DOCUMENT_ARCHIVE_TOO_LARGE");
  total+=e.originalSize;return true;
 }});
 const names=Object.keys(files).sort((a,b)=>{
  const x=Number(a.match(/(?:slide|sheet|header|footer)(\d+)\.xml$/)?.[1]??0);
  const y=Number(b.match(/(?:slide|sheet|header|footer)(\d+)\.xml$/)?.[1]??0);
  return x-y||a.localeCompare(b);
 });
 const content=n=>new TextDecoder("utf-8",{fatal:true}).decode(files[n]);
 let body="";
 if(ext===".xlsx"){
  const shared=files["xl/sharedStrings.xml"]?[...content("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m=>pieces(m[1],"t").join("")):[];
  for(const name of names.filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n))){
   const rows=[];
   for(const row of content(name).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){
    const cells=[];
    for(const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){
     const v=cell[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1]??"",typ=cell[1].match(/\bt="([^"]*)"/)?.[1];
     cells.push(typ==="s"?shared[Number(v)]??"":typ==="inlineStr"?pieces(cell[2],"t").join(""):typ==="b"?(v==="1"?"TRUE":"FALSE"):decode(v));
    }
    if(cells.length)rows.push(cells.join("\t"));
   }
   body+="["+name+"]\n"+rows.join("\n")+"\n";
  }
 }else for(const name of names)body+="["+name+"]\n"+officeText(content(name),ext)+"\n";
 if(!names.length)fail("DOCUMENT_NO_READABLE_OFFICE_PARTS");
 return {text:body.trim(),parts:names.length,format:ext.slice(1)};
}
async function pdfText(bytes,maxPages){
 const {getDocument}=await import("pdfjs-dist/legacy/build/pdf.mjs");
 const task=getDocument({data:new Uint8Array(bytes),disableFontFace:true,useSystemFonts:false,isEvalSupported:false,stopAtErrors:true});
 let pdf;
 try{
  pdf=await task.promise;const count=Math.min(pdf.numPages,maxPages),texts=[];let extractedChars=0;
  for(let n=1;n<=count;n++){
   const page=await pdf.getPage(n),items=(await page.getTextContent()).items;
   let str="",last=null;
   for(const t of items){if(!("str" in t))continue;const y=t.transform?.[5];if(last!==null&&Number.isFinite(y)&&Math.abs(y-last)>3)str+="\n";str+=t.str+(t.hasEOL?"\n":" ");if(Number.isFinite(y))last=y;}
   extractedChars+=str.trim().length;texts.push("[Page "+n+"]\n"+str.trim());page.cleanup();
  }
  return {text:texts.join("\n\n"),pageCount:pdf.numPages,pagesRead:count,pagesTruncated:pdf.numPages>count,extractedChars,format:"pdf"};
 }finally{if(pdf)await pdf.destroy();else await task.destroy().catch(()=>{});}
}
/**
 * Runtime fs.stat authorizes the path before any local file read. We then
 * re-check its canonical identity, size and mtime, without following symlinks.
 * No file bytes leave the local MCP except bounded, user-requested text.
 */
export async function readAuthorizedDocument(input,authorize,{maxPages=35,maxChars=MAX_TEXT_CHARS}={}){
 if(typeof input!=="string"||!path.isAbsolute(input))fail("DOCUMENT_PATH_INVALID");
 const ext=path.extname(input).toLowerCase();if(!EXTENSIONS.has(ext))fail("DOCUMENT_FORMAT_UNSUPPORTED");
 const approved=await authorize(input);
 if(approved?.type!=="file"||typeof approved.path!=="string"||!Number.isSafeInteger(approved.size))fail("DOCUMENT_NOT_AUTHORIZED");
 if(approved.size<1||approved.size>MAX_SOURCE_BYTES)fail("DOCUMENT_TOO_LARGE");
 let canonical;
 try{canonical=await fs.realpath(input);}catch(e){if(["EPERM","EACCES"].includes(e?.code))fail("DOCUMENT_OS_ACCESS_DENIED","The OS denied access. Grant OWL Desktop/Runtime the necessary privacy permission.");throw e;}
 if(canonical!==approved.path)fail("DOCUMENT_PATH_CHANGED");
 let fd,bytes;
 try{
  fd=await fs.open(canonical,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  const stat=await fd.stat();
  if(!stat.isFile()||stat.size!==approved.size||stat.mtime.toISOString()!==approved.modifiedAt)fail("DOCUMENT_CHANGED");
  bytes=await fd.readFile();
  if(bytes.length!==stat.size||bytes.length>MAX_SOURCE_BYTES)fail("DOCUMENT_CHANGED");
  if((await fs.realpath(input))!==canonical)fail("DOCUMENT_PATH_CHANGED");
 }catch(e){if(["EPERM","EACCES"].includes(e?.code))fail("DOCUMENT_OS_ACCESS_DENIED","The OS denied this file. On macOS, enable Full Disk Access for the OWL Desktop/Runtime app in Privacy & Security and restart.");throw e;}
 finally{await fd?.close();}
 let parsed;
 try{parsed=ext===".pdf"?await pdfText(bytes,Math.min(Math.max(1,maxPages),100)):zipText(bytes,ext);}
 catch(e){if(e?.code?.startsWith("DOCUMENT_"))throw e;fail("DOCUMENT_PARSE_FAILED","Encrypted, corrupt or unsupported document: "+ext);}
 const limit=Math.min(Math.max(100,maxChars),MAX_TEXT_CHARS);
 return {fileName:path.basename(canonical),format:parsed.format,size:bytes.length,
  sha256:createHash("sha256").update(bytes).digest("hex"),
  ...Object.fromEntries(Object.entries(parsed).filter(([k])=>k!=="text")),
  text:parsed.text.slice(0,limit),truncated:parsed.text.length>limit||Boolean(parsed.pagesTruncated),
  textAvailable:ext===".pdf"?parsed.extractedChars>0:parsed.text.trim().length>0,
  noTextReason:(ext===".pdf"?parsed.extractedChars>0:parsed.text.trim().length>0)?"":ext===".pdf"?"SCANNED_PDF_REQUIRES_OCR":"EMPTY_DOCUMENT"};
}
