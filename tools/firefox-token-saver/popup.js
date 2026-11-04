"use strict";

const startBtn = document.getElementById("start");
const resultBtn = document.getElementById("result");
const statusEl = document.getElementById("status");
const regionEl = document.getElementById("region");

browser.storage.local.get("result").then(({ result }) => {
  if (result) resultBtn.hidden = false;
});

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  statusEl.textContent = "Opening the Shark login…";
  const res = await browser.runtime.sendMessage({ type: "start", region: regionEl.value });
  if (res && res.ok) {
    window.close();
  } else {
    statusEl.textContent = `Couldn't start: ${(res && res.error) || "unknown error"}`;
    startBtn.disabled = false;
  }
});

resultBtn.addEventListener("click", async () => {
  await browser.tabs.create({ url: browser.runtime.getURL("complete.html") });
  window.close();
});
