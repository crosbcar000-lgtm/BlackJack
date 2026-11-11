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

    // Verify responsive layout, keyboard focus, motion polish, and reduced-motion support.
    await host.setViewportSize({ width: 375, height: 812 });
    const mobileOverflow = await host.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (mobileOverflow) throw new Error("Mobile layout has horizontal page overflow");
    const polish = await host.evaluate(() => ({
      panelAnimation: getComputedStyle(document.querySelector(".panel")).animationName,
      tableTransition: getComputedStyle(document.querySelector("#gameTable") || document.querySelector(".table")).transitionDuration,
      focusStyle: getComputedStyle(document.querySelector("button")).outlineStyle,
      reducedMotionRule: [...document.styleSheets].some(sheet => {
        try { return [...sheet.cssRules].some(rule => rule.conditionText?.includes("prefers-reduced-motion")); }
        catch { return false; }
      })
    }));
    if (polish.panelAnimation !== "panel-arrive" || !polish.reducedMotionRule) throw new Error("Visual polish or reduced-motion styles are missing");
    await host.emulateMedia({ reducedMotion: "reduce" });
    await host.locator("#create").focus();
    const reducedDuration = await host.locator("#create").evaluate(el => getComputedStyle(el).transitionDuration);
    if (!reducedDuration || parseFloat(reducedDuration) > 0.001) throw new Error("Reduced-motion preference is not respected");
    await host.emulateMedia({ reducedMotion: "no-preference" });
    await host.setViewportSize({ width: 1280, height: 900 });

    // Game and Settings are separate tabs; rules stay compact until expanded.
    if (await host.locator("#gameTab").getAttribute("aria-selected") !== "true") throw new Error("Game tab should be active by default");
    if (await host.locator("#rulesDropdown").evaluate(el => el.open)) throw new Error("Rules dropdown should start collapsed");
    await host.locator("#rulesDropdown summary").click();
    if (!(await host.locator("#rulesText").isVisible())) throw new Error("Rules dropdown did not reveal the current rules");
    await host.locator("#gameModeSelect").selectOption("holdem");
    if (!(await host.locator("#rulesText").textContent()).includes("Texas Hold’em")) throw new Error("Rules did not update for Texas Hold’em");
    await host.locator("#gameModeSelect").selectOption("roulette");
    if (!(await host.locator("#rulesText").textContent()).includes("European roulette")) throw new Error("Rules did not update for roulette");
    await host.locator("#gameModeSelect").selectOption("blackjack");
    await host.locator("#rulesDropdown summary").click();
    await host.locator("#settingsTab").click();
    if (!(await host.locator("#settingsView").isVisible()) || await host.locator("#gameView").isVisible()) throw new Error("Settings tab did not replace the Game view");

    // Verify every theme selects correctly and changes the actual table texture.
    const themeNames = ["royal", "neon", "midnight", "purple", "arcade", "starship", "dungeon", "noir", "pixel", "circuit", "spellbook", "wasteland", "kaiju"];
    const tableLooks = new Set();
    const previewLooks = new Set();
    for (const theme of themeNames) {
      const button = host.locator('.theme-grid button[data-theme="' + theme + '"]');
      if (await button.count() !== 1) throw new Error("Missing theme option: " + theme);
      await button.click();
      const selected = await button.getAttribute("aria-pressed");
      const look = await host.locator(".table").evaluate(el => {
        const style = getComputedStyle(el);
        const ornament = getComputedStyle(el, "::before");
        return style.backgroundImage + "|" + style.borderTopColor + "|" + style.backgroundColor +
          "|" + style.borderRadius + "|" + style.borderStyle + "|" + style.borderTopWidth +
          "|" + ornament.backgroundImage + "|" + ornament.borderRadius;
      });
      if (selected !== "true") throw new Error("Theme button did not become selected: " + theme);
      if (!look || look.includes("none")) throw new Error("Table texture did not render for theme: " + theme);
      tableLooks.add(look);
      const preview = await host.locator("#themePreviewBoard").evaluate(el => ({
        theme:el.dataset.previewTheme,visible:!!el.getClientRects().length,
        border:getComputedStyle(el).borderTopColor,image:getComputedStyle(el).backgroundImage,
        label:document.querySelector("#themePreviewLabel").textContent
      }));
      if (!preview.visible || preview.theme !== theme || !preview.border || !preview.image.includes("gradient") || !preview.label.startsWith("Previewing ")) throw new Error("Live theme preview did not update for " + theme + ": " + JSON.stringify(preview));
      previewLooks.add(preview.border+"|"+preview.image);
      const saved = await host.evaluate(() => localStorage.getItem("bj-theme"));
      if (saved !== theme) throw new Error("Theme was not saved on this device: " + theme);
    }
    if (tableLooks.size !== themeNames.length) throw new Error("Some themes share the same table appearance; expected 13 unique looks, got " + tableLooks.size);
    if (previewLooks.size !== themeNames.length) throw new Error("Live board preview did not show 13 distinct theme appearances; got " + previewLooks.size);
    await host.locator('.theme-grid button[data-theme="royal"]').click();
    await host.locator("#cardThemeSelect").selectOption("classic");
    if (await host.locator("body").getAttribute("data-card-theme") !== "classic") throw new Error("Independent card theme did not apply");
    if (await host.evaluate(() => localStorage.getItem("bj-card-theme")) !== "classic") throw new Error("Card theme was not saved");
    await host.locator("#cardThemeSelect").selectOption("match");
    await host.locator("#gameTab").click();

    await host.locator("#name").fill("CI Host");
    await host.locator("#create").click();
    await host.waitForFunction(() => document.querySelector("#netState").textContent === "Room online", null, { timeout: 20000 });
    const code = await host.locator("#roomCode").textContent();
    if (!code || !/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new Error("Host did not publish a valid room code");
    const gameFootprint = await host.locator("#gameTable").evaluate(el => ({
      width: el.getBoundingClientRect().width,
      parentWidth: el.parentElement.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height
    }));
    if (gameFootprint.width < gameFootprint.parentWidth * 0.92 || gameFootprint.height < 420) throw new Error("Game table is not using the expanded play area: " + JSON.stringify(gameFootprint));

    await guest.goto("http://127.0.0.1:4173");
    await guest.locator("#name").fill("CI Guest");
    await guest.locator("#joinCode").fill(code);
    await guest.locator("#join").click();
    await guest.waitForFunction(() => document.querySelector("#netState").textContent === "Connected to host", null, { timeout: 20000 });
    await host.waitForFunction(() => [...document.querySelectorAll(".seat")].some(el => el.textContent.includes("CI Guest")), null, { timeout: 10000 });
    await guest.waitForFunction(() => [...document.querySelectorAll(".seat")].some(el => el.textContent.includes("CI Host")), null, { timeout: 10000 });
    for (const page of [host, guest]) {
      const layout = await page.evaluate(() => {
        const main = document.querySelector(".layout > main").getBoundingClientRect();
        const chat = document.querySelector("#chatSidebar").getBoundingClientRect();
        return {mainRight:main.right,chatLeft:chat.left,chatWidth:chat.width,visible:!!document.querySelector("#chatSidebar").getClientRects().length};
      });
      if (!layout.visible || layout.chatLeft < layout.mainRight - 1 || layout.chatWidth < 270) throw new Error("Chat is not arranged as a visible right-side panel: " + JSON.stringify(layout));
    }

    // Lobby chat syncs in both directions and renders user text without HTML interpretation.
    await host.locator("#lobbyChatInput").fill("Welcome, team!");
    await host.locator("#lobbyChatSend").click();
    await guest.waitForFunction(() => [...document.querySelectorAll("#chatLog .chat-message p")].some(el => el.textContent === "Welcome, team!"), null, { timeout: 10000 });
    await guest.locator("#lobbyChatInput").fill("Hi from the guest.");
    await guest.locator("#lobbyChatSend").click();
    await host.waitForFunction(() => [...document.querySelectorAll("#chatLog .chat-message p")].some(el => el.textContent === "Hi from the guest."), null, { timeout: 10000 });
    if (await guest.locator("#chatLog .chat-message p").count() !== 2 || await host.locator("#chatLog .chat-message p").count() !== 2) throw new Error("Lobby chat history did not sync to both players");

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
    const blackjackActionLogic = await host.locator("#double").evaluate(el => ({
      doubleDisabled:el.disabled,
      splitDisabled:document.querySelector("#split").disabled
    }));
    if (blackjackActionLogic.doubleDisabled || blackjackActionLogic.splitDisabled) throw new Error("Blackjack double/split controls were unexpectedly disabled at the active pair");
    if (!(await host.locator("#chatSidebar").isVisible()) || !(await guest.locator("#chatSidebar").isVisible())) throw new Error("Chat sidebar should stay visible while a hand is active");
    await host.locator("#lobbyChatInput").fill("Host live during the hand.");
    await host.locator("#lobbyChatSend").click();
    await guest.waitForFunction(() => [...document.querySelectorAll("#chatLog .chat-message p")].some(el => el.textContent === "Host live during the hand."), null, { timeout: 10000 });
    await guest.locator("#lobbyChatInput").fill("Guest live during the hand.");
    await guest.locator("#lobbyChatSend").click();
    await host.waitForFunction(() => [...document.querySelectorAll("#chatLog .chat-message p")].some(el => el.textContent === "Guest live during the hand."), null, { timeout: 10000 });
    await guest.waitForFunction(() => document.querySelectorAll("#myCards .card").length === 2, null, { timeout: 10000 });

    await host.locator("#split").click();
    await host.waitForFunction(() => [...document.querySelectorAll(".seat")].some(el => el.textContent.includes("CI Host") && el.textContent.includes("480")), null, { timeout: 10000 });
    await guest.waitForFunction(() => [...document.querySelectorAll(".seat")].some(el => el.textContent.includes("CI Host") && el.textContent.includes("480")), null, { timeout: 10000 });
    await guest.waitForFunction(() => !document.querySelector("#stand").disabled, null, { timeout: 10000 });
    await guest.locator("#stand").click();

    await host.waitForFunction(() => document.querySelector("#phase").textContent === "ROUND OVER", null, { timeout: 10000 });
    await guest.waitForFunction(() => document.querySelector("#phase").textContent === "ROUND OVER", null, { timeout: 10000 });
    // The dealer's hole card flips face-up on showdown for both players.
    await host.waitForFunction(() => {
      const card = document.querySelector("#dealerCards .dealer-flip-scene[data-reveal='animated']");
      return card && card.classList.contains("is-flipped");
    }, null, { timeout: 5000 });
    await guest.waitForFunction(() => {
      const card = document.querySelector("#dealerCards .dealer-flip-scene[data-reveal='animated']");
      return card && card.classList.contains("is-flipped");
    }, null, { timeout: 5000 });
    for (const page of [host, guest]) {
      const flip = await page.locator("#dealerCards .dealer-flip-scene").evaluate(el => ({
        count: document.querySelectorAll("#dealerCards .dealer-flip-scene").length,
        reveal: el.dataset.reveal,
        duration: getComputedStyle(el.querySelector(".dealer-flip-inner")).transitionDuration
      }));
      if (flip.count !== 1 || flip.reveal !== "animated" || !flip.duration.includes("0.82s")) {
        throw new Error("Dealer reveal did not use the flip animation: " + JSON.stringify(flip));
      }
    }
    const hostSeat = await host.locator(".seat").filter({ hasText: "CI Host" }).textContent();
    const guestSeat = await guest.locator(".seat").filter({ hasText: "CI Guest" }).textContent();
    const hostBanner = await host.locator("#resultBanner").textContent();
    const guestBanner = await guest.locator("#resultBanner").textContent();
    const roundStatus = await host.locator("#gameStatus").textContent();
    if (!hostSeat.includes("520") || !hostSeat.includes("Hand 1: Win") || !hostSeat.includes("Hand 2: Win")) throw new Error("Host split-hand outcomes or payout incorrect: " + hostSeat);
    if (!guestSeat.includes("500") || !guestSeat.includes("Push")) throw new Error("Guest push result or payout incorrect: " + guestSeat);
    if (!hostBanner.includes("YOU WON") || !guestBanner.includes("PUSH")) throw new Error("Personal result banners incorrect; host=" + hostBanner + ", guest=" + guestBanner);
    if (roundStatus.includes("CI Host") || roundStatus.includes("CI Guest")) throw new Error("Round status still lists other players' outcomes: " + roundStatus);
    await host.setViewportSize({ width: 1280, height: 768 });
    const nextButtonFrame = await host.locator("#next").evaluate(el => ({
      visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
      top: el.getBoundingClientRect().top,
      bottom: el.getBoundingClientRect().bottom,
      viewport: window.innerHeight
    }));
    if (!nextButtonFrame.visible || nextButtonFrame.top < 0 || nextButtonFrame.bottom > nextButtonFrame.viewport) {
      throw new Error("Next round button is below the fold; the round action should be visible without scrolling: " + JSON.stringify(nextButtonFrame));
    }

    await host.setViewportSize({ width: 1280, height: 900 });

    // The Next round button deals immediately; no lobby/Ready/Start detour.
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
    await host.locator("#next").click();
    await host.waitForFunction(() => document.querySelector("#phase").textContent === "PLAYING" && !document.querySelector("#stand").disabled, null, { timeout: 10000 });
    await guest.waitForFunction(() => document.querySelector("#phase").textContent === "PLAYING" && document.querySelectorAll("#myCards .card").length === 2, null, { timeout: 10000 });
    if (await host.locator("#start").isVisible() || await host.locator("#next").isVisible()) throw new Error("Next round did not immediately transition into the active hand");
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

    // Face cards use original theme-specific court artwork and re-render live when themes change.
    const initialCourts = guest.locator(".court-card");
    if (await initialCourts.count() < 3) throw new Error("Expected illustrated K/Q/K court cards in the deterministic round");
    const firstCourt = initialCourts.first();
    const initialSvg = await firstCourt.locator("svg.court-art").count();
    await guest.locator("#settingsTab").click();
    if (!(await guest.locator("#settingsView").isVisible())) throw new Error("Guest could not open Settings while in a room");
    if (initialSvg !== 1) throw new Error("Face card is missing its inline vector portrait");
    const courtThemes = ["royal", "neon", "midnight", "purple", "arcade", "starship", "dungeon", "noir", "pixel", "circuit", "spellbook", "wasteland", "kaiju"];
    const courtArtwork = new Set();
    for (const theme of courtThemes) {
      await guest.locator('.theme-grid button[data-theme="' + theme + '"]').click();
      const faceTheme = await firstCourt.getAttribute("data-face-theme");
      if (faceTheme !== theme) throw new Error("Court artwork did not refresh for board theme: " + theme + " (got " + faceTheme + ")");
      const artwork = await firstCourt.locator("svg.court-art").evaluate(el => el.outerHTML);
      const frame = await firstCourt.evaluate(el => {
        const style = getComputedStyle(el);
        const ornament = getComputedStyle(el, "::before");
        return style.borderColor + "|" + style.borderStyle + "|" + style.borderRadius + "|" + ornament.backgroundImage;
      });
      courtArtwork.add(artwork + "|" + frame);
    }
    if (courtArtwork.size !== courtThemes.length) throw new Error("Some board themes reused the same court-card artwork");
    for (const style of ["classic", "midnight", "neon", "pixel", "gold"]) {
      await guest.locator("#cardThemeSelect").selectOption(style);
      const faceTheme = await firstCourt.getAttribute("data-face-theme");
      if (faceTheme !== style) throw new Error("Independent card theme did not restyle face cards: " + style);
    }
    await guest.locator("#cardThemeSelect").selectOption("match");
    await guest.locator('.theme-grid button[data-theme="kaiju"]').click();
    if (await firstCourt.getAttribute("data-face-theme") !== "kaiju") throw new Error("Match card style did not follow the selected board theme");
    await guest.locator("#gameTab").click();

    // Texas Hold'em: private hole cards, shared board, and all four betting streets.
    await guest.locator("#leave").click();
    await host.locator("#leave").click();
    await host.locator("#gameModeSelect").selectOption("holdem");
    await host.locator("#name").fill("CI Host");
    await host.locator("#create").click();
    await host.waitForFunction(() => document.querySelector("#netState").textContent === "Room online", null, { timeout: 20000 });
    const holdemCode = await host.locator("#roomCode").textContent();
    await guest.locator("#name").fill("CI Guest");
    await guest.locator("#joinCode").fill(holdemCode);
    await guest.locator("#join").click();
    await guest.waitForFunction(() => document.querySelector("#netState").textContent === "Connected to host", null, { timeout: 20000 });
    await guest.locator("#ready").click();
    await host.waitForFunction(() => !document.querySelector("#start").disabled, null, { timeout: 10000 });
    await host.locator("#start").click();
    await host.waitForFunction(() => document.querySelector("#phase").textContent === "PLAYING" && document.querySelectorAll("#myHoleCards .card").length === 2, null, { timeout: 10000 });
    await guest.waitForFunction(() => document.querySelectorAll("#myHoleCards .card").length === 2, null, { timeout: 10000 });
    if (await guest.locator("#communityCards .card").count() !== 0) throw new Error("Community cards appeared before the pre-flop betting round");
    await guest.locator("#holdemCheckCall").click();
    await host.locator("#holdemCheckCall").click();
    await host.waitForFunction(() => document.querySelectorAll("#communityCards .card").length === 3, null, { timeout: 10000 });
    await host.locator("#holdemCheckCall").click();
    await guest.locator("#holdemCheckCall").click();
    await host.waitForFunction(() => document.querySelectorAll("#communityCards .card").length === 4, null, { timeout: 10000 });
    await host.locator("#holdemCheckCall").click();
    await guest.locator("#holdemCheckCall").click();
    await host.waitForFunction(() => document.querySelectorAll("#communityCards .card").length === 5, null, { timeout: 10000 });
    await host.locator("#holdemCheckCall").click();
    await guest.locator("#holdemCheckCall").click();
    await host.waitForFunction(() => document.querySelector("#phase").textContent === "ROUND OVER", null, { timeout: 10000 });
    await guest.waitForFunction(() => document.querySelector("#phase").textContent === "ROUND OVER", null, { timeout: 10000 });
    if (await host.locator("#myHoleCards .card").count() !== 2 || await host.locator("#communityCards .card").count() !== 5) throw new Error("Hold’em showdown did not show two hole cards and five community cards");
    const holdSeat = await host.locator(".seat").filter({ hasText: "CI Host" }).textContent();
    if (!holdSeat.includes("Won") && !holdSeat.includes("Lost")) throw new Error("Hold’em player list did not show a showdown result: " + holdSeat);
    await host.locator("#next").click();
    await host.waitForFunction(() => document.querySelector("#phase").textContent === "PLAYING" && document.querySelectorAll("#myHoleCards .card").length === 2 && document.querySelectorAll("#communityCards .card").length === 0, null, { timeout: 10000 });
    await guest.waitForFunction(() => document.querySelector("#phase").textContent === "PLAYING" && document.querySelectorAll("#myHoleCards .card").length === 2, null, { timeout: 10000 });
    if (await host.locator("#holdemPot").textContent() !== "15") throw new Error("Next Hold’em hand did not deal immediately with fresh blinds");

    // Roulette: one bet per player, a deterministic red result, and 1:1 payouts.
    await guest.locator("#leave").click();
    await host.locator("#leave").click();
    await host.locator("#gameModeSelect").selectOption("roulette");
    await host.locator("#name").fill("CI Host");
    await host.locator("#create").click();
    await host.waitForFunction(() => document.querySelector("#netState").textContent === "Room online", null, { timeout: 20000 });
    const rouletteCode = await host.locator("#roomCode").textContent();
    await guest.locator("#name").fill("CI Guest");
    await guest.locator("#joinCode").fill(rouletteCode);
    await guest.locator("#join").click();
    await guest.waitForFunction(() => document.querySelector("#netState").textContent === "Connected to host", null, { timeout: 20000 });
    await host.locator("#rouletteBetType").selectOption("red");
    await guest.locator("#rouletteBetType").selectOption("black");
    await host.locator("#placeRouletteBet").click();
    await guest.locator("#placeRouletteBet").click();
    await host.waitForFunction(() => !document.querySelector("#start").disabled, null, { timeout: 10000 });
    await host.evaluate(() => { Math.random = () => 0.05; });
    await host.locator("#start").click();
    await host.waitForFunction(() => document.querySelector("#phase").textContent === "ROUND OVER" && document.querySelector("#rouletteResult").textContent === "1", null, { timeout: 10000 });
    const rouletteHostSeat = await host.locator(".seat").filter({ hasText: "CI Host" }).textContent();
    const rouletteGuestSeat = await host.locator(".seat").filter({ hasText: "CI Guest" }).textContent();
    if (!rouletteHostSeat.includes("Won 20 chips") || !rouletteHostSeat.includes("510")) throw new Error("Roulette red payout incorrect: " + rouletteHostSeat);
    if (!rouletteGuestSeat.includes("Lost 10 chips") || !rouletteGuestSeat.includes("490")) throw new Error("Roulette black loss incorrect: " + rouletteGuestSeat);
    await host.evaluate(() => { Math.random = () => 0.05; });
    await host.locator("#next").click();
    await host.waitForFunction(() => document.querySelector("#phase").textContent === "ROUND OVER" && document.querySelector("#rouletteResult").textContent === "1", null, { timeout: 10000 });
    await guest.waitForFunction(() => document.querySelector("#phase").textContent === "ROUND OVER" && document.querySelector("#rouletteResult").textContent === "1", null, { timeout: 10000 });
    const rouletteHostSecondSeat = await host.locator(".seat").filter({ hasText: "CI Host" }).textContent();
    const rouletteGuestSecondSeat = await guest.locator(".seat").filter({ hasText: "CI Guest" }).textContent();
    if (!rouletteHostSecondSeat.includes("520") || !rouletteGuestSecondSeat.includes("480")) throw new Error("Next roulette spin did not automatically repeat the previous wagers");

    // Green wins on zero at 35:1; repeated losing wagers are allowed to create debt.
    await guest.locator("#leave").click();
    await host.locator("#leave").click();
    await host.locator("#gameModeSelect").selectOption("roulette");
    await host.locator("#name").fill("CI Host");
    await host.locator("#create").click();
    await host.waitForFunction(() => document.querySelector("#netState").textContent === "Room online", null, { timeout: 20000 });
    const greenCode = await host.locator("#roomCode").textContent();
    await guest.locator("#name").fill("CI Guest");
    await guest.locator("#joinCode").fill(greenCode);
    await guest.locator("#join").click();
    await guest.waitForFunction(() => document.querySelector("#netState").textContent === "Connected to host", null, { timeout: 20000 });
    if (!(await host.locator("#rouletteBetType option[value='green']").count())) throw new Error("Green roulette bet option is missing");
    await host.locator("#rouletteBetType").selectOption("green");
    await guest.locator("#rouletteBetType").selectOption("black");
    await host.locator("#rouletteAmount").selectOption("50");
    await guest.locator("#rouletteAmount").selectOption("50");
    await host.locator("#placeRouletteBet").click();
    await guest.locator("#placeRouletteBet").click();
    await host.waitForFunction(() => !document.querySelector("#start").disabled, null, { timeout: 10000 });
    await host.evaluate(() => { Math.random = () => 0; });
    await host.locator("#start").click();
    await host.waitForFunction(() => document.querySelector("#phase").textContent === "ROUND OVER" && document.querySelector("#rouletteResult").textContent === "0", null, { timeout: 10000 });
    await guest.waitForFunction(() => document.querySelector("#phase").textContent === "ROUND OVER" && document.querySelector("#rouletteResult").textContent === "0", null, { timeout: 10000 });
    const greenHostSeat = await host.locator(".seat").filter({ hasText: "CI Host" }).textContent();
    const greenGuestSeat = await host.locator(".seat").filter({ hasText: "CI Guest" }).textContent();
    if (!greenHostSeat.includes("Won 1800 chips") || !greenHostSeat.includes("2250")) throw new Error("Green zero payout should pay 35:1 plus returned stake: " + greenHostSeat);
    if (!greenGuestSeat.includes("Lost 50 chips") || !greenGuestSeat.includes("450")) throw new Error("Green zero should beat a black bet: " + greenGuestSeat);

    // Ten more zero results drain the black bettor below zero. Next spin must still run.
    for (let spin = 0; spin < 10; spin++) {
      await host.evaluate(() => { Math.random = () => 0; });
      await host.locator("#next").click();
      await host.waitForFunction(() => document.querySelector("#phase").textContent === "ROUND OVER" && document.querySelector("#rouletteResult").textContent === "0", null, { timeout: 10000 });
      await guest.waitForFunction(() => document.querySelector("#phase").textContent === "ROUND OVER" && document.querySelector("#rouletteResult").textContent === "0", null, { timeout: 10000 });
    }
    const debtSeat = await host.locator(".seat").filter({ hasText: "CI Guest" }).textContent();
    if (!debtSeat.includes("-50") || !debtSeat.includes("BROKE ALERT") || !debtSeat.includes("IOU 50 chips")) {
      throw new Error("A player below zero should remain in the game and get the debt callout: " + debtSeat);
    }
    const debtCard = host.locator(".seat.in-debt").filter({ hasText: "CI Guest" });
    if (await debtCard.count() !== 1) throw new Error("Negative-balance player did not get the debt styling");

    if (errors.length) throw new Error("Browser console errors: " + errors.join(" | "));
    console.log("PASS: lobby chat, instant next rounds, dealer flip, green roulette 35:1 payout, negative chip balances and debt callouts, 13 themes, card styles, Blackjack, and Texas Hold’em");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
