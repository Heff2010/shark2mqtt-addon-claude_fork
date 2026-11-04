"use strict";

const $ = (id) => document.getElementById(id);

function show(id) {
  $(id).hidden = false;
}

async function render() {
  const { result } = await browser.storage.local.get("result");
  ["success", "failure", "empty"].forEach((id) => ($(id).hidden = true));

  if (!result) {
    $("title").textContent = "Shark Token Saver";
    $("message").textContent = "";
    show("empty");
    return;
  }

  if (result.status === "ok") {
    $("title").textContent = "Got it — you're logged in";
    $("message").textContent =
      "Firefox should be asking where to save shark2mqtt_tokens.json. You can also copy the token below.";
    $("token").value = JSON.stringify(result.tokenFile, null, 2);
    $("refresh-warning").hidden = Boolean(result.hasRefreshToken);
    show("success");
  } else {
    $("title").textContent = "The login didn't finish";
    $("message").textContent = result.message || "Unknown error.";
    show("failure");
  }
}

$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("token").value);
    $("action-status").textContent = "Copied.";
  } catch (e) {
    $("token").select();
    $("action-status").textContent = "Couldn't copy automatically. The text is selected, so press Ctrl+C.";
  }
});

$("save").addEventListener("click", async () => {
  const res = await browser.runtime.sendMessage({ type: "save" });
  $("action-status").textContent = res && res.ok ? "" : `Couldn't save: ${(res && res.error) || "unknown error"}`;
});

$("clear").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "clear" });
  $("token").value = "";
  await render();
  $("message").textContent = "Cleared. The token is no longer stored in this browser.";
});

render();
