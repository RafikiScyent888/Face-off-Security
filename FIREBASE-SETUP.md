# Going Live: letting students join from their own phones

Out of the box the game runs in **Local Mode** — fully playable, but the join
link only works in another tab on the host computer. To let your class join
from their own devices you need one free Firebase Realtime Database. It is free
at this scale. Firebase's free "Spark" plan allows **100 devices connected at
once** — a 40-student class uses 41, and even 80 students in one room uses 81.
Two 40-student rooms at the same time is 82. All comfortably inside it.

Budget about 10 minutes, once.

---

## 1. Create the project

1. Go to **https://console.firebase.google.com** and sign in with any Google account.
2. Click **Create a project** (or **Add project**).
3. Name it something like `faceoff-security`. Click **Continue**.
4. Google Analytics: **turn it off**. You don't need it. Click **Create project**.
5. Wait for it to finish, then click **Continue**.

## 2. Create the Realtime Database

> ⚠️ Pick **Realtime Database**, *not* Firestore. They're different products and
> this game uses Realtime Database.

1. In the left sidebar click **Build → Realtime Database**.
2. Click **Create Database**.
3. Location: pick the one closest to you (`us-central1` is fine).
4. Security rules: choose **Start in test mode**. Click **Enable**.
5. You'll land on a screen showing a URL like
   `https://faceoff-security-default-rtdb.firebaseio.com/` — that's your `databaseURL`.

## 3. Lock the rules down to just this game

Test mode expires after 30 days and allows access to your whole database. Fix
both problems now: click the **Rules** tab, replace everything with this, and
click **Publish**.

```json
{
  "rules": {
    "rooms": {
      ".read": true,
      ".write": true,
      "$room": {
        ".indexOn": ["ts"]
      }
    }
  }
}
```

This allows read/write only under `rooms/` and never expires. There is nothing
sensitive in there — team names, scores, and typed answers — and a stranger
would have to guess your 4-letter room code to see it. Codes change every time
you reload the host screen.

## 4. Get your config

1. Click the **⚙ gear icon** (top left, next to *Project Overview*) → **Project settings**.
2. Scroll to **Your apps** and click the **web icon** `</>`.
3. App nickname: `faceoff-sec`. **Do not** check "Firebase Hosting". Click **Register app**.
4. You'll see a code block containing `const firebaseConfig = { ... }`. Copy the
   part inside the curly braces.

It looks like this:

```js
const firebaseConfig = {
  apiKey: "AIzaSyD-EXAMPLE-KEY-1234567890",
  authDomain: "faceoff-security.firebaseapp.com",
  databaseURL: "https://faceoff-security-default-rtdb.firebaseio.com",
  projectId: "faceoff-security",
  storageBucket: "faceoff-security.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc123def456"
};
```

> **If `databaseURL` is missing** from what Firebase shows you, add it by hand —
> it's the URL from step 2.5. The game will not work without it.

## 5. Paste it into the game

Open **`firebase-config.js`** in VS Code. Change `enabled` to `true` and paste
your values in:

```js
window.FACEOFF_FIREBASE = {
  enabled: true,                       // <-- was false

  config: {
    apiKey: "AIzaSyD-EXAMPLE-KEY-1234567890",
    authDomain: "faceoff-security.firebaseapp.com",
    databaseURL: "https://faceoff-security-default-rtdb.firebaseio.com",
    projectId: "faceoff-security",
    storageBucket: "faceoff-security.appspot.com",
    messagingSenderId: "123456789012",
    appId: "1:123456789012:web:abc123def456"
  }
};
```

Save, commit, push. Load the host screen — the badge at the bottom of the home
page should now read **● LIVE MODE**.

### Is it safe to commit these keys to a public repo?

Yes. A Firebase web `apiKey` is a public project identifier, not a secret —
Google documents this explicitly. Your actual protection is the security rules
in step 3, which is why it matters that you restrict them to `rooms/`.

---

## Test it before class

1. Open the host screen on your computer.
2. Scan the QR with your phone **on cell data, not the school wifi**. If it
   joins, the internet path works.
3. Then try it on the school wifi. If that fails, see below.

## If the school network blocks it

Some districts block `*.firebaseio.com`. Symptoms: the host screen works, but
phones sit on "Looking for room…" forever.

You have two fallbacks, both already built in:

- **Ask IT to allowlist** `*.firebaseio.com` and `www.gstatic.com`.
- **Run it single-screen.** Set `enabled: false` and play off the projector
  alone: press keys **1–9** (then `0`, `-`, `=` for teams 10–12) to buzz for a
  team. Give each team a physical
  noisemaker, or just have them raise hands and you press the number. Everything
  else — board, timer, Daily Double, Final Face-Off, scoring — works identically.

## Cost

Zero. The free plan covers 100 simultaneous connections and 10 GB/month of
transfer. One class period moves a few megabytes even with 80 students, because
the host only sends an update when something actually changes — not on a timer.
You would need to run it continuously for years to leave the free tier.

The only real ceiling is that 100-device limit. At 80 students you have room to
spare; a single room bigger than ~95 is the wall.

## Reusing it

Nothing to clean up between classes. Each game gets a fresh 4-letter room code;
old rooms just sit there as a few kilobytes of dead data. If you ever want to
wipe it, open the Realtime Database in the console, click the ⋮ next to `rooms`,
and delete.
