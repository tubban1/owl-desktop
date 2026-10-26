import {describe,it,expect,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {OwlMailService} from '../shared/owl-mail/service.mjs';
import {OwlMailProtocol} from '../shared/owl-mail/protocol.mjs';
import {MAIL_PROVIDERS,mailAccountInput,safeMailbox} from '../shared/owl-mail/providers.mjs';

const fixture=()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'owl-mail-test-'));
 const secrets=new Map();let sequence=0;
 const store={
  upsertSecret({name,project,value}){secrets.set(project+':'+name,value);return {id:String(++sequence),name,project};},
  readSecret(name,project){return secrets.get(project+':'+name);},
  listSecrets(){return [];},deleteSecret(){},
 };
 const records=[],sent=[];
 const protocol={list:vi.fn(async()=>[{uid:44,subject:'Test'}]),search:vi.fn(async()=>[]),read:vi.fn(async()=>({uid:44,text:'hello'})),send:vi.fn(async(...args)=>{sent.push(args);return {accepted:1,messageId:'<sent@example.com>'};})};
 return {root,store,protocol,secrets,records,sent,close:()=>fs.rmSync(root,{force:true,recursive:true})};
};
describe('OWL Mail account safety',()=>{
 it('uses exact trusted encrypted transport endpoints',()=>{
  expect(MAIL_PROVIDERS.yahoo.imap).toEqual({host:'export.imap.mail.yahoo.com',port:993,secure:true});
  expect(MAIL_PROVIDERS.exmail.imap).toEqual({host:'imap.exmail.qq.com',port:993,secure:true});
  expect(MAIL_PROVIDERS.exmail.smtp.port).toBe(465);
  expect(()=>mailAccountInput({provider:'evil',address:'foo@example.com'})).toThrow();
  expect(()=>mailAccountInput({provider:'yahoo',address:'foo@company.com'})).toThrow();
  expect(mailAccountInput({provider:'exmail',address:'Foo@company.com'}).address).toBe('foo@company.com');
  expect(()=>safeMailbox('INBOX\r\nunsafe')).toThrow();
 });
 it('verifies IMAP account before storing credential; never leaks credential to metadata',async()=>{
  const f=fixture();try{
   const service=new OwlMailService({file:path.join(f.root,'accounts.json'),store:f.store,protocol:f.protocol});
   f.protocol.list.mockRejectedValueOnce(new Error('server rejected'));
   await expect(service.connect({provider:'yahoo',address:'user@yahoo.com',password:'very-secret-123'})).rejects.toThrow();
   expect(f.secrets.size).toBe(0);
   const connected=await service.connect({provider:'yahoo',address:'user@yahoo.com',password:'very-secret-123'});
   expect(connected).not.toHaveProperty('password');
   expect(JSON.stringify(service.accounts())).not.toContain('very-secret');
   expect(fs.readFileSync(path.join(f.root,'accounts.json'),'utf8')).not.toContain('very-secret');
   expect((fs.statSync(path.join(f.root,'accounts.json')).mode & 0o777)).toBe(0o600);
   expect((await service.list({accountId:connected.id}))[0].uid).toBe(44);
   expect(f.protocol.list).toHaveBeenCalledWith(expect.objectContaining({address:'user@yahoo.com'}),'very-secret-123',expect.any(Object));
  }finally{f.close();}
 });
 it('draft never sends without local approval, and confirmed send is at-most-once',async()=>{
  const f=fixture();try{
   let grant=false;
   const service=new OwlMailService({file:path.join(f.root,'accounts.json'),store:f.store,protocol:f.protocol,approveSend:async()=>grant});
   const account=await service.connect({provider:'exmail',address:'person@company.com',password:'1234567890'});
   const draft=service.createDraft({accountId:account.id,to:['customer@example.com'],subject:'Re: project',text:'Hello!'});
   expect(draft.status).toBe('local_draft');expect(draft).not.toHaveProperty('text');
   await expect(service.sendDraft({draftId:draft.draftId})).rejects.toThrow('MAIL_SEND_APPROVAL_REQUIRED');
   expect(f.protocol.send).not.toHaveBeenCalled();
   grant=true;
   const result=await service.sendDraft({draftId:draft.draftId});
   expect(result.sent).toBe(true);expect(f.protocol.send).toHaveBeenCalledTimes(1);
   await expect(service.sendDraft({draftId:draft.draftId})).rejects.toThrow('MAIL_DRAFT_ALREADY_SENT');
  }finally{f.close();}
 });
 it('network uncertainty blocks retry rather than sending duplicate mail',async()=>{
  const f=fixture();try{
   const service=new OwlMailService({file:path.join(f.root,'accounts.json'),store:f.store,protocol:f.protocol,approveSend:async()=>true});
   const account=await service.connect({provider:'exmail',address:'person@company.com',password:'1234567890'});
   const draft=service.createDraft({accountId:account.id,to:['recipient@example.com'],subject:'Test',text:'Hi'});
   f.protocol.send.mockRejectedValueOnce(new Error('SMTP timeout'));
   await expect(service.sendDraft({draftId:draft.draftId})).rejects.toThrow('MAIL_SEND_UNCERTAIN_CHECK_SENT_FOLDER');
   expect(service.getDraft(draft.draftId).status).toBe('uncertain');
   await expect(service.sendDraft({draftId:draft.draftId})).rejects.toThrow('MAIL_DRAFT_ALREADY_SENT');
   expect(f.protocol.send).toHaveBeenCalledTimes(1);
  }finally{f.close();}
 });
});

describe('OWL Mail IMAP read-only transport',()=>{
 it('reads full MIME as plain text with bounded output and no embedded HTML',async()=>{
  const connection={connect:vi.fn(async()=>{}),logout:vi.fn(async()=>{}),getMailboxLock:vi.fn(async()=>({release:vi.fn()})),fetchOne:vi.fn(async()=>({uid:20,source:Buffer.from('From: Alice <alice@example.com>\r\nTo: Bob <bob@example.com>\r\nSubject: Hi\r\nContent-Type: text/plain\r\n\r\nHello Bob'),envelope:{subject:'Hi',from:[{address:'alice@example.com'}]}}))};
  const lib=new OwlMailProtocol({newImap:()=>connection});
  const result=await lib.read({provider:'yahoo',address:'bob@yahoo.com'},'secret',{uid:20});
  expect(result.text).toContain('Hello Bob');expect(result.html).toBe(null);
  expect(result).not.toHaveProperty('source');
  expect(connection.logout).toHaveBeenCalledTimes(1);
 });
});
