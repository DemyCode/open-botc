#!/usr/bin/env node
/**
 * End-to-end smoke test: drives a full game over the real WebSocket protocol
 * with simulated players, exactly as phones would.
 *
 *   node scripts/e2e.mjs [--url http://localhost:8080] [--players 8] [--games 1]
 */

import { WebSocket } from 'ws';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith('--') ? [[a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]] : [],
  ),
);
const BASE = args.url || 'http://localhost:8080';
const N = Number(args.players || 8);
const GAMES = Number(args.games || 1);

const wsUrl = BASE.replace(/^http/, 'ws') + '/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`  ✖ ${msg}`);
  }
}

class Player {
  constructor(name) {
    this.name = name;
    this.view = null;
    this.buzzes = [];
    this.errors = [];
    this.ws = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.on('open', resolve);
      ws.on('error', reject);
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.t === 'view') this.view = msg.view;
        else if (msg.t === 'buzz') this.buzzes.push(msg);
        else if (msg.t === 'identity') this.token = msg.token;
        else if (msg.t === 'error') this.errors.push(msg.message);
      });
    });
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.ws?.close();
  }

  get id() {
    return this.view?.youId;
  }
  get phase() {
    return this.view?.phase;
  }
  get self() {
    return this.view?.self;
  }
  alivePlayers() {
    return this.view.players.filter((p) => p.alive);
  }
}

async function settle(players, ms = 90) {
  await sleep(ms);
  return players[0].view;
}

async function playOneGame(gameIndex) {
  console.log(`\n── game ${gameIndex + 1}: ${N} players ──`);

  const res = await fetch(`${BASE}/api/rooms`, { method: 'POST' });
  const { code } = await res.json();

  const players = [];
  for (let i = 0; i < N; i++) {
    const p = new Player(`Player${i + 1}`);
    await p.connect();
    p.send({ t: 'join', code, name: p.name });
    players.push(p);
    await sleep(25);
  }
  await settle(players, 200);

  check(players[0].view?.players.length === N, `lobby has ${N} players`);
  check(players[0].view?.preview != null, 'lobby shows a valid distribution');

  // ---- start
  players[0].send({ t: 'setOptions', options: { revealSeconds: 1, dawnSeconds: 1, speechSeconds: 1, voteSeconds: 1 } });
  await sleep(80);
  players[0].send({ t: 'start' });
  await settle(players, 200);

  check(players[0].phase === 'reveal', `reveal phase reached (got ${players[0].phase})`);

  // Every player must know their own character and nobody else's.
  const roles = new Map();
  for (const p of players) {
    check(!!p.self?.character, `${p.name} was dealt a character`);
    roles.set(p.id, p.self.character);
    const leaked = p.view.players.filter((x) => x.id !== p.id && x.character);
    check(leaked.length === 0, `${p.name} sees no other characters`);
  }
  const distinct = new Set(roles.values());
  check(distinct.size === N, `all ${N} dealt characters are distinct (got ${distinct.size})`);

  for (const p of players) p.send({ t: 'ready' });
  await settle(players, 300);

  // ---- play up to 12 day/night cycles
  let guard = 0;
  while (players[0].phase !== 'over' && guard++ < 400) {
    const v = players[0].view;

    switch (v.phase) {
      case 'night': {
        // Whoever has a prompt answers it.
        let acted = false;
        for (const p of players) {
          if (p.view?.prompt) {
            const choices = p.view.prompt.choices.filter((c) => !c.disabled);
            const targets = shuffle(choices).slice(0, p.view.prompt.count).map((c) => c.playerId);
            check(targets.length === p.view.prompt.count, `${p.name} has enough choices`);
            p.send({ t: 'choose', promptId: p.view.prompt.id, targets });
            acted = true;
            break;
          }
        }
        // Exactly one player may hold a prompt at a time.
        const holders = players.filter((p) => p.view?.prompt).length;
        check(holders <= 1, `at most one night prompt at a time (got ${holders})`);
        await sleep(acted ? 60 : 250);
        break;
      }

      case 'dawn':
        await sleep(1200);
        break;

      case 'day': {
        const alive = players.filter((p) => p.self?.alive);
        // Occasionally fire the Slayer to exercise that path.
        const slayer = alive.find((p) => p.self.canSlay);
        if (slayer && Math.random() < 0.5) {
          const target = pickOne(slayer.view.players.filter((x) => x.alive && x.id !== slayer.id));
          slayer.send({ t: 'slay', targetId: target.id });
          await sleep(120);
          break;
        }
        alive[0]?.send({ t: 'openNominations' });
        await sleep(120);
        break;
      }

      case 'nominations': {
        const nominator = players.find((p) => p.self?.canNominate);
        const candidates =
          nominator?.view.players.filter((x) => x.alive && !x.wasNominated) ?? [];

        if (nominator && candidates.length > 0 && Math.random() < 0.75) {
          nominator.send({ t: 'nominate', targetId: pickOne(candidates).id });
          await sleep(120);
          break;
        }

        // Close the day. `endDay` toggles, so only ask players who have not asked.
        for (const p of players.filter((x) => x.self?.alive && !x.self.hasRequestedEndDay)) {
          p.send({ t: 'endDay' });
          await sleep(30);
        }
        await sleep(200);
        break;
      }

      case 'speech':
        await sleep(1200);
        break;

      case 'voting': {
        for (const p of players) {
          if (p.self?.canVote) {
            p.send({ t: 'vote', vote: Math.random() < 0.55 });
            await sleep(25);
          }
        }
        await sleep(1300);
        break;
      }

      case 'dusk':
        await sleep(1000);
        break;

      case 'over':
        break;

      default:
        await sleep(150);
    }

    // Invariant: nobody may ever see another player's character mid-game.
    // Judged against each player's OWN view, since broadcasts can interleave.
    for (const p of players) {
      if (!p.view || p.view.phase === 'over') continue;
      const leaked = p.view.players.filter((x) => x.id !== p.id && x.character);
      if (leaked.length) {
        check(
          false,
          `${p.name} (own phase=${p.view.phase}, grimoire=${!!p.view.grimoire}) saw: ` +
            leaked.map((x) => `${x.name}=${x.character}`).join(', '),
        );
        break;
      }
    }
  }

  const final = players[0].view;
  if (final.phase !== 'over') {
    console.error(
      `  stalled in ${final.phase} (night ${final.night}, day ${final.day}); ` +
        `alive=${final.players.filter((p) => p.alive).length}, ` +
        `nominated=${final.players.filter((p) => p.hasNominated).length}, ` +
        `wasNominated=${final.players.filter((p) => p.wasNominated).length}, ` +
        `endDay=${final.endDayVotes}/${final.endDayNeeded}`,
    );
    console.error('  last log:', final.log.slice(-5).map((l) => l.text));
  }
  check(final.phase === 'over', `game reached a conclusion (guard=${guard}, phase=${final.phase})`);
  check(final.winner === 'good' || final.winner === 'evil', 'a side won');
  check(!!final.grimoire && final.grimoire.length === N, 'grimoire revealed at the end');

  // A phone may only be vibrated to wake somebody: the night, and dawn.
  const WAKING = new Set(['turn', 'info', 'dawn', 'transform']);
  const allBuzzes = players.flatMap((p) => p.buzzes);
  const stray = [...new Set(allBuzzes.map((b) => b.tag).filter((t) => !WAKING.has(t)))];
  check(stray.length === 0, `no phone was buzzed for a silent event: ${JSON.stringify(stray)}`);
  check(allBuzzes.length > 0, 'the game buzzed somebody');

  const perPlayer = players.map((p) => p.buzzes.length);
  const byKind = {};
  for (const b of allBuzzes) byKind[b.tag] = (byKind[b.tag] || 0) + 1;
  console.log(
    `  buzzes: ${allBuzzes.length} total, ` +
      `${Math.min(...perPlayer)}–${Math.max(...perPlayer)} per player ` +
      `(${Object.entries(byKind).map(([k, n]) => `${k}×${n}`).join(' ')})`,
  );
  // Races are expected: a phone can tap a button just as the phase changes.
  const benign = /already|cannot|not open|not running|expired|valid|turn|nothing to answer/i;
  const unexpected = players.flatMap((p) => p.errors.filter((e) => !benign.test(e)));
  check(unexpected.length === 0, `no unexpected protocol errors: ${JSON.stringify(unexpected.slice(0, 3))}`);

  console.log(
    `  ${final.winner === 'good' ? '🕊️  GOOD' : '👹 EVIL'} wins after ${final.night} night(s) — ${final.winReason}`,
  );
  const summary = final.grimoire
    .map((r) => `${r.name.replace('Player', 'P')}:${r.character}${r.alive ? '' : '†'}`)
    .join(' ');
  console.log(`  ${summary}`);

  for (const p of players) p.close();
  await sleep(100);
}

function shuffle(a) {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const pickOne = (a) => a[Math.floor(Math.random() * a.length)];

for (let i = 0; i < GAMES; i++) {
  await playOneGame(i);
}

console.log('');
if (failures === 0) {
  console.log(`✅ end-to-end: ${GAMES} game(s) played, no failures`);
  process.exit(0);
} else {
  console.error(`❌ end-to-end: ${failures} failure(s)`);
  process.exit(1);
}
