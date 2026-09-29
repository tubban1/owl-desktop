const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("owlDesktop", {
  environment: () => ipcRenderer.invoke("desktop:environment"),
  refreshRuntime: () => ipcRenderer.invoke("runtime:refresh"),
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
