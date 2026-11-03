(() => {
  "use strict";
  document.getElementById("noteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    const receipt = document.getElementById("receipt");
    try {
      const response = await fetch("/notes", {
        method: "POST",
        headers: {"content-type":"application/json"},
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      receipt.textContent = response.ok
        ? "Saved to the local in-memory demo. Receipt: " + result.receipt
        : "Save rejected: " + result.error;
    } catch {
      receipt.textContent = "Save failed: local server unavailable.";
    }
  });
})();
