const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"));
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
});

(async () => {
  await new Promise(resolve => server.listen(4173, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const host = await browser.newPage();
    const guest = await browser.newPage();
    for (const page of [host, guest]) {
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => {
        if (message.type() === "error") errors.push(message.text());
      });
    }

    await host.goto("http://127.0.0.1:4173");
    await host.locator("#name").fill("CI Host");
    await host.locator("#create").click();
    await host.waitForFunction(() => document.querySelector("#netState").textContent === "Room online", null, { timeout: 30000 });
    const code = await host.locator("#roomCode").textContent();
    if (!code || !/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new Error("Host did not publish a valid room code");

    await guest.goto("http://127.0.0.1:4173");
    await guest.locator("#name").fill("CI Guest");
    await guest.locator("#joinCode").fill(code);
    await guest.locator("#join").click();
    await guest.waitForFunction(() => document.querySelector("#netState").textContent === "Connected to host", null, { timeout: 45000 });
    await host.waitForFunction(() => [...document.querySelectorAll(".seat")].some(el => el.textContent.includes("CI Guest")), null, { timeout: 15000 });
    await guest.waitForFunction(() => [...document.querySelectorAll(".seat")].some(el => el.textContent.includes("CI Host")), null, { timeout: 15000 });

    await guest.locator("#ready").click();
    await host.waitForFunction(() => !document.querySelector("#start").disabled, null, { timeout: 10000 });
    await host.locator("#start").click();
    await host.waitForFunction(() => document.querySelector("#phase").textContent === "PLAYING" || document.querySelector("#phase").textContent === "ROUND OVER", null, { timeout: 10000 });
    await guest.waitForFunction(() => document.querySelectorAll("#myCards .card").length >= 2, null, { timeout: 10000 });

    if (errors.length) throw new Error("Browser console errors: " + errors.join(" | "));
    console.log("PASS: host registration, guest join, two-way roster sync, ready state, and round start");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
