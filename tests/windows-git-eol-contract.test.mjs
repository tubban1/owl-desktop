import {describe,it,expect} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
describe("Cross-platform Git line endings for native host",()=>{
  it("enforces LF for imported mjs files on Windows",()=>{
    const attr=fs.readFileSync(path.join(root,".gitattributes"),"utf8");
    expect(attr).toMatch(/^\*\.mjs\s+text\s+eol=lf\s*$/m);
    const host=fs.readFileSync(path.join(root,"connection-host/native-messaging-host.mjs"),"utf8");
    expect(host).toMatch(/^#!\/usr\/bin\/env node\n/);
    expect(host).not.toContain("\r");
    const check=spawnSync(process.execPath,["--check",
      path.join(root,"connection-host/native-messaging-host.mjs")],{cwd:root});
    expect(check.status).toBe(0);
  });
});
