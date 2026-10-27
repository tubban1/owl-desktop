import {useEffect,useState} from 'react';
type Account={id:string;provider:'yahoo'|'exmail'|'gmail';address:string;label:string;createdAt:string};
export function MailAccountsPanel(){
 const [accounts,setAccounts]=useState<Account[]>([]);
 const [provider,setProvider]=useState<'yahoo'|'exmail'|'gmail'>('yahoo');
 const [address,setAddress]=useState('');const [password,setPassword]=useState('');
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const reload=async()=>{setAccounts(await window.owlDesktop.mailAccounts());};
 useEffect(()=>{void reload().catch(()=>setError('Mail accounts are unavailable in this Desktop.'));},[]);
 const connect=async()=>{
  if(busy)return;setBusy(true);setError('');
  try{await window.owlDesktop.mailConnect({provider,address,password});setPassword('');await reload();}
  catch(e){setError(e instanceof Error?e.message:'Could not connect mailbox. Check the app password and IMAP access.');}
  finally{setPassword('');setBusy(false);}
 };
 const disconnect=async(id:string)=>{
  if(!window.confirm('Disconnect this mailbox and remove its locally stored credential?'))return;
  try{await window.owlDesktop.mailDisconnect(id);await reload();}catch{setError('Could not disconnect mailbox.');}
 };
 return <section className="panel settings-panel" aria-label="Mail accounts">
  <div className="panel-heading"><div><span className="eyebrow">LOCAL MAIL INTEGRATION</span><h3>Mail accounts · 邮箱连接</h3></div></div>
  <p className="panel-help">Connect Gmail, Yahoo or 腾讯企业邮箱 (Exmail). Gmail requires a Google app password (2-Step Verification), configured only on this device. App passwords are saved using this computer's OS-backed encrypted vault; mailbox contents are not uploaded to OWL Cloud. Sending requires a separate desktop confirmation.</p>
  <div className="setting-row"><label htmlFor="mail-provider">Provider</label><select id="mail-provider" className="setting-input" value={provider} onChange={e=>setProvider(e.target.value as 'yahoo'|'exmail'|'gmail')}><option value="gmail">Gmail</option><option value="yahoo">Yahoo Mail</option><option value="exmail">腾讯企业邮箱 / Tencent Exmail</option></select></div>
  <div className="setting-row"><label htmlFor="mail-address">Email address</label><input id="mail-address" className="setting-input" type="email" autoComplete="off" value={address} onChange={e=>setAddress(e.target.value)} placeholder={provider==='gmail'?'you@gmail.com':provider==='yahoo'?'you@yahoo.com':'name@company.com'}/></div>
  <div className="setting-row"><label htmlFor="mail-password">App-specific password / 客户端授权码</label><input id="mail-password" className="setting-input" type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} /></div>
  <button type="button" disabled={busy||!address||!password} onClick={()=>void connect()}>{busy?'Verifying IMAP…':'Connect mailbox'}</button>
  {error&&<p role="alert" className="panel-help">{error}</p>}
  {accounts.map(x=><div key={x.id} className="setting-row"><div><strong>{x.label}</strong><span>{x.provider==='gmail'?'Gmail':x.provider==='yahoo'?'Yahoo':'Exmail'} · {x.address}</span></div><button type="button" onClick={()=>void disconnect(x.id)}>Disconnect</button></div>)}
 </section>;
}
