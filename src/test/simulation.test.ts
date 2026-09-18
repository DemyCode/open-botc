// Plays hundreds of complete random games — lobby to victory, every player count — through the
// same engine calls the server makes, and checks the game's invariants after every single step.
// Random moves include the legal and the illegal: an illegal move must be refused with a
// GameError (what the player sees as a polite error), never crash or corrupt the game.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHARACTERS } from '../game/characters.js';
import {
  addPlayer, castVote, createGame, declareNeighbor, markReadyForSpeech, nominate, skipSpeech, startGame, tick,
  toggleEndDayRequest, useSlayer,
} from '../game/engine.js';
import { submitRealResponse } from '../game/night.js';
import { mulberry32, seedFromString } from '../game/rng.js';
import type { GameState, PlayerState } from '../game/types.js';
import { GameError } from '../game/types.js';
import { viewFor } from '../game/view.js';

type Rand = () => number;
const pick = <T>(rand: Rand, xs: T[]): T => xs[Math.floor(rand() * xs.length)];
const isDemon = (p: PlayerState) => CHARACTERS[p.character].team === 'demon';

/** An action that may legally be refused: it must either work, or throw a GameError. */
function attempt(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch (err) {
    if (err instanceof GameError) return false;
    throw err; // anything else is a real bug
  }
}

function checkInvariants(s: GameState, where: string): void {
  const alive = s.players.filter((p) => p.alive);
  const livingDemons = alive.filter(isDemon);
  if (s.phase === 'ended') {
    assert.ok(s.winner === 'good' || s.winner === 'evil', `${where}: an ended game has a winner`);
  } else {
    assert.equal(s.winner, null, `${where}: no winner while the game is running`);
    assert.equal(livingDemons.length, 1, `${where}: exactly one living Demon while the game runs`);
    assert.ok(alive.length >= 3, `${where}: the game would have ended at 2 alive`);
  }
  assert.ok(livingDemons.length <= 1, `${where}: never two living Demons in Trouble Brewing`);
  if (s.winner === 'good' && livingDemons.length === 1) {
    assert.ok(s.publicLog.some((m) => m.key === 'goodWinsMayor'), `${where}: good only wins with a living Demon via the Mayor`);
  }
  if (s.phase === 'night' && s.pendingRealTurn) {
    for (const id of s.pendingRealTurn.playerIds) {
      const p = s.players.find((q) => q.id === id)!;
      assert.ok(p.alive || p.perceived === 'ravenkeeper', `${where}: only the living (or a just-killed Ravenkeeper) wake`);
    }
  }
  if (s.phase === 'day') {
    assert.equal(s.pendingRealTurn, null, `${where}: no night turn during the day`);
    const nom = s.currentNomination;
    if (nom?.state === 'voting' && nom.currentVoterId) {
      const voter = s.players.find((p) => p.id === nom.currentVoterId)!;
      assert.ok(voter.alive || !voter.ghostVoteUsed, `${where}: a dead player with no vote left is never asked to vote`);
    }
  }
  // Every player's screen can always be built, and never leaks anyone else's character mid-game.
  for (const p of s.players) {
    const v = viewFor(s, p.id);
    if (s.phase !== 'ended') {
      for (const other of v.players) {
        if (!other.isSelf) assert.equal(other.character, undefined, `${where}: ${p.name} can see ${other.name}'s character`);
      }
      assert.equal(v.myCharacter?.id, p.perceived, `${where}: a player sees who they *think* they are`);
    }
  }
}

function playNight(s: GameState, rand: Rand, where: string): void {
  let guard = 0;
  while (s.phase === 'night' && guard++ < 200) {
    const t = s.pendingRealTurn;
    if (!t) {
      assert.ok(s.dawnAt != null, `${where}: a night with nobody left to act is waiting for dawn`);
      tick(s, s.dawnAt! - 1);
      assert.equal(s.phase, 'night', `${where}: dawn never breaks early`);
      tick(s, s.dawnAt!);
      break;
    }
    // Someone who isn't acting tries to answer: always refused.
    const outsider = s.players.find((p) => !t.playerIds.includes(p.id));
    if (outsider) assert.equal(attempt(() => submitRealResponse(s, outsider.id, [])), false, `${where}: stranger answered`);

    const actorId = t.playerIds.find((id) => !(id in t.responses))!;
    if (rand() < 0.2 && t.shape === 'choose') {
      // A bad answer (wrong count, duplicates, nonsense id) must be refused, not applied.
      const bad = pick(rand, [[], ['nobody'], [actorId, actorId, actorId]]);
      attempt(() => submitRealResponse(s, actorId, bad));
    }
    if (t.shape === 'choose') {
      const pool = s.players
        .filter((p) => !((t.charId === 'monk' || t.charId === 'butler') && p.id === actorId))
        .map((p) => p.id);
      const targets: string[] = [];
      while (targets.length < t.min) {
        const id = pick(rand, pool);
        if (!targets.includes(id)) targets.push(id);
      }
      submitRealResponse(s, actorId, targets);
    } else {
      submitRealResponse(s, actorId, []);
    }
    checkInvariants(s, where);
  }
  assert.notEqual(s.phase, 'night', `${where}: the night finished`);
}

function runNomination(s: GameState, rand: Rand, where: string): void {
  let guard = 0;
  while (s.currentNomination && guard++ < 200) {
    const nom = s.currentNomination;
    if (nom.state === 'readyForAccusation' || nom.state === 'readyForDefense') {
      for (const p of s.players) if (!nom.readyBy.includes(p.id)) markReadyForSpeech(s, p.id);
    } else if (nom.state === 'accusing' || nom.state === 'defending') {
      // Half the time the speaker ends early, half the time the timer runs out.
      if (rand() < 0.5) skipSpeech(s, nom.state === 'accusing' ? nom.nominatorId : nom.nomineeId);
      else tick(s, nom.phaseEndsAt);
    } else if (nom.state === 'voting') {
      const voter = s.players.find((p) => p.id === nom.currentVoterId)!;
      if (rand() < 0.1) tick(s, nom.voterDeadline!); // the voter never answers — counts as a no
      else castVote(s, voter.id, rand() < (voter.alive ? 0.55 : 0.3));
    }
    checkInvariants(s, where);
  }
}

function playDay(s: GameState, rand: Rand, where: string): void {
  let guard = 0;
  while (s.phase === 'day' && guard++ < 60) {
    const alive = s.players.filter((p) => p.alive);
    const r = rand();
    if (r < 0.08) {
      // Anyone may claim a Slayer shot — a real one, a bluff, from the dead, or twice.
      attempt(() => useSlayer(s, pick(rand, s.players).id, pick(rand, s.players).id));
    } else if (r < 0.6) {
      // Any nomination at all, legal or not (dead nominators, repeats, dead or self nominees).
      if (attempt(() => nominate(s, pick(rand, s.players).id, pick(rand, s.players).id)) && s.currentNomination) {
        runNomination(s, rand, where);
      }
    } else if (r < 0.65) {
      attempt(() => castVote(s, pick(rand, s.players).id, true)); // voting with nothing to vote on
    } else {
      for (const p of alive) {
        if (s.phase !== 'day') break;
        if (!s.endDayRequestedBy.includes(p.id)) attempt(() => toggleEndDayRequest(s, p.id));
      }
    }
    checkInvariants(s, where);
  }
  if (s.phase === 'day') {
    // Wrap up a long day.
    for (const p of s.players.filter((q) => q.alive)) {
      if (s.phase === 'day' && !s.endDayRequestedBy.includes(p.id)) toggleEndDayRequest(s, p.id);
    }
  }
  assert.notEqual(s.phase, 'day', `${where}: the day finished`);
}

function playGame(seed: number, playerCount: number): GameState {
  const rand = mulberry32(seedFromString(`sim-${seed}-${playerCount}`));
  const realRandom = Math.random;
  Math.random = rand; // the engine's own random choices (Mayor redirect, star-pass, dawn) are seeded too
  try {
    const s = createGame('SIM');
    s.secret = `sim-secret-${seed}-${playerCount}`;
    const players = Array.from({ length: playerCount }, (_, i) => addPlayer(s, `P${i}`));
    players.forEach((p, i) => declareNeighbor(s, p.id, players[(i + 1) % playerCount].id));
    startGame(s);
    const where = () => `seed ${seed}, ${playerCount}p, night ${s.night}, day ${s.day}`;
    checkInvariants(s, where());
    let rounds = 0;
    while (s.phase !== 'ended' && rounds++ < 100) {
      if (s.phase === 'night') playNight(s, rand, where());
      else if (s.phase === 'day') playDay(s, rand, where());
    }
    assert.equal(s.phase, 'ended', `${where()}: the game reached an end`);
    checkInvariants(s, where());
    return s;
  } finally {
    Math.random = realRandom;
  }
}

// Every one of these must happen in at least one simulated game — proof that the random games
// really reach the rare corners of the rules, not just the easy path.
const MUST_SEE_PUBLIC = [
  'slayerHit', 'slayerMiss', 'virginExecutesNominator', 'onBlock', 'tieClearsBlock', 'notEnoughVotes',
  'noExecutionToday', 'foundDead', 'nobodyDiedLastNight',
  'goodWinsDemonDead', 'evilWinsTwoLeft', 'goodWinsMayor', 'saintWins',
];
const MUST_SEE_PRIVATE = ['scarletWomanPromoted', 'becameImp', 'demonInfo', 'fortuneTellerYes', 'ravenkeeperInfo'];

test('hundreds of random full games, 5 to 15 players, all end cleanly with every rule invariant holding', () => {
  const seen = new Set<string>();
  for (let playerCount = 5; playerCount <= 15; playerCount++) {
    for (let seed = 0; seed < 60; seed++) {
      const s = playGame(seed, playerCount);
      for (const m of s.publicLog) seen.add(m.key);
      for (const p of s.players) for (const e of p.log) seen.add(e.msg.key);
    }
  }
  const missing = [...MUST_SEE_PUBLIC, ...MUST_SEE_PRIVATE].filter((k) => !seen.has(k));
  assert.deepEqual(missing, [], 'these situations never came up in any simulated game');
});
