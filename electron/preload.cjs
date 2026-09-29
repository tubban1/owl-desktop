const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("owlDesktop", {
  environment: () => ipcRenderer.invoke("desktop:environment"),
  refreshRuntime: () => ipcRenderer.invoke("runtime:refresh"),
  cloudStatus: () => ipcRenderer.invoke("cloud:status"),
  cloudProbe: () => ipcRenderer.invoke("cloud:probe"),
  cloudStart: () => ipcRenderer.invoke("cloud:start"),
  cloudStop: () => ipcRenderer.invoke("cloud:stop"),
  cloudSync: () => ipcRenderer.invoke("cloud:sync"),
  agentInboxSummary: () => ipcRenderer.invoke("agent-inbox:summary"),
  listAgentRequests: (input) => ipcRenderer.invoke("agent-inbox:list", input),
  cancelAgentRequest: (requestId) =>
    ipcRenderer.invoke("agent-inbox:cancel", requestId),
  skillSnapshot: () => ipcRenderer.invoke("skills:snapshot"),
  skillDryRun: (skillId, args) =>
    ipcRenderer.invoke("skills:dry-run", skillId, args),
  skillRun: (skillId, args) =>
    ipcRenderer.invoke("skills:run", skillId, args),
  skillDiscover: (request) =>
    ipcRenderer.invoke("skills:discover", request),
  skillCandidateSubmit: (manifest) =>
    ipcRenderer.invoke("skills:candidate-submit", manifest),
  skillCandidateGet: (candidateId) =>
    ipcRenderer.invoke("skills:candidate-get", candidateId),
  skillCandidateRevise: (candidateId, expectedDigest, manifest) =>
    ipcRenderer.invoke(
      "skills:candidate-revise",
      candidateId,
      expectedDigest,
      manifest,
    ),
  skillCandidateValidate: (candidateId, expectedDigest) =>
    ipcRenderer.invoke(
      "skills:candidate-validate",
      candidateId,
      expectedDigest,
    ),
  skillCandidateDismiss: (candidateId, expectedDigest) =>
    ipcRenderer.invoke(
      "skills:candidate-dismiss",
      candidateId,
      expectedDigest,
    ),
  skillCandidateCompileTest: (candidateId, expectedDigest, inputs) =>
    ipcRenderer.invoke(
      "skills:candidate-compile-test",
      candidateId,
      expectedDigest,
      inputs,
    ),
  skillCandidateRunTest: (taskId) =>
    ipcRenderer.invoke("skills:candidate-run-test", taskId),
  skillCandidateInspect: (candidateId, testTaskId) =>
    ipcRenderer.invoke(
      "skills:candidate-inspect",
      candidateId,
      testTaskId,
    ),
  skillCandidatePromote: (
    candidateId,
    expectedDigest,
    testTaskId,
    confirm,
  ) =>
    ipcRenderer.invoke(
      "skills:candidate-promote",
      candidateId,
      expectedDigest,
      testTaskId,
      confirm,
    ),
  userSkillSetEnabled: (skillId, enabled) =>
    ipcRenderer.invoke("skills:user-set-enabled", skillId, enabled),
  userSkillActivateVersion: (skillId, version) =>
    ipcRenderer.invoke("skills:user-activate-version", skillId, version),
  userSkillRollback: (skillId, version) =>
    ipcRenderer.invoke("skills:user-rollback", skillId, version),
  userSkillUninstall: (skillId, version) =>
    ipcRenderer.invoke("skills:user-uninstall", skillId, version),
  hostStatus: () => ipcRenderer.invoke("host:status"),
  hostRestart: () => ipcRenderer.invoke("host:restart"),
  hostStop: () => ipcRenderer.invoke("host:stop"),
  tunnelStatus: () => ipcRenderer.invoke("tunnel:status"),
  tunnelStart: () => ipcRenderer.invoke("tunnel:start"),
  tunnelStop: () => ipcRenderer.invoke("tunnel:stop"),
  listAccounts: () => ipcRenderer.invoke("accounts:list"),
  upsertAccount: (input) => ipcRenderer.invoke("accounts:upsert", input),
  deleteAccount: (id) => ipcRenderer.invoke("accounts:delete", id),
  setAccountStatus: (id, status, options) =>
    ipcRenderer.invoke("accounts:status", id, status, options),
  accountCapabilities: (id) =>
    ipcRenderer.invoke("accounts:capabilities", id),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  listSecrets: () => ipcRenderer.invoke("secrets:list"),
  upsertSecret: (input) => ipcRenderer.invoke("secrets:upsert", input),
  deleteSecret: (id) => ipcRenderer.invoke("secrets:delete", id),
});
