# Blackjack — Friends Table

A browser-based, friends-only Blackjack game for up to six players. It uses GitHub Pages for static hosting and direct browser-to-browser WebRTC connections via PeerJS.

## No Firebase and no paid hosting

This project does **not** use Firebase, Cloud Functions, a database subscription, or a paid game server.

- **Website:** GitHub Pages (free for public repositories under GitHub Free).
- **Multiplayer:** WebRTC peer-to-peer through the public PeerJS signaling service.
- **Game authority:** the room creator's browser hosts the game and validates turns.
- **Chips:** fictional only. No deposits, cash value, prizes, or real-money play.

The public PeerJS signaling service is an external dependency. It is offered for testing and small projects, can have limits or outages, and is not a guaranteed service-level offering. Direct WebRTC connections may also fail on some restrictive networks.

## Publish with GitHub Pages

1. Make sure the repository is **public**.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select branch `main` and folder `/(root)`, then save.
5. Wait for the Pages deployment to finish. GitHub will show the public website URL on the Pages settings screen.

No build step, Node.js, secrets, environment variables, or Firebase setup are required.

## Play with friends

1. Open the GitHub Pages URL.
2. Enter a display name and select **Create room**.
3. Share the six-character room code or **Copy invite** link.
4. Friends open the same site, enter their display names and room code, then select **Join room**.
5. Everyone selects **Ready**. The host selects **Start round**.
6. The host's browser handles dealing, turn order, dealer play, and chip settlement.

Up to six players can sit at one table. If a player disconnects mid-round, their remaining hands are stood automatically. The host can start the next round after settlement.

## Game features

- Four themes: Royal, Neon, Midnight, and Purple.
- Private six-character room codes and shareable invite links.
- Anonymous display names; no account or sign-in required.
- Hit, Stand, Double, and Split.
- Aces count as 1 or 11; face cards count as 10.
- Dealer stands on 17.
- Blackjack pays 3:2.
- Virtual chips only.

## Friends-only trust model and limitations

This is a **casual trust-based implementation**, not a secure public multiplayer platform.

- The host's browser is authoritative and can see the full deck and dealer hole card. A technically skilled host could manipulate the game.
- PeerJS's public signaling service helps peers discover each other; it does not host the game state.
- PeerJS cloud service limits, browser support, NAT/firewall restrictions, and network quality may affect connections.
- If the host closes the tab or loses connection, the room ends.
- No persistent accounts, cross-device identity recovery, moderation, or long-term stats.
- Do not use real money, prizes, or anything of value.

## Troubleshooting

- **PeerJS failed to load:** refresh the page; check whether your browser/network blocks the unpkg CDN.
- **Room not found:** make sure the host created the room and still has the page open; re-check the six-character code.
- **Unable to connect:** try another network or disable restrictive VPN/firewall settings. Some networks block WebRTC.
- **Invite opens but doesn't join:** entering the code and pressing Join is still required.

## Files

- `index.html` — complete static game client.
