import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const DOCUMENT_ROOT_NAMES=Object.freeze(['Downloads','Documents','Desktop']);
const EXTENSIONS=new Set(['.pdf','.txt','.md','.csv','.json','.xml','.html','.rtf','.odt','.ods','.odp','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.pages','.numbers','.key','.png','.jpg','.jpeg','.webp','.heic','.zip']);
const PROTECTED=new Set(['.ssh','.aws','.gnupg','.config','.computer-mcp','.owl-runtime-dev','Keychains']);
const errReason=e=>e?.code==='EACCES'||e?.code==='EPERM'?'os_permission_denied':e?.code==='ENOENT'?'not_found':'unavailable';
const inside=(r,p)=>{const rel=path.relative(r,p);return rel&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
export const defaultDocumentRoots=(home=os.homedir())=>DOCUMENT_ROOT_NAMES.map(x=>path.join(home,x));
export function auditDocumentAccess({roots=defaultDocumentRoots(),samples=[],verifyWrites=false}={}){
 const report={version:1,platform:process.platform,mode:verifyWrites?'own_canaries_only':'read_only',directories:[],samples:[],
  note:'OS access does not prove OWL task approval or external Gmail/ChatGPT file registration.'};
 for(const root of roots){
  const row={path:root,list:false,canary:'not_tested'};
  try{
   if(!fs.statSync(root).isDirectory()){row.error='not_directory';report.directories.push(row);continue;}
   fs.readdirSync(root);row.list=true;
   if(verifyWrites){
    const probe=path.join(root,'.owl-file-probe-'+randomUUID()+'.tmp');
    try{
     fs.writeFileSync(probe,'OWL test only',{mode:0o600,flag:'wx'});
     if(fs.readFileSync(probe,'utf8')!=='OWL test only')throw new Error('READ_BACK_FAILED');
     row.canary='passed';
    }catch(e){row.canary='failed';row.error=errReason(e);}
    finally{
     try{fs.unlinkSync(probe);}
     catch(e){if(row.canary==='passed'){row.canary='cleanup_failed';row.error=errReason(e);}}
    }
   }
  }catch(e){row.error=errReason(e);}
  report.directories.push(row);
 }
 for(const input of samples){
  const row={path:input,readable:false,attachmentCandidate:false};
  if(typeof input!=='string'||!path.isAbsolute(input)){row.reason='invalid_path';report.samples.push(row);continue;}
  if(input.split(path.sep).some(p=>PROTECTED.has(p)||p.startsWith('.'))){row.reason='protected_path';report.samples.push(row);continue;}
  try{
   if(fs.lstatSync(input).isSymbolicLink()){row.reason='symlink';report.samples.push(row);continue;}
   const resolved=fs.realpathSync.native(input);
   if(!roots.some(root=>{try{return inside(fs.realpathSync.native(root),resolved);}catch{return false;}})){
    row.reason='outside_roots';report.samples.push(row);continue;
   }
   const stat=fs.statSync(resolved);
   if(!stat.isFile()){row.reason='not_regular_file';report.samples.push(row);continue;}
   fs.accessSync(resolved,fs.constants.R_OK);
   row.readable=true;row.size=stat.size;row.extension=path.extname(input).toLowerCase();
   row.attachmentCandidate=EXTENSIONS.has(row.extension)&&stat.size>0&&stat.size<=15*1024*1024;
   row.reason=row.attachmentCandidate?'candidate_only':'unsupported_type_or_size';
  }catch(e){row.reason=errReason(e);}
  report.samples.push(row);
 }
 return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 console.log(JSON.stringify(auditDocumentAccess({verifyWrites:args.includes('--verify-writes'),samples:args.filter(a=>a.startsWith('--file=')).map(x=>x.slice(7))}),null,2));
}
