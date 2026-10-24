export function createNativeChromeBridge({broker}) {
  if(!broker?.request||!broker?.status)throw Error("NATIVE_BROKER_REQUIRED");
  const req=(owner,op,args)=>broker.request(owner,op,args);
  return {
    open:(owner,url)=>req(owner,"open",{url}),
    tabs:owner=>req(owner,"tabs"),
    use:(owner,pageId)=>req(owner,"use",{pageId}),
    snapshot:owner=>req(owner,"snapshot"),
    fill:(owner,uid,value)=>req(owner,"fill",{uid,value}),
    click:(owner,uid)=>req(owner,"click",{uid}),
    screenshot:owner=>req(owner,"screenshot"),
    focusForLogin:owner=>req(owner,"focus_login"),
    closeTab:(owner,pageId)=>req(owner,"close_tab",{pageId}),
    status:()=>broker.status(),
    close:async()=>{} // broker lifecycle is owned by Connection Host
  };
}
