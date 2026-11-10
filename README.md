# Blackjack — Friends Table

A static browser Blackjack table designed for private games with friends. Six seats, room codes, four themes, anonymous Firebase sign-in, and virtual chips only.

## Important status

This is an **early friends-only prototype**, not a secure or cheat-proof multiplayer casino. The current browser client stores game state in a shared Firestore room document. A player with browser developer tools could manipulate state, inspect the shoe, or alter chips. Never use real money, prizes, or anything of value.

The UI includes Hit, Stand, Double and a preliminary Split control. Split-hand turn sequencing and settlement are not complete in this prototype. Treat it as a build-in-progress, not a finished rules-complete game.

## Zero-cost hosting target

- GitHub Pages for static files (free for public repositories).
- Firebase Spark plan for Authentication and Firestore within free quotas.
- No Cloud Functions, Cloud Run, paid hosting, or real-money features.

Firebase quotas and product terms can change. Do not upgrade to Blaze or enable billing if your requirement is strictly $0.

## 1. Create Firebase project

1. Open https://console.firebase.google.com/ and create a project.
2. Add a Web app (</> icon).
3. Copy the Firebase web config.
4. In **Authentication → Sign-in method**, enable **Anonymous**.
5. Create a **Cloud Firestore** database.
6. Choose a region near your players. Firestore's location cannot be changed after creation.

## 2. Add Firebase config

Open `index.html` and replace the placeholder values in `firebaseConfig`:

```js
const firebaseConfig = {
  apiKey: "YOUR_WEB_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  appId: "YOUR_WEB_APP_ID"
};
```

These web-app config values are identifiers, not service-account private keys. Never put service-account JSON, private keys, or Admin SDK credentials in this repository.

## 3. Firestore rules — prototype warning

The current prototype performs direct client writes to the room document. To make that prototype sync between friends, Firestore rules must permit authenticated clients to read and update room documents. That permission model is **not secure**: a room member can tamper with game state, and rules cannot safely validate a complete Blackjack engine.

Do not deploy permissive rules for a public game. For a truly secure design, game mutations must go through a trusted server that keeps the shoe, dealer hole card, balances, and settlement private. That requires a backend service; this repository intentionally does not deploy one because the target budget is $0.

If keeping strict $0 is non-negotiable, accept that this is a casual, trust-based game among friends. Use a private invite code and do not share it publicly.

## 4. Enable GitHub Pages

1. In the GitHub repository, open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch `main` and folder `/ (root)`; save.
4. GitHub will show the published URL when the Pages deployment completes.

For free GitHub Pages on GitHub Free, the repository generally needs to be public. This repository is currently private; change it under **Settings → General → Danger Zone → Change repository visibility → Public** before enabling free Pages. Review the repository contents first.

## 5. Play

1. Open the published page.
2. Enter a display name and create a private room.
3. Share the invite link or six-character room code with friends.
4. Friends open the same site, enter their names and join the code.
5. Host starts a round. Chips are fictional.

## Known limitations in this build

- Browser-side game authority; not cheat-proof.
- Anonymous identities are tied to browser storage and are not recoverable across devices.
- Split is not fully implemented.
- Reconnection and room cleanup are basic.
- No moderation, server-side rate limiting, or authoritative anti-cheat.
- Offline demo mode only works in the same browser; cross-device play requires Firebase config and Firestore permissions.

## Project files

- `index.html` — single-page game.
