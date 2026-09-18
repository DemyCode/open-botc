// The lobby: joining, names, room size, starting the game for every player count.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHARACTERS, DISTRIBUTION } from '../game/characters.js';
import { addPlayer, createGame, declareNeighbor, leaveRoom, startGame } from '../game/engine.js';
import { GameError } from '../game/types.js';
import type { GameState } from '../game/types.js';

function lobby(n: number, secret = 'lobby-secret'): GameState {
  const s = createGame('LOBBY');
  s.secret = secret;
  const ps = Array.from({ length: n }, (_, i) => addPlayer(s, `Player${i + 1}`));
  ps.forEach((p, i) => declareNeighbor(s, p.id, ps[(i + 1) % n].id));
  return s;
}

// ---- names ----

test('a name is trimmed and inner whitespace collapsed', () => {
  const s = createGame('X');
  assert.equal(addPlayer(s, '   Ana    Maria  ').name, 'Ana Maria');
});

test('an empty or blank name becomes "Player N", each one different', () => {
  const s = createGame('X');
  assert.equal(addPlayer(s, '').name, 'Player 1');
  assert.equal(addPlayer(s, '   ').name, 'Player 2');
  assert.equal(addPlayer(s, '\n\t').name, 'Player 3');
});

test('a very long name is cut to 24 characters', () => {
  const s = createGame('X');
  assert.equal(addPlayer(s, 'x'.repeat(200)).name, 'x'.repeat(24));
});

test('control characters become a space, invisible/bidi characters vanish', () => {
  const s = createGame('X');
  assert.equal(addPlayer(s, 'A\nB\u200bC\u202eD').name, 'A BCD');
});

test('two players cannot share a name, whatever the case or spacing', () => {
  const s = createGame('X');
  addPlayer(s, 'Ana');
  assert.throws(() => addPlayer(s, 'Ana'), GameError);
  assert.throws(() => addPlayer(s, 'ANA'), /taken/);
  assert.throws(() => addPlayer(s, '  ana '), /taken/);
  assert.equal(s.players.length, 1, 'a refused join adds nobody');
});

test('a name freed by someone leaving can be used again', () => {
  const s = createGame('X');
  const ana = addPlayer(s, 'Ana');
  leaveRoom(s, ana.id);
  assert.doesNotThrow(() => addPlayer(s, 'Ana'));
});

test('a name that looks like markup is kept as plain text (the app renders text, never HTML)', () => {
  const s = createGame('X');
  assert.equal(addPlayer(s, '<b>Bob</b>').name, '<b>Bob</b>');
});

// ---- room size and host ----

test('a room holds at most 15 players', () => {
  const s = createGame('X');
  for (let i = 0; i < 15; i++) addPlayer(s, `P${i}`);
  assert.throws(() => addPlayer(s, 'P15'), /full/);
  assert.equal(s.players.length, 15);
});

test('the first player to join is the host, and stays host while they are in the room', () => {
  const s = createGame('X');
  const a = addPlayer(s, 'A');
  addPlayer(s, 'B');
  assert.equal(s.hostId, a.id);
});

test('nobody can join once the game has started', () => {
  const s = lobby(5);
  startGame(s);
  assert.throws(() => addPlayer(s, 'Late'), /already started/);
  assert.equal(s.players.length, 5);
});

// ---- starting ----

test('the game needs seating to be confirmed before it can start', () => {
  const s = createGame('X');
  for (let i = 0; i < 5; i++) addPlayer(s, `P${i}`);
  assert.throws(() => startGame(s), /[Ss]eating/);
});

test('fewer than 5 players cannot start a game — with a friendly error, not a crash', () => {
  for (const n of [3, 4]) {
    const s = lobby(n);
    assert.throws(() => startGame(s), GameError);
    assert.equal(s.phase, 'lobby', 'the game did not half-start');
  }
});

test('a game cannot be started twice', () => {
  const s = lobby(5);
  startGame(s);
  assert.throws(() => startGame(s), /already started/);
});

for (let n = 5; n <= 15; n++) {
  test(`starting with ${n} players: everyone gets a character, the right mix, and night 1 begins`, () => {
    for (const secret of ['a', 'b', 'c', 'd', 'e']) {
      const s = lobby(n, secret);
      startGame(s);
      assert.equal(s.phase, 'night');
      assert.equal(s.night, 1);
      assert.ok(s.players.every((p) => p.character && CHARACTERS[p.character]), 'every player has a real character');
      const teams = (t: string) => s.players.filter((p) => CHARACTERS[p.character].team === t).length;
      const [town, out, minion, demon] = DISTRIBUTION[n];
      const baron = s.players.some((p) => p.character === 'baron');
      assert.equal(teams('demon'), demon, 'exactly one Demon');
      assert.equal(teams('minion'), minion);
      assert.equal(teams('outsider'), baron ? out + 2 : out);
      assert.equal(teams('townsfolk'), baron ? town - 2 : town);
      assert.ok(s.players.every((p) => p.alignment === (['minion', 'demon'].includes(CHARACTERS[p.character].team) ? 'evil' : 'good')));
      assert.equal(s.bluffs.length, 3);
      assert.ok(s.players.every((p) => p.alive && !p.diedTonight && !p.slayerUsed && !p.virginUsed && !p.ghostVoteUsed));
    }
  });
}

test('the same secret always deals the same characters to the same players (a saved game deals the same)', () => {
  const a = lobby(9, 'same');
  const b = lobby(9, 'same');
  startGame(a);
  startGame(b);
  assert.deepEqual(a.players.map((p) => p.character), b.players.map((p) => p.character));
});

test('different secrets deal differently', () => {
  const deals = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const s = lobby(9, `secret-${i}`);
    startGame(s);
    deals.add(s.players.map((p) => p.character).join());
  }
  assert.ok(deals.size > 15, `only ${deals.size} different deals out of 20`);
});

test('leaving mid-game never removes a player — the seat and the character stay', () => {
  const s = lobby(6);
  startGame(s);
  const p = s.players[2];
  leaveRoom(s, p.id);
  assert.equal(s.players.length, 6);
  assert.equal(p.connected, false);
  assert.equal(p.alive, true);
});

test('leaving a room you are not in does nothing', () => {
  const s = lobby(5);
  assert.doesNotThrow(() => leaveRoom(s, 'nobody'));
  assert.equal(s.players.length, 5);
});
