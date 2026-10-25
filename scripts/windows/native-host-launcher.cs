// OWL LAB Windows Chrome Native Messaging launcher.
// Installer substitutes three UTF-8 base64 compile-time constants. No tokens.
// stdout belongs exclusively to binary framed Native Messaging payloads.
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;

internal static class Program {
  static string Utf8(string b64) {
    return Encoding.UTF8.GetString(Convert.FromBase64String(b64));
  }
  static string Quote(string value) {
    var result = new StringBuilder("\"");
    int slashes = 0;
    foreach(char c in value) {
      if(c == '\\') { slashes++; continue; }
      if(c == '"') {
        result.Append('\\', slashes * 2 + 1);
        result.Append('"'); slashes=0; continue;
      }
      result.Append('\\', slashes); slashes=0; result.Append(c);
    }
    result.Append('\\', slashes * 2);
    result.Append('"');
    return result.ToString();
  }
  public static int Main(string[] args) {
    string id="__OWL_EXTENSION_ID__";
    string origin="chrome-extension://" + id + "/";
    // Chrome on Windows supplies the origin AND an optional native window handle.
    // Service workers supply --parent-window=0. Reject unknown extra arguments,
    // but do not reject valid Chrome invocations (previously the host always exited).
    if(args.Length<1 || args.Length>2 ||
       !String.Equals(args[0],origin,StringComparison.Ordinal)) return 12;
    if(args.Length==2) {
      const string prefix="--parent-window=";
      ulong handle;
      if(!args[1].StartsWith(prefix,StringComparison.Ordinal) ||
         !ulong.TryParse(args[1].Substring(prefix.Length),out handle)) return 12;
    }
    string node=Utf8("__OWL_NODE_B64__");
    string script=Utf8("__OWL_SCRIPT_B64__");
    string broker=Utf8("__OWL_BROKER_B64__");
    if(!File.Exists(node)||!File.Exists(script)||!File.Exists(broker))return 13;
    var start = new ProcessStartInfo();
    start.FileName=node;
    start.Arguments=Quote(script)+" --config "+Quote(broker)+
      " --extension-id "+Quote(id)+" "+Quote(origin);
    start.UseShellExecute=false;
    start.RedirectStandardInput=true;
    start.RedirectStandardOutput=true;
    start.RedirectStandardError=false;
    start.CreateNoWindow=true;
    try {
      using(var child=Process.Start(start)){
        if(child==null)return 14;
        // Keep stdin and stdout pumping independently. Chrome Native Messaging
        // has binary frames, so NEVER use text streams or write status to stdout.
        var inbound=Task.Run(()=>{
          try{
            using(var input=Console.OpenStandardInput()) {
              input.CopyTo(child.StandardInput.BaseStream);
            }
          }catch(IOException){}catch(ObjectDisposedException){}
          finally{try{child.StandardInput.Close();}catch(Exception){}}
        });
        var outbound=Task.Run(()=>{
          try{
            using(var output=Console.OpenStandardOutput()){
              child.StandardOutput.BaseStream.CopyTo(output);
              output.Flush();
            }
          }catch(IOException){}catch(ObjectDisposedException){}
        });
        // If Chrome disconnects, input closes. Terminate our child promptly
        // rather than leaving an orphaned broker polling process.
        var done=Task.WhenAny(inbound,outbound);
        done.Wait();
        if(inbound.IsCompleted&&!child.HasExited){
          try{if(!child.WaitForExit(1000))child.Kill();}catch(Exception){}
        }
        child.WaitForExit();
        try{outbound.Wait(1000);}catch(Exception){}
        return child.ExitCode;
      }
    }catch(Exception){return 15;}
  }
}
