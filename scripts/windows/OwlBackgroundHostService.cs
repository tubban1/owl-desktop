// OWL LAB Windows SCM Background Host bootstrap (.NET Framework 4.x).
// This executable is a non-interactive ServiceBase wrapper. It does NOT use
// the signed-in user's DPAPI CurrentUser secrets or Desktop credentials.
// Provision explicit service credentials under LocalMachine DPAPI with
// restricted NTFS ACL using the reviewed administrator-only workflow.
using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Security.Cryptography;
using System.Security.Principal;
using System.ServiceProcess;
using System.Diagnostics;
using System.Threading;
using System.Runtime.InteropServices;

namespace OwlBackgroundHost {
  sealed class OwlService : ServiceBase {
    private Process worker;
    private IntPtr job=IntPtr.Zero;
    private volatile bool stopping;
    private Thread watchdog;
    private readonly object gate=new object();
    private const string SecretFile="credentials.dpapi";
    private const int JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE=0x2000;

    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimit {
      public long perProcessUserTimeLimit, perJobUserTimeLimit;
      public int limitFlags;
      public UIntPtr minimumWorkingSetSize, maximumWorkingSetSize;
      public int activeProcessLimit;
      public IntPtr affinity;
      public int priorityClass, schedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters {
      public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimit {
      public BasicLimit basic;
      public IoCounters io;
      public UIntPtr processMemoryLimit, jobMemoryLimit, peakProcessMemoryUsed, peakJobMemoryUsed;
    }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern bool SetInformationJobObject(IntPtr job,int type,ref ExtendedLimit data,int size);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern bool CloseHandle(IntPtr handle);

    static string Root {get{return AppDomain.CurrentDomain.BaseDirectory;}}
    static string SecretPath {get{return Path.Combine(Root,SecretFile);}}

    public OwlService(){
      ServiceName="OwlLabBackgroundHost";
      CanStop=true;
      AutoLog=false;
    }
    private static void ValidateServiceToken(string value){
      if(!Regex.IsMatch(value ?? "",@"^[A-Za-z0-9_-]{40,80}$"))
        throw new InvalidOperationException("SERVICE_TOKEN_FORMAT_INVALID");
    }
    static void Provision(bool rotate){
      if(!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))
        throw new InvalidOperationException("ADMIN_REQUIRED_FOR_SERVICE_PROVISION");
      if(File.Exists(SecretPath)&&!rotate)
        throw new InvalidOperationException("SERVICE_CREDENTIAL_ALREADY_EXISTS_ROTATION_REQUIRES_APPROVAL");
      // Administrator-controlled provisioning; nothing secret is put on the
      // command line, in script args or in a shell command history.
      string runtime=Console.ReadLine(),mcp=Console.ReadLine(),tunnel=Console.ReadLine();
      ValidateServiceToken(runtime);ValidateServiceToken(mcp);
      if(String.Equals(runtime,mcp,StringComparison.Ordinal))
        throw new InvalidOperationException("SERVICE_TOKENS_MUST_DIFFER");
      if(tunnel==null||tunnel.Length<24||Regex.IsMatch(tunnel,@"\s"))
        throw new InvalidOperationException("SERVICE_TUNNEL_KEY_INVALID");
      byte[] clear=Encoding.UTF8.GetBytes(runtime+"\n"+mcp+"\n"+tunnel);
      try{
        byte[] cipher=ProtectedData.Protect(clear,null,DataProtectionScope.LocalMachine);
        File.WriteAllBytes(SecretPath,cipher);
        Array.Clear(cipher,0,cipher.Length);
      } finally {Array.Clear(clear,0,clear.Length);}
      Console.WriteLine("SERVICE_CREDENTIAL_ENCRYPTED_LOCAL_MACHINE");
    }
    static string[] Unlock(){
      byte[] cipher=File.ReadAllBytes(SecretPath);
      byte[] clear=ProtectedData.Unprotect(cipher,null,DataProtectionScope.LocalMachine);
      try{
        var values=Encoding.UTF8.GetString(clear).Split(new[]{'\n'},3);
        if(values.Length!=3)throw new InvalidOperationException("SERVICE_CREDENTIAL_CORRUPT");
        ValidateServiceToken(values[0]);ValidateServiceToken(values[1]);
        if(values[2].Length<24||Regex.IsMatch(values[2],@"\s"))
          throw new InvalidOperationException("SERVICE_TUNNEL_KEY_INVALID");
        return values;
      }finally{Array.Clear(clear,0,clear.Length);Array.Clear(cipher,0,cipher.Length);}
    }
    static IntPtr CreateChildJob(){
      IntPtr handle=CreateJobObject(IntPtr.Zero,null);
      if(handle==IntPtr.Zero)throw new InvalidOperationException("WINDOWS_JOB_CREATE_FAILED");
      var info=new ExtendedLimit();
      info.basic.limitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      if(!SetInformationJobObject(handle,9,ref info,Marshal.SizeOf(typeof(ExtendedLimit)))){
        CloseHandle(handle);throw new InvalidOperationException("WINDOWS_JOB_POLICY_FAILED");
      }
      return handle;
    }
    protected override void OnStart(string[] args){
      string cfg=Path.Combine(Root,"service-config.json");
      string script=Path.Combine(Root,"background-host-supervisor.mjs");
      string node=Path.Combine(Root,"node.exe");
      if(!File.Exists(cfg)||!File.Exists(script)||!File.Exists(node)||!File.Exists(SecretPath))
        throw new InvalidOperationException("SERVICE_INSTALL_INCOMPLETE");
      stopping=false;
      watchdog=new Thread(()=>{
        try{
          var values=Unlock();
          try{
            var si=new ProcessStartInfo(node,"\""+script+"\"");
            si.UseShellExecute=false;
            si.CreateNoWindow=true;
            si.WorkingDirectory=Root;
            si.RedirectStandardOutput=false;
            si.RedirectStandardError=false;
            si.EnvironmentVariables["OWL_BACKGROUND_CONFIG_PATH"]=cfg;
            si.EnvironmentVariables["OWL_BACKGROUND_RUNTIME_TOKEN"]=values[0];
            si.EnvironmentVariables["OWL_BACKGROUND_MCP_TOKEN"]=values[1];
            si.EnvironmentVariables["OWL_BACKGROUND_TUNNEL_KEY"]=values[2];
            lock(gate){
              if(stopping)return;
              job=CreateChildJob();
              worker=Process.Start(si);
              if(worker==null)
                throw new InvalidOperationException("SERVICE_WORKER_START_FAILED");
              if(!AssignProcessToJobObject(job,worker.Handle)){
                // Fail closed: never leave an unowned service worker running.
                try{worker.Kill();}catch{}
                throw new InvalidOperationException("SERVICE_WORKER_JOB_ATTACH_FAILED");
              }
            }
            worker.WaitForExit();
            if(!stopping)Environment.Exit(19); // SCM recovery, not silent outage
          }finally{
            for(int i=0;i<values.Length;i++)values[i]=null;
          }
        }catch{
          if(!stopping)Environment.Exit(20);
        }
      });
      watchdog.IsBackground=true;
      watchdog.Start();
    }
    protected override void OnStop(){
      lock(gate){
        stopping=true;
        if(job!=IntPtr.Zero){CloseHandle(job);job=IntPtr.Zero;}
        if(worker!=null){worker.Dispose();worker=null;}
      }
      if(watchdog!=null)watchdog.Join(4000);
    }
    public static int Main(string[] args){
      if(args.Length>0){
        try{
          if(args[0]=="--provision"){Provision(args.Length>1&&args[1]=="--rotate");return 0;}
          if(args[0]=="--validate"){
            bool ok=File.Exists(Path.Combine(Root,"service-config.json")) &&
              File.Exists(Path.Combine(Root,"background-host-supervisor.mjs")) &&
              File.Exists(Path.Combine(Root,"node.exe"))&&File.Exists(SecretPath);
            Console.WriteLine(ok?"SERVICE_STAGE_READY":"SERVICE_STAGE_NOT_READY");
            return ok?0:2;
          }
          Console.Error.WriteLine("UNKNOWN_SERVICE_COMMAND");
          return 2;
        }catch(Exception){
          // never print exception details: sensitive path or credential data
          Console.Error.WriteLine("SERVICE_PROVISION_OR_VALIDATION_FAILED");
          return 3;
        }
      }
      ServiceBase.Run(new OwlService());
      return 0;
    }
  }
}
