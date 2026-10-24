const statusEl = document.querySelector("#status");
const preview = document.querySelector("#preview");
const buttons = [...document.querySelectorAll("button")];
function busy(isBusy) { for (const b of buttons) b.disabled = isBusy; }
async function invoke(op) {
  busy(true);
  try {
    const response = await chrome.runtime.sendMessage({op});
    if (!response?.ok) throw new Error(response?.error || "Companion unavailable");
    const data = response.data;
    if (op === "snapshot") {
      preview.hidden = false;
      preview.textContent = JSON.stringify(data, null, 2);
    } else if (op !== "status") { preview.hidden = true; preview.textContent = ""; }
    statusEl.textContent = data.authorized === false ? "No tab authorized" :
      data.origin ? "Authorized: " + data.origin : op === "snapshot" ? "Page inspected" : "Ready";
  } catch (error) {
    statusEl.textContent = "Error: " + String(error?.message || error);
  } finally { busy(false); }
}
document.querySelector("#attach").addEventListener("click", () => invoke("attach"));
document.querySelector("#inspect").addEventListener("click", () => invoke("snapshot"));
document.querySelector("#detach").addEventListener("click", () => invoke("detach"));
void invoke("status");
