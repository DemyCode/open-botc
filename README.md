# open-botc

Self-hosted **Blood on the Clocktower — Trouble Brewing**, with no storyteller.

Everyone sits in one room and talks face to face, exactly like the real game.
The server does the storyteller's job: it deals the characters, runs the night
in the official order, buzzes each player's phone when their ability needs them,
resolves poison, drunkenness, protection and misregistration, and announces
deaths in the morning. During the day you nominate on your phone, everybody's
phone buzzes, and you listen to the accuser and then the accused.

No accounts. You join a room with a 4-letter code and the game starts.

> This is an unofficial fan project. Blood on the Clocktower is by
> [The Pandemonium Institute](https://bloodontheclocktower.com/). Buy the real
> game — it is excellent, and this is no substitute for the physical set.

---

## Quick start

### Docker (recommended)

```bash
docker compose up -d
```

Then open `http://<your-server-ip>:8080` on every phone.

Or without compose:

```bash
docker build -t open-botc .
docker run -d --name botc -p 8080:8080 -v botc-data:/data open-botc
```

### From source

Needs Node 20+.

```bash
npm install
npm run build
npm start
```

### Nix

```bash
nix develop          # dev shell with node and chromium
nix run .#default    # build and run the server
```

There is a `shell.nix` too, for non-flake setups.

The server prints every address it is reachable on. Everyone in the room opens
one of the LAN addresses, or scans the QR code on the host's screen.

---

## How a game runs

1. **Lobby.** One person creates a room and reads out the 4-letter code (or
   shows the QR). Everyone joins with a name. Sit in the same order as the
   player list — seat order is real, the Chef and Empath read the circle.
2. **Set up buzzing.** Each player taps *Subscribe me* and *Send me a test
   buzz*. The lobby shows who is ready. Do not start until everyone is.
3. **Reveal.** Each phone shows that player's character, privately.
4. **Night.** Everyone closes their eyes and puts their phone down. Phones buzz
   one at a time, in the official Trouble Brewing night order. Characters that
   only *learn* something get their information without holding up the night;
   characters that must *choose* block until they answer or time out.
5. **Dawn.** Every phone buzzes with who died.
6. **Day.** Talk. Anyone can open nominations.
7. **Nomination.** Tap a player to nominate them. Every phone buzzes with
   *"Alice nominates Bob"*, then the accuser speaks on a timer, then the
   accused, then everyone votes on their phone.
8. **Dusk.** Whoever is on the block is executed, and night falls again.

The game ends by itself and reveals the full grimoire.

---

## What is implemented

All 22 Trouble Brewing characters, including the fiddly parts:

| | |
|---|---|
| **Townsfolk** | Washerwoman, Librarian, Investigator, Chef, Empath, Fortune Teller, Undertaker, Monk, Ravenkeeper, Virgin, Slayer, Soldier, Mayor |
| **Outsiders** | Butler, Drunk, Recluse, Saint |
| **Minions** | Poisoner, Spy, Scarlet Woman, Baron |
| **Demon** | Imp |

Handled properly:

- **Official night order** on the first night and on later nights.
- **Poison and drunkenness** corrupt information *silently* — a poisoned Empath
  is told a plausible lie and has no way to tell.
- **The Drunk** is dealt an extra Townsfolk token nobody else holds, wakes on
  that character's schedule, and never learns the truth.
- **Misregistration.** The Recluse can look evil, like a Minion or like the
  Demon; the Spy can look good, like a Townsfolk or like an Outsider. Decided
  per question, and stable if the same question is asked twice in one night.
- **The Baron** rewrites the Townsfolk/Outsider split at setup.
- **Demon bluffs** — three good characters that are genuinely not in play.
- **The Fortune Teller's red herring.**
- **Monk** protection, **Soldier** immunity, the **Mayor's** bounce.
- **Scarlet Woman** succession at 5+ alive, and the **Imp's** star-pass.
- **Virgin** (fires once, on a Townsfolk nominator, and not while poisoned),
  **Slayer** (public, one use), **Saint** (execution only), **Mayor** (three
  alive, no execution).
- **Voting** with the half-alive threshold, ties clearing the block, one ghost
  vote per dead player, and the **Butler's** dependence on their master.

### Judgement calls

The rules follow the official Trouble Brewing script and are **not** adjustable
in the app — the Drunk registers as the Drunk, the Recluse and Spy misregister
half the time, and the Mayor's bounce is a coin flip. Only timings and the
voting style are exposed, because those are a table's preference rather than a
question of correctness.

These remain settable in `RoomOptions` for anyone who wants to fork the
behaviour, but no UI offers them:

| Field | Default | What it does |
|---|---|---|
| `drunkShowsAsFake` | `false` (official) | Whether the Drunk registers as the Drunk, or as their fake Townsfolk role |
| `recluseMisregisterChance` | 0.5 | How often the Recluse looks evil |
| `spyMisregisterChance` | 0.5 | How often the Spy looks good |
| `mayorBounceChance` | 0.5 | How often a Mayor's night death lands on someone else |

---

## Notifications

Getting the phone to buzz **with the screen off** is the whole point, so this
gets its own section.

### ntfy (default, works everywhere)

[ntfy](https://ntfy.sh) is a tiny free notification app. It is the primary
channel because it works over plain HTTP on a LAN, which browser notifications
do not.

The server generates a **private random topic for each player when they join**.
Nobody types anything. The player taps:

1. **Subscribe me** — an `ntfy://` deep link that opens the ntfy app and
   subscribes to their topic in one tap.
2. **Send me a test buzz** — confirms it actually works, and marks them ready
   in the lobby.

Every message is sent at ntfy priority **max**. That is the only level the
Android app treats as insistent, and it is the whole lever the sender has —
priority 4 lands in a quieter channel that many phones (Samsung especially)
leave silent.

### Silence is a rule, not a setting

**This app never plays audio, and nothing may be added that does.**

Everyone is sitting in the same room. If a phone makes a noise when the night
wakes a player, the whole table hears *who* is acting — which is the one secret
the entire game rests on. So there is no sound, no notification tone, no chime.

The single instruction, shown in the app where nobody can miss it: **put your
phone on vibrate.** Players are also told to hold the phone in their lap during
the night, because a phone buzzing on a hard table is audible.

### Telling the buzzes apart

Since vibration is the only channel, each event has its own rhythm, and you can
tell them apart with your eyes shut:

| Event | Rhythm |
|---|---|
| **Your turn** | two taps then a long hold — the only one ending sustained |
| **Someone is accused** | five fast taps — the only rapid one |
| **Vote now** | three even pulses |
| **Someone died** | one long hold — the only single pulse |
| **Day breaks** | two slow spaced pulses |

The vocabulary lives in `src/game/buzz.ts`, is served to the client, and the
setup card has a "Feel" button for each one so players can learn them before the
game starts.

> **Topics are secret.** Your topic is how your private night information
> reaches your phone. Anyone who knows it can read that information. They are
> long and random; don't share or screenshot them.

Install ntfy: [Play](https://play.google.com/store/apps/details?id=io.heckel.ntfy)
· [F-Droid](https://f-droid.org/en/packages/io.heckel.ntfy/)
· [iPhone](https://apps.apple.com/us/app/ntfy/id1625396347)

Players without the app can leave the ntfy topic page open in a browser tab —
it buzzes, but only while the phone is unlocked.

### Running your own ntfy

If you would rather no notification text left your network, uncomment the
`ntfy` service in `docker-compose.yml` and point `BOTC_NTFY_URL` at it.

The catch: the ntfy app only auto-trusts `https`. Over plain HTTP the one-tap
subscribe link will not work and each player has to add the server by hand in
the app. Put it behind TLS if you want to keep the two-tap flow.

### Why not browser notifications?

There are none, deliberately. Web Push needs HTTPS, a permission prompt and a
service worker, and it silently does nothing on a LAN address served over plain
HTTP — which is exactly how this gets used. One channel that always works beats
two where one fails quietly.

While the page is open and the phone unlocked it also vibrates and chirps
in-page, but that is a nicety, not the mechanism.

---

## Configuration

All optional.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Port to listen on |
| `HOST` | `0.0.0.0` | Address to bind |
| `BOTC_DATA_DIR` | `./data` | Saved games |
| `BOTC_NTFY_URL` | `https://ntfy.sh` | ntfy server to publish to |
| `BOTC_PUBLIC_URL` | *(unset)* | Address players use, so a tapped notification opens the game |

Games are saved to `$BOTC_DATA_DIR/rooms.json` every 15 seconds, so restarting
the server mid-game does not lose it. Idle rooms are dropped after 12 hours.

---

## Development

```bash
npm install
npm run build
npm test          # 92 unit tests: setup, night order, every ability, wins, view isolation
npm start
```

With the server running:

```bash
npm run e2e -- --players 8 --games 3   # plays whole games over the real WebSocket protocol
npm run ui-check                       # drives the real UI in headless Chromium, screenshots every phase
npm run ntfy-check                     # publishes a test notification and reads it back off ntfy
```

`ui-check` needs a Chromium binary; point it at one with `--chrome` or
`CHROME_BIN` if it is not on the default path.

### Layout

```
src/game/     the rules engine — pure, serialisable, no I/O
  characters.ts   the 22 characters and the official night order
  setup.ts        dealing, the Baron, the Drunk's extra token, demon bluffs
  registration.ts drunk/poison, Recluse and Spy misregistration
  info.ts         what each information role learns, true and false
  engine.ts       night and day state machine, deaths, win conditions
  view.ts         per-player filtered views — the only thing a client ever sees
src/          HTTP + WebSocket server, notifications, room storage
public/       the phone client (no build step, plain ES modules)
scripts/      e2e, UI and notification checks
```

The engine never sends a player anything they should not know. `view.ts` builds
one filtered view per player, and there is a test that asserts no character,
alignment or prompt ever leaks to anyone else while a game is running.

---

## Notes and limits

- 5–15 players, Trouble Brewing only. No Travellers or Fabled.
- There is no storyteller override. If the town wants to bend a rule mid-game,
  this cannot do it.
- Anyone in the room can create a room and anyone with the code can join. It is
  built for a living room on a trusted network, not the open internet. If you do
  expose it publicly, put it behind a reverse proxy with TLS and access control.

## Licence

MIT.
