// What a phone can learn from its own raw data. A tampered client can read every byte the server
// sends it, so secrets must never be in there — not just hidden by the UI.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { castVote, nominate, useSlayer } from '../game/engine.js';
import type { GameState } from '../game/types.js';
import { viewFor } from '../game/view.js';
import { playGame } from './driver.js';
import {
  advanceUntil, answerRealTurn, byChar, fastForwardToVote, mk, mkDay, runFullNight, startNight,
} from './helpers.js';

const VIEW_KEYS = [
  'amIAlive', 'code', 'dawnMessage', 'day', 'duskMessage', 'endDayAliveCount', 'endDayReadyCount', 'endDayReadyNames', 'hostId',
  'leftNeighborName', 'mySlayerUsed', 'myCharacter', 'myEndDayReady', 'myGhostVoteUsed', 'myLog', 'mySeatRightId', 'night',
  'nightResult', 'nightTurn', 'nomination', 'onBlockId', 'phase', 'publicLog', 'players', 'rightNeighborName', 'seatingConfirmed',
  'selfId', 'waitingForOthers', 'winner', 'replay', 'script',
];
const PLAYER_KEYS = [
  'alive', 'character', 'characterName', 'connected', 'declaredRightId', 'ghostVoteUsed', 'hasBeenNominatedToday',
  'hasDeclaredSeating', 'hasNominatedToday', 'id', 'isSelf', 'name', 'seat',
];
const PUBLIC_LOG_KEYS = new Set([
  'foundDead', 'nobodyDiedLastNight', 'noExecutionToday', 'nominates', 'notEnoughVotes', 'onBlock', 'slayerHit', 'slayerMiss',
  'tieClearsBlock', 'virginExecutesNominator', 'wasExecuted', 'goodWinsDemonDead', 'evilWinsTwoLeft', 'goodWinsMayor', 'saintWins',
]);

/** Everything about the game that must never reach a phone. */
function secretsOf(s: GameState): string[] {
  return [s.secret, ...s.players.map((p) => p.token)];
}

test('a view has exactly the known fields — anything new must be added here on purpose', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const v = viewFor(s, s.players[0].id) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(v).sort(), [...VIEW_KEYS].sort());
  for (const p of viewFor(s, s.players[0].id).players) assert.deepEqual(Object.keys(p).sort(), PLAYER_KEYS.filter((k) => k in p || !['character', 'characterName'].includes(k)).sort());
});

test('a night kill is not visible in the raw player list before dawn — for anyone', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'monk']);
  const empath = byChar(s, 'empath');
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [empath.id]);
  assert.equal(empath.alive, false);
  for (const viewer of s.players) {
    const shown = viewFor(s, viewer.id).players.find((p) => p.id === empath.id)!;
    assert.equal(shown.alive, true, `${viewer.name} must not learn from the player list that the Empath died`);
  }
  assert.equal(viewFor(s, empath.id).amIAlive, true);
});

test('after dawn the same kill is public', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'monk']);
  const empath = byChar(s, 'empath');
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [empath.id]);
  runFullNight(s);
  assert.equal(s.phase, 'day');
  for (const viewer of s.players) assert.equal(viewFor(s, viewer.id).players.find((p) => p.id === empath.id)!.alive, false);
});

test('the Ravenkeeper sees their own death at once (it is their ability); everyone else still does not', () => {
  const s = mk(['imp', 'poisoner', 'ravenkeeper', 'washerwoman', 'soldier', 'monk']);
  const rk = byChar(s, 'ravenkeeper');
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [rk.id]);
  assert.equal(viewFor(s, rk.id).players.find((p) => p.id === rk.id)!.alive, false, 'their own row shows dead');
  assert.equal(viewFor(s, byChar(s, 'soldier').id).players.find((p) => p.id === rk.id)!.alive, true);
});

test('another player\'s character is never in the data — mid-game, at any phase', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'monk']);
  for (const phase of ['day', 'night'] as const) {
    s.phase = phase;
    for (const viewer of s.players) {
      for (const p of viewFor(s, viewer.id).players) {
        if (p.isSelf) continue;
        assert.equal(p.character, undefined);
        assert.equal(p.characterName, undefined);
      }
    }
  }
});

test('a Drunk is told (and shown) their false character, never the truth, until the end', () => {
  const s = mk(['imp', 'poisoner', 'drunk', 'washerwoman', 'soldier', 'monk'], { drunkFakeChar: 'empath' });
  const drunk = byChar(s, 'drunk');
  const v = viewFor(s, drunk.id);
  assert.equal(v.myCharacter!.id, 'empath');
  // (The script — the character sheet everyone can read — lists the Drunk like any other character.)
  assert.ok(!JSON.stringify({ ...v, script: null }).includes('"drunk"'));
  assert.equal(v.myCharacter!.alignment, 'good');
  s.phase = 'ended';
  s.winner = 'good';
  assert.equal(viewFor(s, byChar(s, 'soldier').id).players.find((p) => p.id === drunk.id)!.character, 'drunk', 'revealed at the end');
});

test('when the game ends every character is revealed to everyone', () => {
  const s = mkDay(['imp', 'slayer', 'empath', 'investigator', 'soldier']);
  useSlayer(s, s.players[1].id, s.players[0].id);
  assert.equal(s.phase, 'ended');
  for (const viewer of s.players) {
    for (const p of viewFor(s, viewer.id).players) assert.equal(p.character, s.players.find((q) => q.id === p.id)!.character);
  }
});

test('a stranger (not in the game) gets an empty personal view and no secrets', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const v = viewFor(s, 'not-a-player');
  assert.equal(v.myCharacter, null);
  assert.equal(v.nightTurn, null);
  assert.equal(v.amIAlive, false);
  assert.deepEqual(v.myLog, []);
  for (const secret of secretsOf(s)) assert.ok(!JSON.stringify(v).includes(secret));
});

test('the public log only ever contains messages meant for everyone (checked over 130 full games)', () => {
  for (let n = 5; n <= 15; n++) {
    for (let seed = 0; seed < 10; seed++) {
      const s = playGame(seed, n);
      for (const m of s.publicLog) assert.ok(PUBLIC_LOG_KEYS.has(m.key), `"${m.key}" leaked into the public log (seed ${seed}, ${n}p)`);
    }
  }
});

test('over whole games, no phone is ever sent the secret seed or another player\'s token — at every step', () => {
  for (let n = 5; n <= 15; n += 2) {
    playGame(1, n, (s, where) => {
      for (const viewer of s.players) {
        const json = JSON.stringify(viewFor(s, viewer.id));
        for (const secret of secretsOf(s)) assert.ok(!json.includes(secret), `${where}: a secret reached ${viewer.name}`);
      }
    });
  }
});

test('a poisoned or drunk player looks exactly like a healthy one in their own data', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'monk']);
  const empath = byChar(s, 'empath');
  startNight(s);
  const healthy = JSON.stringify(viewFor(s, empath.id).myCharacter);
  s.poisonedId = empath.id;
  assert.equal(JSON.stringify(viewFor(s, empath.id).myCharacter), healthy);
  const keys = Object.keys(viewFor(s, empath.id));
  assert.ok(!keys.some((k) => /poison|drunk|sober|healthy/i.test(k)));
});

test('a night decoy is indistinguishable from a real turn in everything but the flag the phone itself needs', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'monk', 'chef']);
  startNight(s);
  advanceUntil(s, 'poisoner');
  const real = viewFor(s, byChar(s, 'poisoner').id).nightTurn!;
  const decoy = viewFor(s, byChar(s, 'soldier').id).nightTurn!;
  assert.deepEqual(Object.keys(real).sort(), Object.keys(decoy).sort());
  assert.equal(real.choices.length, decoy.choices.length);
  assert.deepEqual(real.choices, decoy.choices, 'the same list of players to pick from');
});

test('nobody\'s view shows how many decoys/real turns exist at a step, only their own screen', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'monk', 'chef']);
  startNight(s);
  advanceUntil(s, 'poisoner');
  const json = JSON.stringify(viewFor(s, byChar(s, 'soldier').id));
  assert.ok(!json.includes('participantIds') && !json.includes('decoys') && !json.includes('playerIds'));
});

test('the day view leaks nothing from the night that is not public: no votes on who was poisoned, protected or targeted', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'monk']);
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'poisoner');
  answerRealTurn(s, [byChar(s, 'soldier').id]);
  advanceUntil(s, 'monk');
  answerRealTurn(s, [byChar(s, 'empath').id]);
  runFullNight(s);
  const json = JSON.stringify(viewFor(s, s.players[0].id));
  for (const key of ['poisonedId', 'monkProtectedId', 'butlerMasterId', 'bluffs', 'pendingRealTurn', 'lastDecoyKeys']) assert.ok(!json.includes(key), key);
});

test('votes are public by design: everyone sees each vote as it is cast (hands are raised in the open)', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const [, , empath, , soldier] = s.players;
  nominate(s, empath.id, soldier.id);
  fastForwardToVote(s);
  const first = s.currentNomination!.currentVoterId!;
  castVote(s, first, true);
  const seenBy = s.players.map((p) => viewFor(s, p.id).nomination!.votes);
  for (const votes of seenBy) assert.deepEqual(votes, { [first]: true });
});
