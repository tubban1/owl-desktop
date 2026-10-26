// Fixed provider endpoints: callers cannot turn an email account into SSRF.
export const MAIL_PROVIDERS=Object.freeze({
  yahoo:Object.freeze({label:'Yahoo Mail',imap:{host:'export.imap.mail.yahoo.com',port:993,secure:true},smtp:{host:'smtp.mail.yahoo.com',port:465,secure:true}}),
  exmail:Object.freeze({label:'Tencent Exmail',imap:{host:'imap.exmail.qq.com',port:993,secure:true},smtp:{host:'smtp.exmail.qq.com',port:465,secure:true}}),
});
export function mailAccountInput(input){
  const provider=String(input?.provider||'').toLowerCase();
  if(!Object.hasOwn(MAIL_PROVIDERS,provider))throw Error('MAIL_PROVIDER_UNSUPPORTED');
  const address=String(input?.address||'').trim().toLowerCase();
  if(!/^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/.test(address)||address.length>254)throw Error('MAIL_ADDRESS_INVALID');
  // Provider selection is explicit: Exmail accounts can use custom domains.
  if(provider==='yahoo'&&!/@(?:yahoo\.(?:com|co\.uk|fr|de)|ymail\.com|rocketmail\.com)$/.test(address))throw Error('MAIL_YAHOO_ADDRESS_MISMATCH');
  return {provider,address};
}
export function safeMailbox(name){
  if(typeof name!=='string'||name.length<1||name.length>100||/[\x00-\x1f\x7f]/.test(name))throw Error('MAIL_MAILBOX_INVALID');
  return name;
}
export function boundedUid(uid){
  if(!Number.isSafeInteger(uid)||uid<1||uid>4294967295)throw Error('MAIL_UID_INVALID');
  return uid;
}
