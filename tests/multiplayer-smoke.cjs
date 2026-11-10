const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const signalOrigin = process.env.BLACKJACK_SIGNALING_URL || "http://127.0.0.1:8787";
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/config.js") {
    res.writeHead(200, { "content-type": mime[".js"] });
    res.end("window.BLACKJACK_SIGNALING_URL = " + JSON.stringify(signalOrigin) + ";");
    return;
  }
  const name = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!["index.html", "relay-client.js"].includes(name)) {
    res.writeHead(404); res.end("Not found"); return;
  }
  res.writeHead(200, { "content-type": mime[path.extname(name)] });
  res.end(fs.readFileSync(path.join(root, name)));
});

(async () => {
  const health = await fetch(signalOrigin.replace(/\/$/, "") + "/health");
  if (!health.ok) throw new Error("Signaling Worker health check failed: HTTP " + health.status);
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
    await host.waitForFunction(() => document.querySelector("#netState").textContent === "Room online", null, { timeout: 20000 });
    const code = await host.locator("#roomCode").textContent();
    if (!code || !/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new Error("Host did not publish a valid room code");

    await guest.goto("http://127.0.0.1:4173");
    await guest.locator("#name").fill("CI Guest");
    await guest.locator("#joinCode").fill(code);
    await guest.locator("#join").click();
    await guest.waitForFunction(() => document.querySelector("#netState").textContent === "Connected to host", null, { timeout: 20000 });
    await host.waitForFunction(() => [...document.querySelectorAll(".seat")].some(el => el.textContent.includes("CI Guest")), null, { timeout: 10000 });
    await guest.waitForFunction(() => [...document.querySelectorAll(".seat")].some(el => el.textContent.includes("CI Host")), null, { timeout: 10000 });

    await guest.locator("#ready").click();
    await host.waitForFunction(() => !document.querySelector("#start").disabled, null, { timeout: 10000 });
    await host.locator("#start").click();
    await host.waitForFunction(() => document.querySelector("#phase").textContent === "PLAYING" || document.querySelector("#phase").textContent === "ROUND OVER", null, { timeout: 10000 });
    await guest.waitForFunction(() => document.querySelectorAll("#myCards .card").length >= 2, null, { timeout: 10000 });

    if (errors.length) throw new Error("Browser console errors: " + errors.join(" | "));
    console.log("PASS: Cloudflare Worker health, host room, guest join, roster sync, ready state, and round start");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
