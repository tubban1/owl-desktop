import { describe, expect, it } from "vitest";
import { ConnectionHostClient } from "../electron/services/connection-host-client.mjs";

describe("Mission review over isolated Connection Host", () => {
  it("lists the canonical Host missions instead of an empty Desktop store", async () => {
    const observed = [];
    const client = new ConnectionHostClient({
      baseUrl: "http://127.0.0.1:8791",
      token: "local-host-token",
      fetchImpl: async (url, options) => {
        observed.push({ url, options });
        return { ok: true, status: 200, json: async () => ({
          ok: true, result: [{ workstreamId: "owl-workstream:demo", status: "needs_review" }],
        }) };
      },
    });
    await expect(client.missionReviews()).resolves.toEqual([
      { workstreamId: "owl-workstream:demo", status: "needs_review" },
    ]);
    expect(observed).toHaveLength(1);
    expect(observed[0].url).toBe("http://127.0.0.1:8791/missions/reviews");
    expect(observed[0].options.headers.authorization).toBe("Bearer local-host-token");
  });

  it("only transmits a user-signed digest/signature; never manufactures approval", async () => {
    let call;
    const client = new ConnectionHostClient({
      baseUrl: "http://127.0.0.1:8791",
      token: "local-host-token",
      fetchImpl: async (url, options) => {
        call = { url, options };
        return { ok: true, status: 200, json: async () => ({
          ok: true, result: { approved: true, digest: "sha256-digest" },
        }) };
      },
    });
    await expect(client.approveMission("owl-workstream:demo", {
      digest: "sha256-digest", signature: "existing-native-approval-proof",
    })).resolves.toMatchObject({ approved: true });
    expect(call.url).toContain("/missions/reviews/owl-workstream%3Ademo/approve");
    expect(call.options.method).toBe("POST");
    expect(JSON.parse(call.options.body)).toEqual({
      digest: "sha256-digest", signature: "existing-native-approval-proof",
    });
    expect(call.options.headers.authorization).toBe("Bearer local-host-token");
  });

  it("transmits only selected process IDs and supports immediate revocation", async () => {
    const calls=[];
    const client=new ConnectionHostClient({
      baseUrl:"http://127.0.0.1:8791",token:"local-host-token",
      fetchImpl:async(url,options)=>{
        calls.push({url,options});
        return {ok:true,status:200,json:async()=>({
          ok:true,result:url.endsWith("/revoke")
            ? {approved:false,revoked:true}
            : {approved:true,digest:"signed-scope"},
        })};
      },
    });
    await expect(client.approveMission("owl-workstream:toggle",{
      digest:"signed-scope",signature:"local-ed25519",
      enabledPermissionIds:["single-codex-run"],
    })).resolves.toMatchObject({approved:true});
    expect(JSON.parse(calls[0].options.body)).toEqual({
      digest:"signed-scope",signature:"local-ed25519",
      enabledPermissionIds:["single-codex-run"],
    });
    await expect(client.revokeMission("owl-workstream:toggle"))
      .resolves.toMatchObject({approved:false,revoked:true});
    expect(calls[1].url).toContain("/missions/reviews/owl-workstream%3Atoggle/revoke");
    expect(calls[1].options.method).toBe("POST");
    expect(calls[1].options.headers.authorization).toBe("Bearer local-host-token");
  });

  it("preserves host refusal of invalid signatures", async () => {
    const client = new ConnectionHostClient({
      baseUrl: "http://127.0.0.1:8791",
      token: "local-host-token",
      fetchImpl: async () => ({
        ok: false, status: 409, json: async () => ({
          ok: false, error: { code: "MISSION_SIGNATURE_INVALID" },
        }),
      }),
    });
    await expect(client.approveMission("owl-workstream:demo", {
      digest: "digest", signature: "invalid",
    })).rejects.toMatchObject({ code: "MISSION_SIGNATURE_INVALID" });
  });
});

