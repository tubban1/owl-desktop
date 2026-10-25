// Isolated Windows acceptance fixture. No Cloud, Runtime, token, or registry usage.
const args=process.argv.slice(2);
const i=args.indexOf("--extension-id");
const valid=i>=0&&args[i+1]==="a".repeat(32)&&
  args.includes("chrome-extension://"+"a".repeat(32)+"/");
const msg=Buffer.from(JSON.stringify({type:"ready",fixture:true,valid}),"utf8");
const len=Buffer.alloc(4);len.writeUInt32LE(msg.length);
process.stdout.write(Buffer.concat([len,msg]),()=>setTimeout(()=>process.exit(valid?0:7),250));
