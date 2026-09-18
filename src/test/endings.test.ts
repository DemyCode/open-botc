// Every way the game can end — and every way it must NOT — plus everything a finished game must refuse.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addPlayer, castVote, createGame, declareNeighbor, leaveRoom, markReadyForSpeech, nominate, skipSpeech, startGame, tick, toggleEndDayRequest, useSlayer,
} from '../game/engine.js';
import { setWinner, submitRealResponse } from '../game/night.js';
import { mulberry32, seedFromString } from '../game/rng.js';
import type { GameState } from '../game/types.js';
import { GameError } from '../game/types.js';
import { viewFor } from '../game/view.js';
import { advanceUntil, answerRealTurn, byChar, endDayByConsensus, fastForwardToVote, mk, mkDay, runFullNight, startNight, voteInOrder } from './helpers.js';

/** Nominate `nominee`, everyone votes yes, and the day ends with them executed. */
function execute(s: GameState, nominatorIdx: number, nomineeIdx: number): void {
  nominate(s, s.players[nominatorIdx].id, s.players[nomineeIdx].id);
  if (!s.currentNomination) return; // the Virgin acted at once
  fastForwardToVote(s);
  voteInOrder(s, s.players.map((p) => p.id));
  endDayByConsensus(s);
}

const ENDINGS: { name: string; run: () => GameState; winner: 'good' | 'evil' | null; phase: 'ended' | 'night' | 'day'; log?: string }[] = [
  { name: 'executing the Demon', run: () => { const s = mkDay(['imp', 'empath', 'chef', 'soldier', 'washerwoman']); execute(s, 1, 0); return s; }, winner: 'good', phase: 'ended', log: 'goodWinsDemonDead' },
  { name: 'executing a healthy Saint', run: () => { const s = mkDay(['imp', 'saint', 'chef', 'soldier', 'washerwoman']); execute(s, 2, 1); return s; }, winner: 'evil', phase: 'ended', log: 'saintWins' },
  { name: 'executing a poisoned Saint', run: () => { const s = mkDay(['imp', 'saint', 'poisoner', 'soldier', 'washerwoman']); s.poisonedId = s.players[1].id; execute(s, 3, 1); return s; }, winner: null, phase: 'night' },
  { name: 'executing a DEAD Saint', run: () => { const s = mkDay(['imp', 'saint', 'chef', 'soldier', 'washerwoman']); s.players[1].alive = false; execute(s, 2, 1); return s; }, winner: null, phase: 'night' },
  { name: 'executing an innocent leaving 2 alive', run: () => { const s = mkDay(['imp', 'empath', 'chef']); execute(s, 1, 2); return s; }, winner: 'evil', phase: 'ended', log: 'evilWinsTwoLeft' },
  { name: 'executing an innocent leaving 3 alive', run: () => { const s = mkDay(['imp', 'empath', 'chef', 'soldier']); execute(s, 1, 2); return s; }, winner: null, phase: 'night' },
  { name: 'the Slayer shooting the Demon', run: () => { const s = mkDay(['imp', 'slayer', 'chef', 'soldier', 'washerwoman']); useSlayer(s, s.players[1].id, s.players[0].id); return s; }, winner: 'good', phase: 'ended', log: 'slayerHit' },
  { name: 'the Slayer shooting an innocent', run: () => { const s = mkDay(['imp', 'slayer', 'chef', 'soldier', 'washerwoman']); useSlayer(s, s.players[1].id, s.players[2].id); return s; }, winner: null, phase: 'day' },
  { name: 'the Demon dying with 2 left: both would win, good wins', run: () => { const s = mkDay(['imp', 'slayer', 'chef']); useSlayer(s, s.players[1].id, s.players[0].id); return s; }, winner: 'good', phase: 'ended' },
  { name: 'the Virgin killing the nominator down to 2 alive', run: () => { const s = mkDay(['imp', 'virgin', 'empath']); nominate(s, s.players[2].id, s.players[1].id); return s; }, winner: 'evil', phase: 'ended', log: 'virginExecutesNominator' },
  { name: 'the Virgin killing the nominator with 3+ left', run: () => { const s = mkDay(['imp', 'virgin', 'empath', 'chef']); nominate(s, s.players[2].id, s.players[1].id); return s; }, winner: null, phase: 'night' },
  { name: 'the Mayor with 3 alive and no execution', run: () => { const s = mkDay(['imp', 'mayor', 'empath']); endDayByConsensus(s); return s; }, winner: 'good', phase: 'ended', log: 'goodWinsMayor' },
  { name: '3 alive but somebody was executed (Mayor does not win)', run: () => { const s = mkDay(['imp', 'mayor', 'empath', 'chef']); s.onBlockId = s.players[3].id; endDayByConsensus(s); return s; }, winner: null, phase: 'night' },
  { name: 'a quiet day with 5 alive', run: () => { const s = mkDay(['imp', 'mayor', 'empath', 'chef', 'soldier']); endDayByConsensus(s); return s; }, winner: null, phase: 'night' },
];

for (const row of ENDINGS) {
  test(`ending — ${row.name}`, () => {
    const s = row.run();
    assert.equal(s.winner, row.winner);
    assert.equal(s.phase, row.phase);
    if (row.log) assert.ok(s.publicLog.some((m) => m.key === row.log), `the village log says ${row.log}`);
  });
}

test('ending — a night kill leaving 2 alive: evil wins at once, without waiting for dawn', () => {
  const s = mk(['imp', 'poisoner', 'empath']);
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [byChar(s, 'empath').id]);
  assert.equal(s.winner, 'evil');
  assert.equal(s.phase, 'ended');
  assert.equal(s.pendingRealTurn, null);
});

test('ending — a Mayor bounce that leaves 2 alive ends it too', () => {
  const s = mk(['imp', 'mayor', 'soldier']);
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [byChar(s, 'mayor').id]); // the Soldier is immune, so the Mayor dies: 2 left
  assert.equal(s.winner, 'evil');
});

test('ending — a star-pass with no Minion left: good wins on the spot', () => {
  const s = mk(['imp', 'empath', 'soldier', 'chef', 'washerwoman']);
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [byChar(s, 'imp').id]);
  assert.equal(s.winner, 'good');
});

test('ending — a star-pass to a Minion does not end the game', () => {
  const s = mk(['imp', 'poisoner', 'soldier', 'chef', 'washerwoman']);
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [byChar(s, 'imp').id]);
  assert.equal(s.winner, null);
});

test('the winner is decided once: a later win condition cannot change it', () => {
  const s = mkDay(['imp', 'slayer', 'chef']);
  useSlayer(s, s.players[1].id, s.players[0].id);
  assert.equal(s.winner, 'good');
  setWinner(s, 'evil', { key: 'evilWinsTwoLeft' });
  assert.equal(s.winner, 'good');
  assert.equal(s.publicLog.filter((m) => m.key === 'evilWinsTwoLeft').length, 0);
});

// ---------------------------------------------------------------- a finished game refuses everything

test('once the game is over every action is refused (or does nothing) and the result never changes', () => {
  const s = mkDay(['imp', 'slayer', 'chef', 'soldier', 'washerwoman']);
  useSlayer(s, s.players[1].id, s.players[0].id);
  assert.equal(s.phase, 'ended');
  const [imp, slayer, chef, soldier] = s.players;
  const snapshot = JSON.stringify(s);
  const refused: [string, () => void][] = [
    ['nominate', () => nominate(s, chef.id, soldier.id)],
    ['castVote', () => castVote(s, chef.id, true)],
    ['markReadyForSpeech', () => markReadyForSpeech(s, chef.id)],
    ['skipSpeech', () => skipSpeech(s, chef.id)],
    ['toggleEndDayRequest', () => toggleEndDayRequest(s, chef.id)],
    ['useSlayer (again)', () => useSlayer(s, slayer.id, imp.id)],
    ['submitRealResponse', () => submitRealResponse(s, chef.id, [])],
    ['declareNeighbor', () => declareNeighbor(s, chef.id, soldier.id)],
    ['addPlayer', () => addPlayer(s, 'Late')],
    ['startGame', () => startGame(s)],
  ];
  for (const [name, fn] of refused) assert.throws(fn, GameError, `${name} must be refused after the end`);
  tick(s, Date.now() + 1e9);
  assert.equal(JSON.stringify(s), snapshot, 'nothing at all changed');
  assert.equal(viewFor(s, chef.id).winner, 'good');
});

test('leaving after the game is over just marks you away; the result and the players stay', () => {
  const s = mkDay(['imp', 'slayer', 'chef', 'soldier', 'washerwoman']);
  useSlayer(s, s.players[1].id, s.players[0].id);
  leaveRoom(s, s.players[2].id);
  assert.equal(s.players.length, 5);
  assert.equal(s.winner, 'good');
});

// ---------------------------------------------------------------- seating as a property

function lobbyOf(n: number): GameState {
  const s = createGame('SEAT');
  for (let i = 0; i < n; i++) addPlayer(s, `P${i}`);
  return s;
}

test('any circle the players agree on is accepted, in whatever order they answer, and seats follow the circle', () => {
  for (let n = 3; n <= 15; n++) {
    for (let trial = 0; trial < 20; trial++) {
      const rand = mulberry32(seedFromString(`seat-${n}-${trial}`));
      const s = lobbyOf(n);
      // A random circle order of everybody.
      const order = s.players.map((p) => p.id);
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      const right = new Map(order.map((id, i) => [id, order[(i + 1) % n]]));
      // Answers arrive in a random order; the circle is only confirmed once the last one is in.
      const answering = s.players.map((p) => p.id).sort(() => rand() - 0.5);
      answering.forEach((id, k) => {
        declareNeighbor(s, id, right.get(id)!);
        assert.equal(s.seatingConfirmed, k === n - 1, `n=${n}: confirmed only after everyone answered`);
      });
      // Seats: walking "right" from the first player gives 0,1,2,...
      let cur = s.players[0];
      for (let seat = 0; seat < n; seat++) {
        assert.equal(cur.seat, seat, `n=${n}: seat numbers follow the circle`);
        cur = s.players.find((p) => p.id === cur.seatRightId)!;
      }
      assert.equal(cur.id, s.players[0].id, 'the circle closes');
      assert.equal(new Set(s.players.map((p) => p.seat)).size, n, 'every seat is used once');
    }
  }
});

test('two separate circles, a self-loop, or a pair looking at each other never confirm', () => {
  const s = lobbyOf(6);
  const ids = s.players.map((p) => p.id);
  // two circles of 3
  [0, 1, 2].forEach((i) => declareNeighbor(s, ids[i], ids[(i + 1) % 3]));
  [3, 4, 5].forEach((i) => declareNeighbor(s, ids[i], ids[3 + ((i - 3 + 1) % 3)]));
  assert.equal(s.seatingConfirmed, false);
  // mutual pairs
  const t = lobbyOf(4);
  const tid = t.players.map((p) => p.id);
  declareNeighbor(t, tid[0], tid[1]); declareNeighbor(t, tid[1], tid[0]); declareNeighbor(t, tid[2], tid[3]); declareNeighbor(t, tid[3], tid[2]);
  assert.equal(t.seatingConfirmed, false);
  assert.throws(() => declareNeighbor(t, tid[0], tid[0]), /own neighbor/);
  assert.throws(() => declareNeighbor(t, tid[0], 'ghost'), GameError);
  assert.throws(() => declareNeighbor(t, 'ghost', tid[0]), GameError);
});

test('changing your answer un-confirms the circle; putting it back re-confirms it', () => {
  const s = lobbyOf(5);
  const ids = s.players.map((p) => p.id);
  ids.forEach((id, i) => declareNeighbor(s, id, ids[(i + 1) % 5]));
  assert.equal(s.seatingConfirmed, true);
  declareNeighbor(s, ids[0], ids[2]);
  assert.equal(s.seatingConfirmed, false);
  declareNeighbor(s, ids[0], ids[1]);
  assert.equal(s.seatingConfirmed, true);
});

test('a player joining or leaving un-confirms the circle', () => {
  const s = lobbyOf(5);
  const ids = s.players.map((p) => p.id);
  ids.forEach((id, i) => declareNeighbor(s, id, ids[(i + 1) % 5]));
  addPlayer(s, 'New');
  assert.equal(s.seatingConfirmed, false);
});

test('seating cannot be changed once the game has started', () => {
  const s = lobbyOf(5);
  const ids = s.players.map((p) => p.id);
  ids.forEach((id, i) => declareNeighbor(s, id, ids[(i + 1) % 5]));
  startGame(s);
  assert.throws(() => declareNeighbor(s, ids[0], ids[3]), /before the game starts/);
});

test('the neighbours a player is shown are the ones on their left and right in the circle', () => {
  const s = lobbyOf(6);
  const ids = s.players.map((p) => p.id);
  ids.forEach((id, i) => declareNeighbor(s, id, ids[(i + 1) % 6]));
  for (let i = 0; i < 6; i++) {
    const v = viewFor(s, ids[i]);
    assert.equal(v.rightNeighborName, s.players[(i + 1) % 6].name);
    assert.equal(v.leftNeighborName, s.players[(i + 5) % 6].name);
  }
});

