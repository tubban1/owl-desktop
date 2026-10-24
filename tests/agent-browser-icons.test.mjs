import {describe,expect,it} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const dir=path.join(root,"chrome-agent-native");
const manifest=JSON.parse(fs.readFileSync(path.join(dir,"manifest.json"),"utf8"));

describe("Chrome Agent Browser icon assets",()=>{
  it("declares Chrome toolbar and extension icon sizes without changing the popup",()=>{
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.action.default_popup).toBe("popup.html");
    expect(Object.keys(manifest.icons).sort()).toEqual(["128","16","32","48"].sort());
    for(const n of [16,32,48]){
      expect(manifest.action.default_icon[String(n)]).toBe(manifest.icons[String(n)]);
    }
  });
  it("references valid, transparent RGBA PNGs of exactly the declared dimensions",()=>{
    for(const [size,relative] of Object.entries(manifest.icons)){
      const png=fs.readFileSync(path.join(dir,relative));
      expect(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))).toBe(true);
      expect(png.readUInt32BE(16)).toBe(Number(size));
      expect(png.readUInt32BE(20)).toBe(Number(size));
      expect(png[25]).toBe(6); // PNG RGBA
    }
    expect(fs.readFileSync(path.join(dir,"icons/icon.svg"),"utf8")).toMatch(/<path\b/);
  });
});
