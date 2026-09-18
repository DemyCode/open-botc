// Hostile and awkward inputs, saving mid-game, and guards against whole classes of mistakes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { addPlayer, castVote, createGame, declareNeighbor, markReadyForSpeech, nominate, skipSpeech, startGame, tick, toggleEndDayRequest } from '../game/engine.js';
import { submitRealResponse } from '../game/night.js';
import { mulberry32, seedFromString } from '../game/rng.js';
import type { GameState } from '../game/types.js';
import { viewFor } from '../game/view.js';
import { playGame } from './driver.js';
import { brokenText, loadApp } from './fakedom.js';

// ---------------------------------------------------------------- saving and restoring a game

/** Plays a whole game where the state is thrown away and rebuilt from JSON at every single step —
 * what a server restart does. Returns a transcript of everything that happened. */
function replay(restoreEveryStep: boolean): string[] {
  const rand = mulberry32(seedFromString('restore'));
  const realRandom = Math.random;
  Math.random = rand;
  try {
    let s = createGame('SAVE');
    s.secret = 'save-secret';
    const ps = Array.from({ length: 9 }, (_, i) => addPlayer(s, `P${i}`));
    ps.forEach((p, i) => declareNeighbor(s, p.id, ps[(i + 1) % 9].id));
    startGame(s);
    const ids = ps.map((p) => p.id);
    const restore = () => { if (restoreEveryStep) s = JSON.parse(JSON.stringify(s)) as GameState; };
    const log: string[] = [];
    for (let round = 0; round < 60 && s.phase !== 'ended'; round++) {
      restore();
      if (s.phase === 'night') {
        let guard = 0;
        while (s.pendingRealTurn && guard++ < 200) {
          restore();
          const t = s.pendingRealTurn!;
          const id = t.participantIds.find((x) => !(x in t.responses))!;
          const turn = viewFor(s, id).nightTurn!;
          const picks = turn.shape === 'choose' ? turn.choices.filter((c) => c.id !== id || t.max > 1).slice(0, turn.min).map((c) => c.id) : [];
          log.push(`night${s.night} ${t.charId} ${s.players.find((p) => p.id === id)!.name} ${turn.decoy ? 'decoy' : 'real'} ${picks.length}`);
          submitRealResponse(s, id, picks, t.openedAt + 5000);
        }
        restore();
        if (s.phase === 'night') { tick(s, s.dawnAt!); log.push(`dawn ${s.day}: dead=${s.players.filter((p) => !p.alive).length}`); }
      }
      restore();
      if (s.phase === 'day') {
        const alive = s.players.filter((p) => p.alive);
        nominate(s, alive[0].id, alive[1].id);
        restore();
        if (s.currentNomination) {
          for (const p of s.players) if (!s.currentNomination.readyBy.includes(p.id)) markReadyForSpeech(s, p.id);
          restore();
          skipSpeech(s, s.currentNomination.nominatorId);
          restore();
          skipSpeech(s, s.currentNomination!.nomineeId);
          let g = 0;
          while (s.currentNomination?.state === 'voting' && g++ < 40) { restore(); castVote(s, s.currentNomination.currentVoterId!, true); }
        }
        restore();
        if (s.phase === 'day') for (const p of s.players.filter((q) => q.alive)) if (s.phase === 'day') toggleEndDayRequest(s, p.id);
        log.push(`day${s.day} block=${s.onBlockId ? s.players.find((p) => p.id === s.onBlockId)!.name : '-'} alive=${s.players.filter((p) => p.alive).length}`);
      }
    }
    log.push(`winner=${s.winner}`);
    void ids;
    return log;
  } finally {
    Math.random = realRandom;
  }
}

test('a game rebuilt from its saved JSON at EVERY step plays out exactly like an uninterrupted one', () => {
  const plain = replay(false);
  const restored = replay(true);
  assert.deepEqual(restored, plain);
  assert.ok(plain.at(-1)!.startsWith('winner=good') || plain.at(-1)!.startsWith('winner=evil'), 'the game finished');
});

test('the whole game state survives a JSON round trip unchanged, at every step of 30 random games', () => {
  for (let n = 5; n <= 15; n += 2) {
    for (let seed = 0; seed < 3; seed++) {
      playGame(seed, n, (s, where) => {
        const once = JSON.stringify(s);
        const back = JSON.parse(once) as GameState;
        assert.equal(JSON.stringify(back), once, `${where}: not stable through JSON`);
        // Nothing was silently dropped (undefined fields vanish in JSON; a Map or Set becomes {}).
        const scan = (v: unknown, at: string): void => {
          if (v instanceof Map || v instanceof Set) throw new Error(`${where}: a ${v.constructor.name} at ${at} does not survive JSON`);
          if (typeof v === 'function') throw new Error(`${where}: a function at ${at}`);
          if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) scan(x, `${at}.${k}`);
        };
        scan(s, 'state');
      });
    }
  }
});

// ---------------------------------------------------------------- hostile names

const NASTY = [
  '__proto__', 'constructor', 'toString', 'hasOwnProperty', '<script>alert(1)//', '😀😀😀', 'x'.repeat(24), 'Zoë', '日本語', '"quotes" & <b>',
  "'; DROP TABLE players;--", '${process.exit()}', 'null', 'undefined', 'NaN',
];

test('players with hostile names (__proto__, HTML, emoji, JS/SQL text) play a whole game without trouble', () => {
  for (let n = 5; n <= 15; n++) {
    for (let seed = 0; seed < 4; seed++) {
      const names = NASTY.slice(0, n);
      const s = playGame(seed, n, (st) => { for (const p of st.players) viewFor(st, p.id); }, names);
      assert.equal(s.phase, 'ended');
      assert.deepEqual(s.players.map((p) => p.name), names);
    }
  }
});

test('hostile names are shown as plain text in the app — never interpreted as HTML — in both languages', async () => {
  const app = await loadApp('en');
  const s = createGame('X');
  const names = ['<script>alert(1)//', '<img src=x onerror=a>', '__proto__', '${1+1}'];
  for (const n of names) addPlayer(s, n);
  addPlayer(s, 'Normal');
  s.players.forEach((p, i) => declareNeighbor(s, p.id, s.players[(i + 1) % s.players.length].id));
  startGame(s);
  s.phase = 'day';
  s.day = 1;
  for (const lang of ['en', 'fr'] as const) {
    const text = app.show(viewFor(s, s.players[4].id), { seen: true, lang });
    for (const n of names) assert.ok(text.includes(n), `${n} is displayed as text`);
    assert.equal(app.root.find((node) => ['script', 'img'].includes(node.tag)).length, 0, 'no element was created from a name');
    assert.equal(brokenText(text.split('${1+1}').join('')), null);
  }
});

// ---------------------------------------------------------------- guards on the browser code

test('the app never builds HTML from data: innerHTML is only ever cleared or set from the fixed icon table', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  const assignments = [...app.matchAll(/\.innerHTML\s*=\s*([^;\n]+)/g)].map((m) => m[1].trim());
  assert.ok(assignments.length >= 2);
  for (const rhs of assignments) assert.ok(rhs === "''" || rhs === "ICON_PATHS[name] || ''", `innerHTML assigned from: ${rhs}`);
  for (const banned of ['insertAdjacentHTML', 'document.write', 'outerHTML', 'eval(', 'new Function', 'dangerouslySetInnerHTML']) {
    assert.ok(!app.includes(banned), `${banned} must never be used`);
  }
});

test('every local file the page loads exists', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 3);
  for (const ref of refs) assert.ok(fs.existsSync(path.join('public', ref)), `${ref} is referenced but missing`);
});

test('the server code never uses eval or spawns a shell', () => {
  for (const file of ['src/server/index.ts', 'src/server/rooms.ts']) {
    const src = fs.readFileSync(file, 'utf8');
    for (const banned of ['eval(', 'child_process', 'new Function', 'exec(']) assert.ok(!src.includes(banned), `${file} uses ${banned}`);
  }
});

// ---------------------------------------------------------------- the whole project still compiles

test('the TypeScript type-check passes for the whole project, tests included', () => {
  const tsc = path.resolve('node_modules/typescript/bin/tsc');
  const res = spawnSync(process.execPath, [tsc, '-p', '.', '--noEmit'], { encoding: 'utf8' });
  assert.equal(res.status, 0, `tsc failed:\n${res.stdout}${res.stderr}`);
});
