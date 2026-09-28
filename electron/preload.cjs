const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("owlDesktop", {
  environment: () => ipcRenderer.invoke("desktop:environment"),
  refreshRuntime: () => ipcRenderer.invoke("runtime:refresh"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  listSecrets: () => ipcRenderer.invoke("secrets:list"),
  upsertSecret: (input) => ipcRenderer.invoke("secrets:upsert", input),
  deleteSecret: (id) => ipcRenderer.invoke("secrets:delete", id),
});
