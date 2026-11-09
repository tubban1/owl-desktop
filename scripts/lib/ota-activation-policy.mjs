// Fail-closed activation policy: downloading/staging are unrestricted,
// but a user-visible cutover requires a quiet local maintenance window.
import {spawnSync} from "node:child_process";

const QUIET_START = 2; // Europe/Zurich
const QUIET_END = 5;
export const MIN_IDLE_SECONDS = 15 * 60;

export function activationWindow(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find(item => item.type === "hour")?.value);
  return Number.isInteger(hour) && hour >= QUIET_START && hour < QUIET_END;
}

export function activationPermit({now = new Date(), idleSeconds}) {
  if (!activationWindow(now)) return {allowed:false,reason:"outside-local-maintenance-window"};
  if (!Number.isFinite(idleSeconds) || idleSeconds < MIN_IDLE_SECONDS)
    return {allowed:false,reason:"local-user-active-or-idle-unknown"};
  return {allowed:true,reason:"quiet-window-and-user-idle"};
}

export function localUserIdleSeconds(device, spawn = spawnSync) {
  try {
    if (device === "mac") {
      const result = spawn("/usr/sbin/ioreg", ["-c","IOHIDSystem","-d","4"], {
        encoding:"utf8", timeout:6000, maxBuffer:1024*1024,
      });
      if (result.status !== 0 || result.error) return null;
      const match = result.stdout.match(/"HIDIdleTime"\s*=\s*(\d+)/);
      return match ? Number(BigInt(match[1]) / 1000000000n) : null;
    }
    if (device === "windows") {
      // Windows query stays within the scheduled task's interactive session.
      // Unknown / Session-0 context denies activation rather than guessing idle.
      const ps = [
        "$ErrorActionPreference='Stop'",
        "$type='using System; using System.Runtime.InteropServices; public static class OwlIdle { [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; } [DllImport(\"user32.dll\")] static extern bool GetLastInputInfo(ref LASTINPUTINFO info); public static long Seconds(){ var i=new LASTINPUTINFO(); i.cbSize=(uint)Marshal.SizeOf(typeof(LASTINPUTINFO)); if(!GetLastInputInfo(ref i))throw new Exception(\"IDLE_UNKNOWN\"); return unchecked((uint)(Environment.TickCount-(int)i.dwTime))/1000; } }'",
        "Add-Type -TypeDefinition $type",
        "[OwlIdle]::Seconds()",
      ].join(";");
      const result = spawn("powershell.exe", [
        "-NoProfile","-NonInteractive","-Command",ps,
      ], {encoding:"utf8",timeout:12000,maxBuffer:1024*1024});
      if (result.status !== 0 || result.error) return null;
      const value = Number(result.stdout.trim());
      return Number.isFinite(value) && value >= 0 ? value : null;
    }
  } catch {return null;}
  return null;
}
