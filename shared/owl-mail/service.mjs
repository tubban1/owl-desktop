import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {OwlMailProtocol} from './protocol.mjs';
import {mailAccountInput,MAIL_PROVIDERS} from './providers.mjs';
const PROJECT='owl-mail';
const DRAFT_PROJECT='owl-mail-drafts';
function coded(code){const err=new Error(code);err.code=code;return err;}
function clean(d){return {id:d.id,provider:d.provider,address:d.address,label:d.label,createdAt:d.createdAt};}
function validId(v){if(typeof v!=='string'||!/^[a-f0-9-]{36}$/.test(v))throw coded('MAIL_ID_INVALID');return v;}
function read(file){try{const records=JSON.parse(fs.readFileSync(file,'utf8'));return Array.isArray(records)?records:[];}catch(e){if(e?.code==='ENOENT')return [];throw coded('MAIL_ACCOUNT_STORE_INVALID');}}
function write(file,rows){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temporary=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temporary,JSON.stringify(rows,null,2),{mode:0o600,flag:'wx'});fs.renameSync(temporary,file);}finally{try{fs.unlinkSync(temporary);}catch{}}}
export class OwlMailService{
 constructor({file,store,protocol=new OwlMailProtocol(),approveSend=async()=>false}={}){
  if(!file||!store?.readSecret||!store?.upsertSecret)throw coded('MAIL_VAULT_REQUIRED');
  Object.assign(this,{file,store,protocol,approveSend});this.sending=new Set();
 }
 accounts(){return read(this.file).map(clean);}
 async connect({provider,address,label,password}){
  const entry=mailAccountInput({provider,address});
  if(typeof password!=='string'||password.length<8||password.length>256)throw coded('MAIL_APP_PASSWORD_REQUIRED');
  const rows=read(this.file);const existing=rows.find(x=>x.address===entry.address&&x.provider===entry.provider);
  const record={id:existing?.id||randomUUID(),...entry,label:String(label||entry.address).slice(0,100),createdAt:existing?.createdAt||new Date().toISOString()};
  // Verify first; never persist invalid app passwords, and never return one.
  await this.protocol.list(record,password,{limit:1});
  this.store.upsertSecret({name:record.id,project:PROJECT,value:password});
  const next=rows.filter(x=>x.id!==record.id);next.push(record);write(this.file,next);
  return clean(record);
 }
 async disconnect({accountId}){
  validId(accountId);const rows=read(this.file);if(!rows.some(x=>x.id===accountId))throw coded('MAIL_ACCOUNT_UNKNOWN');
  const encrypted=this.store.listSecrets?.().find(x=>x.name===accountId&&x.project===PROJECT);if(encrypted)this.store.deleteSecret(encrypted.id);
  write(this.file,rows.filter(x=>x.id!==accountId));return {disconnected:true};
 }
 credentials(accountId){validId(accountId);const account=read(this.file).find(x=>x.id===accountId);if(!account)throw coded('MAIL_ACCOUNT_UNKNOWN');const password=this.store.readSecret(accountId,PROJECT);if(!password)throw coded('MAIL_CREDENTIAL_UNAVAILABLE');return {account,password};}
 async list({accountId,mailbox='INBOX',limit=20}){const{account,password}=this.credentials(accountId);return this.protocol.list(account,password,{mailbox,limit});}
 async search({accountId,mailbox='INBOX',from,subject,since,limit=20}){const{account,password}=this.credentials(accountId);return this.protocol.search(account,password,{mailbox,from,subject,since,limit});}
 async read({accountId,mailbox='INBOX',uid}){const{account,password}=this.credentials(accountId);return this.protocol.read(account,password,{mailbox,uid});}
 createDraft({accountId,to,cc=[],subject,text}){
  const {account}=this.credentials(accountId);
  if(!Array.isArray(to)||!to.length||to.length>20||!Array.isArray(cc)||cc.length>20||[...to,...cc].some(x=>typeof x!=='string'||!/^[^\s@<>]+@[^\s@<>]+$/.test(x))||typeof subject!=='string'||subject.length>300||typeof text!=='string'||text.length>200000)throw coded('MAIL_DRAFT_INVALID');
  const id=randomUUID(),draft={id,accountId,to,cc,subject,text,createdAt:new Date().toISOString(),status:'draft'};
  this.store.upsertSecret({name:id,project:DRAFT_PROJECT,value:JSON.stringify(draft)});
  return {draftId:id,account:account.address,subject,to,cc,status:'local_draft',sendRequiresHumanConfirmation:true};
 }
 getDraft(id){validId(id);const value=this.store.readSecret(id,DRAFT_PROJECT);if(!value)throw coded('MAIL_DRAFT_NOT_FOUND');const draft=JSON.parse(value);if(draft.id!==id)throw coded('MAIL_DRAFT_INVALID');return draft;}
 async sendDraft({draftId}){
  if(this.sending.has(draftId))throw coded('MAIL_SEND_IN_PROGRESS');
  const draft=this.getDraft(draftId);
  if(draft.status!=='draft')throw coded('MAIL_DRAFT_ALREADY_SENT');
  this.sending.add(draftId);
  try{
    const {account,password}=this.credentials(draft.accountId);
    // Native Electron human approval; only Desktop can grant, never MCP args.
    const review={from:account.address,to:draft.to,cc:draft.cc,subject:draft.subject,preview:draft.text.slice(0,1200)};
    if((await this.approveSend(review))!==true)throw coded('MAIL_SEND_APPROVAL_REQUIRED');
    // Persist BEFORE network I/O. An uncertain SMTP result must never cause an
    // automatic resend, even after a Desktop crash or ChatGPT reconnect.
    this.store.upsertSecret({name:draftId,project:DRAFT_PROJECT,value:JSON.stringify({...draft,status:'sending'})});
    try{
      const result=await this.protocol.send(account,password,draft);
      this.store.upsertSecret({name:draftId,project:DRAFT_PROJECT,value:JSON.stringify({...draft,status:'sent',sentAt:new Date().toISOString(),messageId:result.messageId})});
      return {sent:true,to:draft.to,accepted:result.accepted,messageId:result.messageId};
    } catch {
      this.store.upsertSecret({name:draftId,project:DRAFT_PROJECT,value:JSON.stringify({...draft,status:'uncertain'})});
      throw coded('MAIL_SEND_UNCERTAIN_CHECK_SENT_FOLDER');
    }
  } finally {this.sending.delete(draftId);}
 }
}
