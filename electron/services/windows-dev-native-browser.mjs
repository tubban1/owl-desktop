import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { startNativeMessagingBroker } from "../../connection-host/native-messaging-broker.mjs";
import { createNativeChromeBridge } from "../../connection-host/native-user-chrome-bridge.mjs";
import { createAgentUploadBroker } from "../../connection-host/agent-upload-broker.mjs";

// Reuse the original Mac Connection Host browser protocol on Windows DEV.
// Only the native host executable + Chrome registration are OS-specific.
// The isolated broker is bound to loopback and uses a unique per-user token.
export async function startWindowsDevNativeBrowser({
  platform = process.platform,
  packaged = false,
  enabled = false,
  userDataRoot,
  brokerPort = 8795,
  brokerFactory = startNativeMessagingBroker,
  uploadFactory = createAgentUploadBroker,
  protectAcl,
} = {}) {
  if (platform !== "win32" || packaged || !enabled) return null;
  if (!userDataRoot || typeof userDataRoot !== "string")
    throw Error("WINDOWS_NATIVE_BROWSER_USER_DATA_REQUIRED");
  const directory = path.join(userDataRoot, "native-chrome");
  const configPath = path.join(directory, "broker.json");
  let broker;
  try {
    // On Windows POSIX chmod(0600) is not security; enforce real NTFS ACL.
    fs.mkdirSync(directory, { recursive: true });
    const acl = protectAcl ?? ((target, type) => {
      const sid = execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], {
        encoding: "utf8", windowsHide: true, timeout: 6000,
      }).match(/S-\d+(?:-\d+)+/)?.[0];
      if (!sid) throw Error("WINDOWS_NATIVE_BROKER_SID_UNAVAILABLE");
      const rights = type === "dir" ? "(OI)(CI)F" : "F";
      execFileSync("icacls.exe", [target, "/inheritance:r", "/grant:r",
        "*" + sid + ":" + rights,
        "*S-1-5-18:" + rights,
        "*S-1-5-32-544:" + rights,
      ], { windowsHide: true, timeout: 10000 });
    });
    acl(directory, "dir");
    broker = await brokerFactory({ port: brokerPort, configPath });
    acl(configPath, "file");
    const uploadBroker = uploadFactory();
    const bridge = createNativeChromeBridge({ broker, uploadBroker });
    return {
      bridge,
      configPath,
      async close() {
        await broker.close();
        await uploadBroker.close?.();
      },
    };
  } catch (error) {
    await broker?.close().catch(() => undefined);
    throw error;
  }
}
