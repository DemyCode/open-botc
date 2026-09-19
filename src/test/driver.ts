// A random-but-seeded game driver shared by the simulation, privacy and i18n tests: plays a whole
// game from the lobby to the winner through the same engine calls the server makes — legal moves
// and illegal ones (which must be refused with a GameError, never crash or corrupt the game).
import assert from 'node:assert/strict';
import { poisonedId } from './helpers.js';
import { CHARACTERS } from '../game/characters.js';
import {
  addPlayer, castVote, createGame, declareNeighbor, markReadyForSpeech, nominate, setScript, skipSpeech, startGame, tick,
  toggleEndDayRequest, useSlayer,
} from '../game/engine.js';
import { submitRealResponse } from '../game/night.js';
import { mulberry32, seedFromString } from '../game/rng.js';
import type { GameState, PlayerState } from '../game/types.js';
import { GameError } from '../game/types.js';
import { viewFor } from '../game/view.js';

/** Extra checks run at every step of a game (set by playGame's `onCheck`). */
let extraCheck: ((s: GameState, where: string) => void) | null = null;

export type Rand = () => number;
const pick = <T>(rand: Rand, xs: T[]): T => xs[Math.floor(rand() * xs.length)];
export const isDemon = (p: PlayerState) => CHARACTERS[p.character].team === 'demon';

/** An action that may legally be refused: it must either work, or throw a GameError. */
export function attempt(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch (err) {
    if (err instanceof GameError) return false;
    throw err; // anything else is a real bug
  }
}

export function checkInvariants(s: GameState, where: string): void {
  extraCheck?.(s, where);
  const alive = s.players.filter((p) => p.alive);
  // A Zombuul who "registers as dead" still counts as the living Demon for the game's purposes.
  const livingDemons = s.players.filter((p) => (p.alive || p.flags.hiddenAlive) && isDemon(p));
  // The Mastermind's extra day, the Evil Twin, and a "dead" Zombuul all let the game run on.
  const special = s.data.finalDay !== undefined
    || s.players.some((p) => p.alive && CHARACTERS[p.character].hooks?.blocksGoodWin?.(s, p))
    || s.players.some((p) => p.flags.hiddenAlive && isDemon(p));
  if (s.phase === 'ended') {
    assert.ok(s.winner === 'good' || s.winner === 'evil', `${where}: an ended game has a winner`);
  } else {
    assert.equal(s.winner, null, `${where}: no winner while the game is running`);
    // A script with the Pit-Hag may legally have several Demons in play at once.
    if (!special) assert.ok(livingDemons.length >= 1, `${where}: at least one living Demon while the game runs`);
    assert.ok(alive.length >= 3 || special, `${where}: the game would have ended at 2 alive`);
  }
  if (s.scriptId === 'tb') assert.ok(livingDemons.length <= 1, `${where}: never two living Demons in Trouble Brewing`);
  if (s.winner === 'good' && livingDemons.length === 1) {
    assert.ok(s.publicLog.some((m) => m.key === 'goodWinsMayor'), `${where}: good only wins with a living Demon via the Mayor`);
  }
  if (s.phase === 'night' && s.pendingRealTurn) {
    const t = s.pendingRealTurn;
    assert.ok(t.playerIds.length > 0, `${where}: a step ran with nobody really acting (everyone would get a decoy)`);
    // A dead player may still act only if their ability wakes the dead (the Ravenkeeper, the Sage)
    // or they keep their ability after being killed (a Vigormortis' Minion).
    const wakesWhileDead = (p: PlayerState): boolean => p.flags.keepsAbility === true || p.flags.hiddenAlive === true || CHARACTERS[p.perceived]?.hooks?.night?.wakesWhenDead === true;
    for (const id of t.playerIds.filter((id) => !(id in t.responses))) {
      const p = s.players.find((q) => q.id === id)!;
      assert.ok(p.alive || wakesWhileDead(p), `${where}: only the living (or an ability that wakes the dead) wake`);
    }
    // Everyone gets a screen at every step: the living get the real prompt or a decoy, and the dead
    // get decoys too, so a player who looks dead but still wakes (the Zombuul) is not the only
    // "corpse" with something to do.
    assert.deepEqual(new Set(t.participantIds), new Set(s.players.map((p) => p.id)), `${where}: everyone is woken`);
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
    // Someone who isn't woken at all (dead from an earlier night) tries to answer: always refused.
    const outsider = s.players.find((p) => !t.participantIds.includes(p.id));
    if (outsider) assert.equal(attempt(() => submitRealResponse(s, outsider.id, [])), false, `${where}: stranger answered`);
    // Answering before the 5-second minimum is always refused, real turn or decoy.
    const anyone = t.participantIds.find((id) => !(id in t.responses))!;
    assert.equal(attempt(() => submitRealResponse(s, anyone, [], t.openedAt + 4_999)), false, `${where}: answered too early`);

    const actorId = t.participantIds.find((id) => !(id in t.responses))!;
    if (rand() < 0.2 && t.shape === 'choose') {
      // A bad answer (wrong count, duplicates, nonsense id) must be refused, not applied.
      const bad = pick(rand, t.min === 0 ? [['nobody'], [actorId, actorId, actorId]] : [[], ['nobody'], [actorId, actorId, actorId]]);
      assert.equal(attempt(() => submitRealResponse(s, actorId, bad)), false, `${where}: a bad answer was accepted`);
    }
    if (t.shape === 'choose') {
      // The screen's own choices already mark who is ineligible, so follow them.
      const turn = viewFor(s, actorId).nightTurn;
      const choices = (turn?.choices ?? []).filter((c) => !c.disabled);
      // Real players mostly aim at the living (the dead are legal targets, but pointless).
      const livingOnly = rand() < 0.85;
      let pool = choices.filter((c) => !livingOnly || c.alive || s.players.filter((q) => q.alive).length < t.max).map((c) => c.id);
      if (pool.length < t.min) pool = choices.map((c) => c.id);
      if (pool.length < t.min) pool = s.players.map((p) => p.id);
      const targets: string[] = [];
      while (targets.length < t.min) {
        const id = pick(rand, pool);
        if (!targets.includes(id)) targets.push(id);
      }
      // A step that also asks for a character (Gambler, Cerenovus, Pit-Hag...): pick one from the screen.
      let character: string | undefined;
      if (t.pickCharacter && turn && turn.characters.length && !(t.optionalCharacter && t.min === 0 && rand() < 0.3)) {
        character = pick(rand, turn.characters.map((c) => c.id));
      }
      submitRealResponse(s, actorId, targets, t.openedAt + 5_000, character);
    } else {
      submitRealResponse(s, actorId, [], t.openedAt + 5_000);
    }
    checkInvariants(s, where);
  }
  assert.notEqual(s.phase, 'night', `${where}: the night finished`);
}

function runNomination(s: GameState, rand: Rand, where: string): void {
  let guard = 0;
  while (s.currentNomination && guard++ < 200) {
    const nom = s.currentNomination;
    if (nom.state === 'readyForAccusation') {
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

/**
 * With the Demon dead but the Evil Twin and their good twin both alive, good cannot win and there
 * is no night kill left: the only way out is to execute a twin. A random table might never get
 * there, so the driver forces that one execution rather than looping forever.
 */
function resolveTwinStalemate(s: GameState): void {
  if (s.players.some((p) => p.alive && isDemon(p))) return;
  const owner = s.players.find((p) => p.alive && CHARACTERS[p.character].hooks?.blocksGoodWin?.(s, p));
  if (!owner) return;
  const target = s.players.find((p) => p.alive && p.id !== owner.id && (p.flags.evilTwinId === owner.id || owner.flags.twinId === p.id)) ?? owner;
  const nominator = s.players.find((p) => p.alive && p.id !== target.id);
  if (!nominator || !attempt(() => nominate(s, nominator.id, target.id)) || !s.currentNomination) return;
  let guard = 0;
  while (s.currentNomination && guard++ < 60) {
    const nom = s.currentNomination;
    if (nom.state === 'readyForAccusation') {
      for (const p of s.players) if (!nom.readyBy.includes(p.id)) markReadyForSpeech(s, p.id);
    } else if (nom.state === 'accusing') {
      skipSpeech(s, nom.nominatorId);
    } else if (nom.state === 'defending') {
      skipSpeech(s, nom.nomineeId);
    } else if (nom.state === 'voting' && nom.currentVoterId) {
      castVote(s, nom.currentVoterId, true);
    }
  }
}

function playDay(s: GameState, rand: Rand, where: string): void {
  let guard = 0;
  while (s.phase === 'day' && guard++ < 60) {
    const alive = s.players.filter((p) => p.alive);
    resolveTwinStalemate(s);
    if (s.phase !== 'day') break;
    const r = rand();
    if (r < 0.15) {
      // Anyone may claim a Slayer shot — a real one, a bluff, from the dead, or twice.
      const shooter = pick(rand, s.players);
      // A real Slayer sometimes guesses right (aims at the actual Demon), or a hit would be a fluke.
      const demon = s.players.find((p) => p.alive && isDemon(p));
      const target = shooter.character === 'slayer' && demon && rand() < 0.5 ? demon : pick(rand, s.players);
      attempt(() => useSlayer(s, shooter.id, target.id));
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
  if (s.phase === 'day' && s.currentNomination) runNomination(s, rand, where);
  if (s.phase === 'day') {
    // Wrap up a long day.
    for (const p of s.players.filter((q) => q.alive)) {
      if (s.phase === 'day' && !s.currentNomination && !s.endDayRequestedBy.includes(p.id)) attempt(() => toggleEndDayRequest(s, p.id));
    }
  }
  assert.notEqual(s.phase, 'day', `${where}: the day finished`);
}

/** A one-line summary of a stuck game, for failure messages. */
export function describe(s: GameState): string {
  const alive = s.players.filter((p) => p.alive).map((p) => `${p.character}${p.perceived !== p.character ? `(thinks ${p.perceived})` : ''}`);
  return `alive: ${alive.join(', ')}; poisoned: ${s.players.find((p) => p.id === poisonedId(s))?.character ?? 'nobody'}; phase ${s.phase}; last log: ${s.publicLog.slice(-4).map((m) => m.key).join(', ')}`;
}

export function playGame(seed: number, playerCount: number, onCheck?: (s: GameState, where: string) => void, names?: string[], scriptId = 'tb'): GameState {
  extraCheck = onCheck ?? null;
  const rand = mulberry32(seedFromString(`sim-${seed}-${playerCount}-${scriptId}`));
  const realRandom = Math.random;
  Math.random = rand; // the engine's own random choices (Mayor redirect, star-pass, dawn) are seeded too
  try {
    const s = createGame('SIM');
    s.secret = `sim-secret-${seed}-${playerCount}`;
    const players = Array.from({ length: playerCount }, (_, i) => addPlayer(s, names?.[i] ?? `P${i}`));
    players.forEach((p, i) => declareNeighbor(s, p.id, players[(i + 1) % playerCount].id));
    if (scriptId !== 'tb') setScript(s, scriptId);
    startGame(s);
    const where = () => `seed ${seed}, ${playerCount}p, night ${s.night}, day ${s.day}`;
    checkInvariants(s, where());
    let rounds = 0;
    while (s.phase !== 'ended' && rounds++ < 100) {
      if (s.phase === 'night') playNight(s, rand, where());
      else if (s.phase === 'day') playDay(s, rand, where());
    }
    assert.equal(s.phase, 'ended', `${where()}: the game reached an end — ${describe(s)}`);
    checkInvariants(s, where());
    return s;
  } finally {
    Math.random = realRandom;
    extraCheck = null;
  }
}

