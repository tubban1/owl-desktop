import {ImapFlow} from 'imapflow';
import nodemailer from 'nodemailer';
import {simpleParser} from 'mailparser';
import {MAIL_PROVIDERS,boundedUid,safeMailbox} from './providers.mjs';
const MAX_SEARCH=50,MAX_READ_BYTES=6*1024*1024;
function dateISO(value){return value instanceof Date&&!Number.isNaN(value.valueOf())?value.toISOString():null;}
function formatAddress(a){return Array.isArray(a)?a.map(v=>({name:v.name||'',address:v.address||''})):[];}
function headerRow(v){return {uid:v.uid,subject:v.envelope?.subject||'',from:formatAddress(v.envelope?.from),to:formatAddress(v.envelope?.to),date:dateISO(v.internalDate||v.envelope?.date),flags:[...(v.flags||[])],messageId:v.envelope?.messageId||null};}
export class OwlMailProtocol{
  constructor({newImap=(options)=>new ImapFlow(options),newSmtp=(options)=>nodemailer.createTransport(options),parse=simpleParser}={}){Object.assign(this,{newImap,newSmtp,parse});}
  async withMailbox(account,password,mailbox,work){
    const provider=MAIL_PROVIDERS[account.provider];if(!provider)throw Error('MAIL_PROVIDER_UNSUPPORTED');
    const client=this.newImap({...provider.imap,auth:{user:account.address,pass:password},logger:false,disableAutoIdle:true,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000});
    await client.connect();let lock;
    try{lock=await client.getMailboxLock(safeMailbox(mailbox));return await work(client);}finally{lock?.release();await client.logout().catch(()=>{});}
  }
  async list(account,password,{mailbox='INBOX',limit=20}={}){
    limit=Math.min(Math.max(1,Number(limit)||20),MAX_SEARCH);
    return this.withMailbox(account,password,mailbox,async client=>{
      const total=client.mailbox?.exists||0;if(!total)return [];
      const start=Math.max(1,total-limit+1);const messages=[];
      for await(const row of client.fetch(`${start}:*`,{uid:true,envelope:true,flags:true,internalDate:true})){messages.push(headerRow(row));}
      return messages.slice(-limit).reverse();
    });
  }
  async search(account,password,{mailbox='INBOX',from,subject,since,limit=20}={}){
    limit=Math.min(Math.max(1,Number(limit)||20),MAX_SEARCH);
    const query={};
    if(from){if(typeof from!=='string'||from.length>180)throw Error('MAIL_QUERY_INVALID');query.from=from;}
    if(subject){if(typeof subject!=='string'||subject.length>180)throw Error('MAIL_QUERY_INVALID');query.subject=subject;}
    if(since){const date=new Date(since);if(Number.isNaN(date.valueOf()))throw Error('MAIL_DATE_INVALID');query.since=date;}
    if(!Object.keys(query).length)throw Error('MAIL_SEARCH_FILTER_REQUIRED');
    return this.withMailbox(account,password,mailbox,async client=>{
      const ids=await client.search(query,{uid:true});const selected=(Array.isArray(ids)?ids:[]).slice(-limit);
      if(!selected.length)return [];
      const rows=[];for await(const row of client.fetch(selected,{uid:true,envelope:true,flags:true,internalDate:true},{uid:true})){rows.push(headerRow(row));}
      return rows.sort((a,b)=>b.uid-a.uid);
    });
  }
  async read(account,password,{mailbox='INBOX',uid}={}){
    boundedUid(uid);
    return this.withMailbox(account,password,mailbox,async client=>{
      const row=await client.fetchOne(uid,{uid:true,envelope:true,source:true,internalDate:true,flags:true},{uid:true});
      if(!row?.source)throw Error('MAIL_MESSAGE_NOT_FOUND');
      if(row.source.length>MAX_READ_BYTES)throw Error('MAIL_MESSAGE_TOO_LARGE');
      const parsed=await this.parse(row.source,{skipImageLinks:true});
      return {...headerRow(row),text:String(parsed.text||'').slice(0,150000),html:null,
        attachments:(parsed.attachments||[]).map((a,i)=>({index:i,filename:a.filename||'attachment',size:a.size||0,contentType:a.contentType||'application/octet-stream'}))};
    });
  }
  async send(account,password,{to,cc=[],subject,text,attachments=[]}={}){
    if(!Array.isArray(to)||!to.length||to.length>20||!Array.isArray(cc)||cc.length>20||typeof subject!=='string'||subject.length>300||typeof text!=='string'||text.length>200000)throw Error('MAIL_DRAFT_INVALID');
    for(const a of [...to,...cc])if(typeof a!=='string'||!/^[^\s@<>]+@[^\s@<>]+$/.test(a))throw Error('MAIL_RECIPIENT_INVALID');
    if(!Array.isArray(attachments)||attachments.length>10||attachments.some(a=>!Buffer.isBuffer(a.content)||a.content.length<1))throw Error('MAIL_ATTACHMENTS_INVALID');
    const p=MAIL_PROVIDERS[account.provider];const smtp=this.newSmtp({...p.smtp,auth:{user:account.address,pass:password},pool:false,requireTLS:true});
    try{const info=await smtp.sendMail({from:account.address,to,cc,subject,text,attachments,disableFileAccess:true,disableUrlAccess:true});return {accepted:(info.accepted||[]).length,messageId:info.messageId||null};}
    finally{smtp.close?.();}
  }
}
