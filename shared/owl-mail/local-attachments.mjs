import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

const MAX_FILES=10;
const MAX_TOTAL_BYTES=15*1024*1024; // Gmail's MIME/base64 adds ~33% overhead.
const BLOCKED_PARTS=new Set(['.ssh','.aws','.gnupg','.config','Keychains','.owl-runtime-dev','.computer-mcp']);
const ALLOWED_EXTENSIONS=new Set(['.pdf','.txt','.md','.csv','.docx','.xlsx','.pptx','.png','.jpg','.jpeg','.webp','.zip']);
function invalid(code){const error=new Error(code);error.code=code;throw error;}
function under(root,file){
 const rel=path.relative(root,file);
 return !!rel && rel!=='..' && !rel.startsWith('..'+path.sep) && !path.isAbsolute(rel);
}
function canonicalFile(file,roots){
 if(typeof file!=='string'||!path.isAbsolute(file))invalid('MAIL_ATTACHMENT_PATH_INVALID');
 if(file.split(/[\\/]+/).some(part=>BLOCKED_PARTS.has(part))||path.basename(file).startsWith('.'))invalid('MAIL_ATTACHMENT_PROTECTED');
 if(!ALLOWED_EXTENSIONS.has(path.extname(file).toLowerCase()))invalid('MAIL_ATTACHMENT_TYPE_NOT_ALLOWED');
 if(fs.lstatSync(file).isSymbolicLink())invalid('MAIL_ATTACHMENT_SYMLINK');
 const canonical=fs.realpathSync.native(file);
 const approved=roots.some(root=>{
  try{return under(fs.realpathSync.native(root),canonical);}catch{return false;}
 });
 if(!approved)invalid('MAIL_ATTACHMENT_OUTSIDE_APPROVED_ROOT');
 if(!fs.statSync(canonical).isFile())invalid('MAIL_ATTACHMENT_NOT_FILE');
 return canonical;
}
function capture(file,roots,withContent){
 const canonical=canonicalFile(file,roots);
 const fd=fs.openSync(canonical,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
 try{
  const start=fs.fstatSync(fd);
  if(!start.isFile()||start.size<1||start.size>MAX_TOTAL_BYTES)invalid('MAIL_ATTACHMENT_INVALID_SIZE');
  const bytes=fs.readFileSync(fd);
  const end=fs.fstatSync(fd);
  if(bytes.length!==start.size||end.size!==start.size||end.mtimeMs!==start.mtimeMs)invalid('MAIL_ATTACHMENT_CHANGED');
  const detail={path:canonical,name:path.basename(canonical),size:bytes.length,
   sha256:createHash('sha256').update(bytes).digest('hex'),dev:start.dev,ino:start.ino,mtimeMs:start.mtimeMs};
  return withContent?{...detail,content:bytes}:detail;
 }finally{fs.closeSync(fd);}
}
function enforceTotal(files){
 if(files.reduce((sum,f)=>sum+f.size,0)>MAX_TOTAL_BYTES)invalid('MAIL_ATTACHMENTS_TOO_LARGE');
}
export function snapshotLocalAttachments(files=[],roots=[path.join(os.homedir(),'Downloads')]){
 if(!Array.isArray(files)||files.length>MAX_FILES||files.some(f=>typeof f!=='string'))invalid('MAIL_ATTACHMENT_LIST_INVALID');
 if(new Set(files).size!==files.length)invalid('MAIL_ATTACHMENT_DUPLICATE');
 const captured=files.map(file=>capture(file,roots,false));
 if(new Set(captured.map(f=>f.path)).size!==captured.length)invalid('MAIL_ATTACHMENT_DUPLICATE');
 enforceTotal(captured);
 return captured;
}
export function readVerifiedLocalAttachments(descriptors=[],roots=[path.join(os.homedir(),'Downloads')]){
 if(!Array.isArray(descriptors)||descriptors.length>MAX_FILES)invalid('MAIL_ATTACHMENT_LIST_INVALID');
 const files=descriptors.map(before=>{
  const current=capture(before.path,roots,true);
  if(current.sha256!==before.sha256||current.size!==before.size||current.dev!==before.dev||
      current.ino!==before.ino||current.mtimeMs!==before.mtimeMs)invalid('MAIL_ATTACHMENT_CHANGED');
  return {filename:current.name,content:current.content,contentType:undefined};
 });
 enforceTotal(files.map(f=>({size:f.content.length})));
 return files;
}
