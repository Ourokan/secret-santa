# 🎅 Secret Santa

Live site: https://ourokan.github.io/secret-santa/

A whimsical Secret Santa web app with a Santa shiba mascot.

- **Only the organizer signs in.** They type in the names, then share one link.
- **Pick your name, open once:** people tap their name and see their match one time, with a reminder to screenshot it. The one-time lock is enforced by Firestore security rules (participants get a silent anonymous session).
- **Saved for the organizer:** matches stay in the database, so the organizer can show a person's match, copy a ready-to-text message, or let them open it again.
- **Never-pair list:** block pairs (both directions, or one way) so partners or housemates don't draw each other.
- **Multiple gifts per person:** set *k*, and everyone gives exactly *k* gifts and receives exactly *k*. The draw is balanced, never self-assigns, never repeats a recipient, and avoids A↔B swaps when possible.

## How it's built

| Piece | Where |
| --- | --- |
| Static front end (vanilla JS modules) | `public/`, deployed to GitHub Pages by `.github/workflows/pages.yml` |
| Matching algorithm (b-matching via augmenting paths, then edge-swap shuffling) | `public/match.js`, tested by `test/match.test.mjs` |
| Auth + database | Firebase project `secret-santa-ourokan` (Auth: Google, email, anonymous + Firestore) |
| Security rules | `firestore.rules` |

The Firebase SDK is bundled at build time (`npm run build` → `public/vendor/firebase.js`).

## Develop

```bash
npm install
npm test          # matching algorithm tests
npm run build     # bundle Firebase SDK
npx serve public  # or any static server
```

## Changing the security rules

Edit `firestore.rules`, then from a machine with the Firebase CLI:

```bash
firebase deploy --only firestore:rules --project secret-santa-ourokan
```

If you serve the site from a new domain, add it under Firebase console → Authentication → Settings → Authorized domains.
