import {describe,it,expect,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {OwlMailService} from '../shared/owl-mail/service.mjs';
import {OwlMailProtocol} from '../shared/owl-mail/protocol.mjs';
import {MAIL_PROVIDERS,mailAccountInput} from '../shared/owl-mail/providers.mjs';
import {snapshotLocalAttachments} from '../shared/owl-mail/local-attachments.mjs';

function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'owl-gmail-'));
 const secrets=new Map();
 const store={
  upsertSecret({name,project,value}){secrets.set(project+':'+name,value);return {id:name};},
  readSecret(name,project){return secrets.get(project+':'+name);},
  listSecrets(){return [];},deleteSecret(){}
 };
 const protocol={list:vi.fn(async()=>[]),send:vi.fn(async()=>({accepted:1,messageId:'test-id'}))};
 const approveSend=vi.fn(async()=>true);
 const service=new OwlMailService({file:path.join(dir,'accounts.json'),store,protocol,approveSend,attachmentRoots:[dir]});
 return {dir,secrets,service,protocol,approveSend,close(){fs.rmSync(dir,{recursive:true,force:true});}};
}
describe('Gmail native attachment pathway',()=>{
 it('only connects explicitly supported fixed Gmail mail servers',()=>{
  expect(MAIL_PROVIDERS.gmail.imap.host).toBe('imap.gmail.com');
  expect(MAIL_PROVIDERS.gmail.smtp).toEqual({host:'smtp.gmail.com',port:465,secure:true});
  expect(mailAccountInput({provider:'gmail',address:'Liang.Rao@gmail.com'}).address).toBe('liang.rao@gmail.com');
  expect(()=>mailAccountInput({provider:'gmail',address:'wrong@other.com'})).toThrow('MAIL_GMAIL_ADDRESS_MISMATCH');
 });
 it('locally reads multiple binary attachments, shows them at approval and avoids storing bytes',async()=>{
  const f=fixture();try{
   const p1=path.join(f.dir,'one.pdf'),p2=path.join(f.dir,'two.pdf');
   fs.writeFileSync(p1,Buffer.from('%PDF-1.4 test one'));
   fs.writeFileSync(p2,Buffer.from('%PDF-1.4 test two'));
   const account=await f.service.connect({provider:'gmail',address:'user@gmail.com',password:'app-password-123456'});
   const draft=f.service.createDraft({accountId:account.id,to:['user@gmail.com'],subject:'Attached',text:'PDF files',attachment_paths:[p1,p2]});
   expect(draft.attachments.map(x=>x.name)).toEqual(['one.pdf','two.pdf']);
   expect(f.secrets.get('owl-mail-drafts:'+draft.draftId)).not.toContain('%PDF-1.4');
   await f.service.sendDraft({draftId:draft.draftId});
   expect(f.approveSend).toHaveBeenCalledWith(expect.objectContaining({attachments:[expect.objectContaining({name:'one.pdf'}),expect.objectContaining({name:'two.pdf'})]}));
   const payload=f.protocol.send.mock.calls[0][2];
   expect(payload.attachments[0].content.toString()).toBe('%PDF-1.4 test one');
   expect(payload.attachments[1].content.toString()).toBe('%PDF-1.4 test two');
  }finally{f.close();}
 });
 it('detects mutation and aborts before SMTP, without consuming local draft',async()=>{
  const f=fixture();try{
   const p=path.join(f.dir,'lease.pdf');fs.writeFileSync(p,'old');
   const account=await f.service.connect({provider:'gmail',address:'user@gmail.com',password:'app-password-123456'});
   const draft=f.service.createDraft({accountId:account.id,to:['user@gmail.com'],subject:'Test',text:'Hi',attachment_paths:[p]});
   fs.writeFileSync(p,'new');
   await expect(f.service.sendDraft({draftId:draft.draftId})).rejects.toThrow('MAIL_ATTACHMENT_CHANGED');
   expect(f.service.getDraft(draft.draftId).status).toBe('draft');
   expect(f.protocol.send).not.toHaveBeenCalled();
  }finally{f.close();}
 });
 it('blocks out-of-root files, symlinks, dotfiles and duplicate attachments',()=>{
  const f=fixture();try{
   const good=path.join(f.dir,'good.pdf');fs.writeFileSync(good,'PDF');
   const outside=path.join(os.tmpdir(),'owl-mail-external-'+process.pid+'.pdf');fs.writeFileSync(outside,'out');
   try{expect(()=>snapshotLocalAttachments([outside],[f.dir])).toThrow('MAIL_ATTACHMENT_OUTSIDE_APPROVED_ROOT');}
   finally{fs.unlinkSync(outside);}
   const link=path.join(f.dir,'linked.pdf');fs.symlinkSync(good,link);
   expect(()=>snapshotLocalAttachments([link],[f.dir])).toThrow('MAIL_ATTACHMENT_SYMLINK');
   const dot=path.join(f.dir,'.credentials.pdf');fs.writeFileSync(dot,'secret');
   expect(()=>snapshotLocalAttachments([dot],[f.dir])).toThrow('MAIL_ATTACHMENT_PROTECTED');
   expect(()=>snapshotLocalAttachments([good,good],[f.dir])).toThrow('MAIL_ATTACHMENT_DUPLICATE');
  }finally{f.close();}
 });
 it('sends in-memory contents with no arbitrary Nodemailer filesystem or URL fetch',async()=>{
  let raw;
  const transport={sendMail:async value=>{raw=value;return {accepted:['user@gmail.com'],messageId:'sent'};},close(){}};
  const protocol=new OwlMailProtocol({newSmtp:()=>transport});
  await protocol.send({provider:'gmail',address:'user@gmail.com'},'password',{
   to:['user@gmail.com'],subject:'Test',text:'Hi',attachments:[{filename:'safe.pdf',content:Buffer.from('%PDF-1.4')}]
  });
  expect(raw.disableFileAccess).toBe(true);
  expect(raw.disableUrlAccess).toBe(true);
  expect(raw.attachments[0].content.toString()).toBe('%PDF-1.4');
 });
});
