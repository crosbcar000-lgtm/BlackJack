# Blackjack — Friends Table

A browser-based, friends-only Blackjack game for up to six players. GitHub Pages serves the static game; a Cloudflare Worker and Durable Object relay multiplayer messages over WebSockets. The host's browser remains authoritative for dealing and game rules.

## Cost and services

- **Website:** GitHub Pages (free for public repositories under GitHub Free).
- **Multiplayer signaling/relay:** Cloudflare Workers + SQLite-backed Durable Objects. The current Workers Free plan includes 100,000 Worker requests/day; Durable Objects include 100,000 requests/day and 13,000 GB-s/day. Free-plan overages are rejected rather than automatically billed. The Worker uses the Durable Objects WebSocket Hibernation API so idle connections can hibernate.
- **No Firebase:** no Firebase project, database subscription, or Firebase SDK.
- **No paid game server is required for low-volume class/friends testing.** Check current Cloudflare limits and your account's billing settings before deploying.

This is a relay architecture, not browser-to-browser PeerJS. The Worker forwards small game messages between the host and guests; it does not decide game outcomes. WebSockets may still be blocked by managed networks. Use only network endpoints approved by your teacher/network administrator.

## 1. Deploy the multiplayer Worker

You need a free Cloudflare account and permission to deploy Workers and Durable Objects.

1. Install Node.js 20 or newer.
2. From the repository directory, install dependencies:
   ```sh
   npm install
   ```
3. Authenticate Wrangler:
   ```sh
   npx wrangler login
   ```
4. Deploy:
   ```sh
   npx wrangler deploy
   ```
5. Wrangler provisions the `Room` Durable Object binding from `wrangler.toml` and prints a URL similar to:
   `https://blackjack-signaling.YOUR-SUBDOMAIN.workers.dev`
6. Open that URL with `/health` appended. A working deployment returns JSON with `"ok": true`.

The Worker exposes:
- `GET /health` — health check.
- `GET /ws/host?room=ABC123` — host WebSocket.
- `GET /ws/guest?room=ABC123&peer=guest-id` — guest WebSocket.

Room codes are isolated into separate Durable Objects. Each room supports one host and up to five guests. The Worker forwards JSON messages only; the host browser retains game authority.

## 2. Configure the website

Edit `config.js` and replace the placeholder URL with the HTTPS Worker origin printed by Wrangler:

```js
window.BLACKJACK_SIGNALING_URL = "https://blackjack-signaling.YOUR-SUBDOMAIN.workers.dev";
```

Do not include `/health` or a trailing path. Commit and push the updated `config.js`.

## 3. Publish with GitHub Pages

1. Make sure the repository is public.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select branch `main` and folder `/(root)`, then save.
5. Wait for the Pages deployment to finish.

The website remains static; multiplayer is handled by the separately deployed Worker.

## Play with friends

1. Open the GitHub Pages URL.
2. Enter a display name and select **Create room**.
3. Share the six-character room code or invite link.
4. Friends open the same site, enter their names and room code, then select **Join room**.
5. Everyone selects **Ready**. The host selects **Start round**.

## Local development and tests

Run the Worker locally in one terminal:

```sh
npx wrangler dev --local --ip 127.0.0.1 --port 8787
```

For the browser smoke test, run:

```sh
npm install
npx playwright install chromium
npm run test:browser
```

The smoke test serves the static client locally and connects both browser contexts to the local Worker. GitHub Actions runs the same flow on pushes to `main`.

## Game features

- Up to six players; private six-character room codes and shareable invite links.
- Four themes: Royal, Neon, Midnight, and Purple.
- Hit, Stand, Double, and Split.
- Aces count as 1 or 11; face cards count as 10.
- Dealer stands on 17; Blackjack pays 3:2.
- Virtual chips only; no deposits, cash value, or prizes.

## Trust model and limitations

- This is a casual, trust-based implementation, not a secure public multiplayer platform.
- The host's browser is authoritative and can manipulate game state.
- The Worker relays messages and enforces room connection limits; it does not validate Blackjack rules.
- If the host closes the tab, the room ends.
- A school/work firewall may block the Worker hostname or WebSocket traffic. A different hostname does not guarantee access; have the teacher/network administrator approve the endpoint.
- Cloudflare quotas and product terms can change. Check the current [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [limits](https://developers.cloudflare.com/workers/platform/limits/) before use. Free-plan quota exhaustion can interrupt new connections or messages.
- No accounts, persistent identity, moderation, or long-term statistics.

## Files

- `index.html` — game UI and game rules.
- `relay-client.js` — browser WebSocket adapter.
- `config.js` — deployed Worker URL.
- `worker.js` — Cloudflare Worker and Durable Object room relay.
- `wrangler.toml` — Worker and Durable Object configuration.
