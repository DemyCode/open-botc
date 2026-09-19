import { CHARACTERS } from './characters.js';
import { hooksOf, notifyChosen } from './deaths.js';
import { demonInfo, minionInfo } from './info.js';
import { record } from './history.js';
import { appendLog } from './log.js';
import { abilityLostReason, noteMalfunction } from './registration.js';
import { evaluateWin } from './win.js';
import type { NightSpec } from './hooks.js';
import type { CharacterId, GameState, Msg, NightTurnShape, PendingRealTurn, PlayerState } from './types.js';
import { GameError } from './types.js';

function msg(key: string, vars?: Record<string, string | number | string[]>): Msg {
  return vars ? { key, vars } : { key };
}

import { EVIL_INTRO_MIN_PLAYERS } from './constants.js';
export { EVIL_INTRO_MIN_PLAYERS };

/**
 * "When you reach dawn, simply wait five to ten seconds… The small wait at dawn prevents players
 * from knowing for sure whether they were the last to act at night." On top of that, a night
 * never ends sooner than MIN_NIGHT_MS after it began — otherwise a night where nobody (or only
 * one quick player) acts would end so fast that everyone could tell.
 */
// (Each can be overridden by an environment variable — only so tests can run a whole night in seconds.)
const fromEnv = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return process.env[name] !== undefined && Number.isFinite(v) && v >= 0 ? v : fallback;
};
export const DAWN_WAIT_MIN_MS = fromEnv('BOTC_DAWN_MIN_MS', 5_000);
export const DAWN_WAIT_MAX_MS = Math.max(DAWN_WAIT_MIN_MS, fromEnv('BOTC_DAWN_MAX_MS', 10_000));
export const MIN_NIGHT_MS = fromEnv('BOTC_MIN_NIGHT_MS', 30_000);

/** Nobody — real actor or not — can answer a night step sooner than this after it opens, so an
 * instant answer never marks a decoy apart from a real choice. Enforced by the server clock. */
export const MIN_ANSWER_MS = fromEnv('BOTC_MIN_ANSWER_MS', 5_000);

/** Decoy questions for "choose" steps (asked of everyone who isn't the real actor). Keys are
 * translated on the client. A 2-player step always gets the 2-player question. */
export const DECOY_PICK_ONE = ['decoyTrust', 'decoySuspect', 'decoyQuiet', 'decoyNominate', 'decoyDemon', 'decoyBelieve', 'decoyOutsider'];
export const DECOY_PICK_TWO = 'decoySameTeam';
/** The decoy for an "info" step: something to read, then "Got it" — like the real info screen. */
export const DECOY_INFO = 'decoyInfo';

export { evaluateWin, setWinner } from './win.js';

export { appendLog };

/** Steps that aren't a character: the first night's Minion info. */
const PSEUDO_STEPS: Record<string, { firstNight: number; otherNight: number; night: NightSpec }> = {
  // Demons whose own step already carries the Demon info (the Imp) don't take part here.
  'demon-info': {
    firstNight: 10, otherNight: 0,
    night: {
      actors: (s) => (s.players.length < EVIL_INTRO_MIN_PLAYERS ? [] : s.players.filter((p) => p.alive && CHARACTERS[p.perceived]?.team === 'demon' && !CHARACTERS[p.perceived].hooks?.night?.ownDemonInfo)),
      shape: () => 'info',
      info: (s, self) => demonInfo(s, self),
      abilityWake: () => false,
    },
  },
  'minion-info': {
    firstNight: 5, otherNight: 0,
    night: {
      actors: (s) => (s.players.length < EVIL_INTRO_MIN_PLAYERS ? [] : s.players.filter((p) => p.alive && CHARACTERS[p.character].team === 'minion')),
      shape: () => 'info',
      info: (s, self) => minionInfo(s, self),
      abilityWake: () => false,
    },
  },
};

interface StepDef { id: string; order: number; spec: NightSpec | undefined; shape: NightTurnShape }

/** The night's steps, in order: every character (any edition) with a place in tonight's order. */
export function nightSequence(first: boolean, editions?: string[]): string[] {
  const steps: StepDef[] = [];
  for (const c of Object.values(CHARACTERS)) {
    if (editions && !editions.includes(c.edition)) continue;
    const order = first ? c.firstNight : c.otherNight;
    if (order > 0) steps.push({ id: c.id, order, spec: c.hooks?.night, shape: c.shape });
  }
  for (const [id, p] of Object.entries(PSEUDO_STEPS)) {
    const order = first ? p.firstNight : p.otherNight;
    if (order > 0) steps.push({ id, order, spec: p.night, shape: 'info' });
  }
  return steps.sort((x, y) => x.order - y.order).map((x) => x.id);
}

/** Trouble Brewing's night order (kept for tests and documentation). */
export const FIRST_NIGHT_SEQUENCE: string[] = nightSequence(true, ['tb']);
export const OTHER_NIGHT_SEQUENCE: string[] = nightSequence(false, ['tb']);

export function specOf(step: string): NightSpec | undefined {
  return PSEUDO_STEPS[step]?.night ?? CHARACTERS[step]?.hooks?.night;
}

function findPlayer(state: GameState, id: string): PlayerState {
  const p = state.players.find((pl) => pl.id === id);
  if (!p) throw new GameError(`Unknown player ${id}`);
  return p;
}

function actorsFor(state: GameState, step: string): PlayerState[] {
  const spec = specOf(step);
  if (!spec) return [];
  const actors = spec.actors ? spec.actors(state, step) : state.players.filter((p) => (p.alive || p.flags.keepsAbility) && p.perceived === step);
  // A Demon the Exorcist chose does not wake to use their Demon ability tonight.
  const exorcised: string[] = state.data.exorcised ?? [];
  return actors.filter((p) => !(exorcised.includes(p.id) && CHARACTERS[p.character]?.team === 'demon' && !PSEUDO_STEPS[step]));
}

function shapeFor(state: GameState, step: string): NightTurnShape {
  const spec = specOf(step);
  if (spec?.shape) return spec.shape(state);
  return PSEUDO_STEPS[step] ? 'info' : CHARACTERS[step]?.shape ?? 'info';
}

/** Who is woken at every step tonight: every player the table still sees as alive — including
 * someone killed earlier tonight, who mustn't notice their screens stopping before dawn. */
/**
 * Who gets a screen during a step: everyone. The living get the real prompt or a decoy; the dead
 * get decoys too, so that a player who *looks* dead but still wakes (the Zombuul, a Vigormortis'
 * Minion, the Sage) cannot be spotted by being the only "corpse" with something to do.
 */
function nightParticipants(state: GameState): PlayerState[] {
  return state.players;
}

function startRound(state: GameState, step: string, actors: PlayerState[]): void {
  const slot = `${step}-n${state.night}`;
  const shape = shapeFor(state, step);
  const spec = specOf(step);
  const bodyByPlayer: Record<string, Msg> = {};
  let min = 0;
  let max = 0;
  let pickCharacter = false;
  let optionalCharacter = false;
  let characterPool: CharacterId[] | undefined;

  if (shape === 'info') {
    for (const p of actors) {
      const text = spec?.info ? spec.info(state, p, slot) : msg('empty');
      appendLog(state, p.id, text);
      bodyByPlayer[p.id] = text;
      noteMalfunction(state, p);
      record(state, 'info', { actor: p.id, character: p.perceived, step, msg: text, lost: abilityLostReason(state, p) });
    }
  } else {
    for (const p of actors) {
      const cfg = spec?.prompt ? spec.prompt(state, p) : { min: 0, max: 0, body: msg('empty') };
      min = cfg.min;
      max = cfg.max;
      pickCharacter = !!cfg.pickCharacter;
      optionalCharacter = !!cfg.optionalCharacter;
      characterPool = cfg.characterPool;
      bodyByPlayer[p.id] = cfg.body;
    }
  }

  const actorIds = actors.map((p) => p.id);
  if (spec?.abilityWake ? spec.abilityWake(state) : true) {
    const woke: string[] = (state.data.woke ??= []);
    for (const id of actorIds) if (!woke.includes(id)) woke.push(id);
  }
  const participantIds = [...new Set([...actorIds, ...nightParticipants(state).map((p) => p.id)])];
  const decoys: Record<string, string> = {};
  for (const id of participantIds) {
    if (actorIds.includes(id)) continue;
    if (shape === 'info') decoys[id] = DECOY_INFO;
    else if (max === 2) decoys[id] = DECOY_PICK_TWO;
    else {
      const last = (state.lastDecoyKeys ??= {});
      const pool = DECOY_PICK_ONE.filter((k) => k !== last[id]); // never the same question twice in a row
      decoys[id] = last[id] = pool[Math.floor(Math.random() * pool.length)];
    }
  }

  state.pendingRealTurn = {
    charId: step, playerIds: actorIds, participantIds, decoys, shape, min, max, bodyByPlayer,
    responses: {}, openedAt: Date.now(), pickCharacter, optionalCharacter, characterPool, result: !!spec?.result,
  };
}

export function beginNight(state: GameState): void {
  state.phase = 'night';
  state.night += 1;
  record(state, 'nightStart');
  state.deathsTonight = [];
  state.monkProtectedId = null;
  state.nightSlotIndex = -1;
  state.pendingRealTurn = null;
  state.nightStartedAt = Date.now();
  state.nightStepNumber = 0;
  state.dawnAt = null;
  state.effects = state.effects.filter((e) => e.untilNight === null || e.untilNight >= state.night);
  // Per-night notes for the hooks (who is safe, who the Exorcist chose, who woke...).
  state.data.safe = [];
  state.data.exorcised = [];
  state.data.woke = [];
  state.data.goonUsed = false;
  state.data.daProtected = null;
  state.data.resurrected = [];
  state.data.witchTarget = null;
  state.data.mad = null;
  state.data.madClaimed = false;
  state.data.arbitraryDeaths = false;
  for (const p of state.players) {
    p.nightResult = null;
    // Reset here (not just on death) so it accurately reflects *this* night by dawn — otherwise
    // it would still read true forever after whichever night someone actually died.
    p.diedTonight = false;
  }
  advanceNightSlot(state);
}

export function advanceNightSlot(state: GameState): void {
  if (state.winner) return; // a kill this night already ended the game — finishNight must not flip phase back to 'day'
  const seq = nightSequence(state.night === 1);
  while (state.nightSlotIndex + 1 < seq.length) {
    state.nightSlotIndex += 1;
    const step = seq[state.nightSlotIndex];
    specOf(step)?.before?.(state);
    if (state.winner) return;
    // Like the Storyteller, only wake a step whose character is really in play tonight.
    const actors = actorsFor(state, step);
    if (actors.length === 0) continue;
    state.nightStepNumber = (state.nightStepNumber ?? 0) + 1;
    startRound(state, step, actors);
    return;
  }
  // Everyone has acted — but dawn waits (see DAWN_WAIT_*); tick() breaks it when it's time.
  state.pendingRealTurn = null;
  const now = Date.now();
  const wait = DAWN_WAIT_MIN_MS + Math.random() * (DAWN_WAIT_MAX_MS - DAWN_WAIT_MIN_MS);
  state.dawnAt = Math.max(now + wait, (state.nightStartedAt ?? now) + MIN_NIGHT_MS);
}

function finishNight(state: GameState): void {
  state.pendingRealTurn = null;
  state.dawnAt = null;
  state.phase = 'day';
  state.day += 1;
  state.onBlockId = null;
  state.highestYesToday = 0;
  state.usedNominatorIds = [];
  state.usedNomineeIds = [];
  state.currentNomination = null;
  state.endDayRequestedBy = [];
  state.data.safe = [];
  state.data.diedToday = [];
  // "Since dawn" bookkeeping for the Mathematician and the day's public events (Flowergirl/Town Crier).
  state.data.malfunctions = {};
  state.data.demonVotedToday = false;
  state.data.minionNominatedToday = false;
  record(state, 'dawn', { deaths: [...state.deathsTonight] });
  for (const id of state.deathsTonight) {
    const p = state.players.find((pl) => pl.id === id);
    if (p) state.publicLog.push(msg('foundDead', { name: p.name }));
  }
  for (const id of (state.data.resurrected ?? []) as string[]) {
    const p = state.players.find((pl) => pl.id === id);
    if (p) state.publicLog.push(msg('resurrected', { name: p.name }));
  }
  if (state.deathsTonight.length === 0 && state.night > 1) {
    state.publicLog.push(msg('nobodyDiedLastNight'));
  }
}

/** Applies a choose-shape ability's effect (see NightSpec.apply). */
function applyRealChoice(state: GameState, step: string, playerId: string, targets: string[], character?: string): void {
  const self = findPlayer(state, playerId);
  const spec = specOf(step);
  const slot = `${step}-n${state.night}`;
  // A choice is only a "choice" when the player really picked someone (an info step's "Got it"
  // is not one). The Imp's pick is told as the attack itself, with its outcome.
  if (spec?.recordsChoice) record(state, 'choice', { actor: playerId, character: self.perceived, ability: step, targets, lost: abilityLostReason(state, self), ...(character ? { picked: character } : {}) });
  noteMalfunction(state, self);
  // The Goon (and anyone like them) reacts the moment they are chosen, before the ability resolves.
  if (!spec?.sequentialTargets) for (const id of targets) notifyChosen(state, self, id, step);
  spec?.apply?.(state, self, targets, slot, character);
  hooksOf(self.character).onOwnNightAction?.(state, self, step, targets);
}

function maybeAdvance(state: GameState): void {
  if (state.winner) {
    // The kill that was just applied already ended the game (evaluateWin) — stop here instead of
    // advancing into the next slot, and clear the stale turn so viewers see the ended game, not a
    // prompt that no longer matters.
    state.pendingRealTurn = null;
    return;
  }
  const t = state.pendingRealTurn;
  if (t && stepComplete(state, t)) advanceNightSlot(state);
}

/** A step is done once every real actor has answered, and every decoy too — except a decoy of
 * someone who has lost connection: a real turn is always waited for, a decoy never blocks. */
function stepComplete(state: GameState, t: PendingRealTurn): boolean {
  return t.participantIds.every((id) => {
    if (id in t.responses) return true;
    if (t.playerIds.includes(id)) return false;
    return !state.players.find((p) => p.id === id)?.connected;
  });
}

/**
 * A player's answer to the current night step — their real turn, or their decoy question (the
 * server knows which; the protocol doesn't differ). `now` is the server clock: when given, an
 * answer sooner than MIN_ANSWER_MS after the step opened is refused.
 */
export function submitRealResponse(state: GameState, playerId: string, targetIds: string[], now?: number, character?: string): void {
  const t = state.pendingRealTurn;
  if (!t || !t.participantIds.includes(playerId)) throw new GameError('No pending night turn for this player');
  if (playerId in t.responses) throw new GameError('Already responded');
  if (now !== undefined && now < t.openedAt + MIN_ANSWER_MS) throw new GameError('Too early — take a few seconds');
  const isDecoy = !t.playerIds.includes(playerId);
  const spec = specOf(t.charId);
  if (t.shape === 'choose') {
    if (targetIds.length < t.min || targetIds.length > t.max) throw new GameError('Invalid selection count');
    if (new Set(targetIds).size !== targetIds.length) throw new GameError('Cannot choose the same player twice');
    // "If you get to choose 'any player' at night, you can choose yourself or a dead player."
    const eligible = new Set(state.players.map((p) => p.id));
    for (const id of targetIds) if (!eligible.has(id)) throw new GameError('Invalid target');
    if (!isDecoy && spec?.notSelf && targetIds.includes(playerId)) {
      throw new GameError('Cannot choose yourself');
    }
    if (!isDecoy && t.pickCharacter && !(character ? CHARACTERS[character] : specOf(t.charId)?.prompt?.(state, findPlayer(state, playerId)).optionalCharacter)) throw new GameError('Choose a character');
    if (!isDecoy && character && t.characterPool && !t.characterPool.includes(character)) throw new GameError('Choose a valid character');
    if (!isDecoy) {
      const eligible = specOf(t.charId)?.prompt?.(state, findPlayer(state, playerId)).eligible;
      const self = findPlayer(state, playerId);
      if (eligible) for (const id of targetIds) if (!eligible(state, self, findPlayer(state, id))) throw new GameError('You cannot choose that player');
    }
  }
  t.responses[playerId] = t.shape === 'choose' ? targetIds : [];
  if (!isDecoy && t.shape === 'choose') applyRealChoice(state, t.charId, playerId, targetIds, character); // a decoy answer is never used
  maybeAdvance(state);
}

/** Night upkeep, once a second: a step whose only missing answers are decoys of disconnected
 * players moves on, and dawn breaks once its time has come. Nobody's real turn ever times out. */
export function tick(state: GameState, now: number): void {
  if (state.phase !== 'night' || state.winner) return;
  if (state.pendingRealTurn) maybeAdvance(state);
  if (state.dawnAt != null && now >= state.dawnAt) finishNight(state);
}
