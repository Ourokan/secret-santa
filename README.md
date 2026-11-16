# 🎅 Secret Santa

Live site: https://ourokan.github.io/secret-santa/

A whimsical Secret Santa web app with a Santa shiba mascot.

- **Sign up** with Google or email, create an exchange, and share the invite link.
- **Anonymous matches:** each person can only read their own assignment, enforced by Firestore security rules. Not even the organizer can see who got whom.
- **Never-pair list:** block pairs (both directions, or one way) so partners or housemates don't draw each other.
- **Multiple gifts per person:** set *k*, and everyone gives exactly *k* gifts and receives exactly *k*. The draw is balanced, never self-assigns, never repeats a recipient, and avoids A↔B swaps when possible.

## How it's built

| Piece | Where |
| --- | --- |
| Static front end (vanilla JS modules) | `public/`, deployed to GitHub Pages by `.github/workflows/pages.yml` |
| Matching algorithm (b-matching via augmenting paths, then edge-swap shuffling) | `public/match.js`, tested by `test/match.test.mjs` |
| Auth + database | Firebase project `secret-santa-ourokan` (Auth + Firestore) |
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
