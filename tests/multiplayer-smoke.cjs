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

    // Verify every theme selects correctly and changes the actual table texture.
    const themeNames = ["royal", "neon", "midnight", "purple", "arcade", "starship", "dungeon", "noir"];
    const tableLooks = new Set();
    for (const theme of themeNames) {
      const button = host.locator('[data-theme="' + theme + '"]');
      if (await button.count() !== 1) throw new Error("Missing theme option: " + theme);
      await button.click();
      const selected = await button.getAttribute("aria-pressed");
      const look = await host.locator(".table").evaluate(el => {
        const style = getComputedStyle(el);
        return style.backgroundImage + "|" + style.borderTopColor + "|" + style.backgroundColor;
      });
      if (selected !== "true") throw new Error("Theme button did not become selected: " + theme);
      if (!look || look.includes("none")) throw new Error("Table texture did not render for theme: " + theme);
      tableLooks.add(look);
      const saved = await host.evaluate(() => localStorage.getItem("bj-theme"));
      if (saved !== theme) throw new Error("Theme was not saved on this device: " + theme);
    }
    if (tableLooks.size !== themeNames.length) throw new Error("Some themes share the same table appearance; expected 8 unique looks, got " + tableLooks.size);
    await host.locator('[data-theme="royal"]').click();

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

    // Make the shuffle deterministic: dealer 10+7, host A+A, guest 10+7,
    // then split cards 10+10. This verifies split-ace 21 pays as a normal win.
    const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    const card = (suit, rank) => suit * 13 + ranks.indexOf(rank);
    const topCards = [
      card(0, "10"), card(3, "7"),   // dealer
      card(0, "A"), card(1, "A"),    // host pair
      card(2, "10"), card(1, "7"),   // guest hand
      card(3, "10"), card(1, "10")   // split aces
    ];
    const desiredDeck = Array.from({ length: 52 }, (_, i) => i)
      .filter(i => !topCards.includes(i))
      .concat(topCards.slice().reverse());
    const workingDeck = Array.from({ length: 52 }, (_, i) => i);
    const randomValues = [];
    for (let i = 51; i > 0; i--) {
      const j = workingDeck.slice(0, i + 1).indexOf(desiredDeck[i]);
      if (j < 0) throw new Error("Could not build deterministic deck shuffle");
      randomValues.push((j + 0.25) / (i + 1));
      [workingDeck[i], workingDeck[j]] = [workingDeck[j], workingDeck[i]];
    }
    await host.evaluate(values => {
      let index = 0;
      Math.random = () => values[index++] ?? 0;
    }, randomValues);

    await host.locator("#start").click();
    await host.waitForFunction(() => document.querySelector("#phase").textContent === "PLAYING" && !document.querySelector("#split").disabled, null, { timeout: 10000 });
    await guest.waitForFunction(() => document.querySelectorAll("#myCards .card").length === 2, null, { timeout: 10000 });

    await host.locator("#split").click();
    await host.waitForFunction(() => [...document.querySelectorAll(".seat")].some(el => el.textContent.includes("CI Host") && el.textContent.includes("480")), null, { timeout: 10000 });
    await guest.waitForFunction(() => [...document.querySelectorAll(".seat")].some(el => el.textContent.includes("CI Host") && el.textContent.includes("480")), null, { timeout: 10000 });
    await guest.waitForFunction(() => !document.querySelector("#stand").disabled, null, { timeout: 10000 });
    await guest.locator("#stand").click();

    await host.waitForFunction(() => document.querySelector("#phase").textContent === "ROUND OVER", null, { timeout: 10000 });
    await guest.waitForFunction(() => document.querySelector("#phase").textContent === "ROUND OVER", null, { timeout: 10000 });
    const hostSeat = await host.locator(".seat").filter({ hasText: "CI Host" }).textContent();
    const guestSeat = await guest.locator(".seat").filter({ hasText: "CI Guest" }).textContent();
    const hostBanner = await host.locator("#resultBanner").textContent();
    const guestBanner = await guest.locator("#resultBanner").textContent();
    const roundStatus = await host.locator("#gameStatus").textContent();
    if (!hostSeat.includes("520") || !hostSeat.includes("Hand 1: Win") || !hostSeat.includes("Hand 2: Win")) throw new Error("Host split-hand outcomes or payout incorrect: " + hostSeat);
    if (!guestSeat.includes("500") || !guestSeat.includes("Push")) throw new Error("Guest push result or payout incorrect: " + guestSeat);
    if (!hostBanner.includes("YOU WON") || !guestBanner.includes("PUSH")) throw new Error("Personal result banners incorrect; host=" + hostBanner + ", guest=" + guestBanner);
    if (roundStatus.includes("CI Host") || roundStatus.includes("CI Guest")) throw new Error("Round status still lists other players' outcomes: " + roundStatus);

    // Start another round in which the host loses, verifying the loss banner.
    await host.locator("#next").click();
    await host.waitForFunction(() => document.querySelector("#phase").textContent === "LOBBY" && !document.querySelector("#start").disabled, null, { timeout: 10000 });
    await guest.waitForFunction(() => document.querySelector("#phase").textContent === "LOBBY", null, { timeout: 10000 });
    const lossTopCards = [
      card(0, "10"), card(1, "K"),  // dealer: 20
      card(2, "10"), card(1, "6"), // host: 16
      card(2, "Q"), card(3, "K")   // guest: 20
    ];
    const lossDesiredDeck = Array.from({ length: 52 }, (_, i) => i)
      .filter(i => !lossTopCards.includes(i))
      .concat(lossTopCards.slice().reverse());
    const lossWorkingDeck = Array.from({ length: 52 }, (_, i) => i);
    const lossRandomValues = [];
    for (let i = 51; i > 0; i--) {
      const j = lossWorkingDeck.slice(0, i + 1).indexOf(lossDesiredDeck[i]);
      if (j < 0) throw new Error("Could not build losing-round test deck");
      lossRandomValues.push((j + 0.25) / (i + 1));
      [lossWorkingDeck[i], lossWorkingDeck[j]] = [lossWorkingDeck[j], lossWorkingDeck[i]];
    }
    await host.evaluate(values => {
      let index = 0;
      Math.random = () => values[index++] ?? 0;
    }, lossRandomValues);
    await host.locator("#start").click();
    await host.waitForFunction(() => document.querySelector("#phase").textContent === "PLAYING" && !document.querySelector("#stand").disabled, null, { timeout: 10000 });
    await host.locator("#stand").click();
    await guest.waitForFunction(() => !document.querySelector("#stand").disabled, null, { timeout: 10000 });
    await guest.locator("#stand").click();
    await host.waitForFunction(() => document.querySelector("#phase").textContent === "ROUND OVER", null, { timeout: 10000 });
    await guest.waitForFunction(() => document.querySelector("#phase").textContent === "ROUND OVER", null, { timeout: 10000 });
    const losingHostBanner = await host.locator("#resultBanner").textContent();
    const losingGuestBanner = await guest.locator("#resultBanner").textContent();
    const losingHostSeat = await host.locator(".seat").filter({ hasText: "CI Host" }).textContent();
    if (!losingHostBanner.includes("YOU LOST") || !losingGuestBanner.includes("PUSH")) throw new Error("Loss/push banners incorrect; host=" + losingHostBanner + ", guest=" + losingGuestBanner);
    if (!losingHostSeat.includes("Dealer wins")) throw new Error("Player list does not show the host's loss: " + losingHostSeat);
    if (errors.length) throw new Error("Browser console errors: " + errors.join(" | "));
    console.log("PASS: Multiplayer join, roster sync, ready state, split/payout rules, personal win/loss/push banners, and per-player results");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
