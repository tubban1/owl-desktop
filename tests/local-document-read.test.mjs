import {test,expect} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {zipSync,strToU8} from "fflate";
import {readAuthorizedDocument} from "../mcp/local-document.mjs";

async function authorized(file){
 const stat=await fs.stat(file);return {type:"file",path:await fs.realpath(file),size:stat.size,modifiedAt:stat.mtime.toISOString()};
}
async function fixture(ext,content,callback){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"owl-local-doc-"));
 const file=path.join(dir,"example"+ext);
 try{await fs.writeFile(file,content);return await callback(file);}
 finally{await fs.rm(dir,{recursive:true,force:true});}
}
test("DOCX extracts text and XML entities",async()=>{
 const xml='<w:document><w:p><w:t>Hello &amp; OWL</w:t></w:p><w:p><w:t>Second</w:t></w:p></w:document>';
 await fixture(".docx",Buffer.from(zipSync({"word/document.xml":strToU8(xml)})),async p=>{
  const x=await readAuthorizedDocument(p,authorized);
  expect(x.text).toContain("Hello & OWL\nSecond");expect(x.format).toBe("docx");expect(x.textAvailable).toBe(true);
 });
});
test("XLSX reads shared strings and numeric cell values",async()=>{
 const strings='<sst><si><t>Customer</t></si></sst>';
 const sheet='<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>';
 await fixture(".xlsx",Buffer.from(zipSync({"xl/sharedStrings.xml":strToU8(strings),"xl/worksheets/sheet1.xml":strToU8(sheet)})),async p=>{
  const x=await readAuthorizedDocument(p,authorized);expect(x.text).toContain("Customer\t42");
 });
});
test("PPTX extracts slide text",async()=>{
 const slide='<p:sld><a:p><a:t>Slide &amp; heading</a:t></a:p></p:sld>';
 await fixture(".pptx",Buffer.from(zipSync({"ppt/slides/slide1.xml":strToU8(slide)})),async p=>{
  const x=await readAuthorizedDocument(p,authorized);expect(x.text).toContain("Slide & heading");
 });
});
test("does not read unauthorized or format-mismatched files",async()=>{
 await fixture(".pdf",Buffer.from("%PDF-1.4"),async p=>{
  await expect(readAuthorizedDocument(p,async()=>({type:"directory"}))).rejects.toMatchObject({code:"DOCUMENT_NOT_AUTHORIZED"});
  await expect(readAuthorizedDocument(p,async()=>({...await authorized(p),path:p+".wrong"}))).rejects.toMatchObject({code:"DOCUMENT_PATH_CHANGED"});
 });
 await fixture(".txt","private",async p=>await expect(readAuthorizedDocument(p,authorized)).rejects.toMatchObject({code:"DOCUMENT_FORMAT_UNSUPPORTED"}));
});
test("limits source size before reading any document bytes",async()=>{
 await fixture(".docx",Buffer.from("placeholder"),async p=>{
  await expect(readAuthorizedDocument(p,async()=>({...await authorized(p),size:20*1024*1024}))).rejects.toMatchObject({code:"DOCUMENT_TOO_LARGE"});
 });
});
test("malformed or encrypted Office archives fail deterministically",async()=>{
 await fixture(".docx",Buffer.from("not a ZIP"),async p=>await expect(readAuthorizedDocument(p,authorized)).rejects.toMatchObject({code:"DOCUMENT_NOT_OFFICE_ZIP"}));
});
