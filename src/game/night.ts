import { CHARACTERS } from './characters.js';
import { hooksOf, notifyChosen } from './deaths.js';
import { demonInfo, minionInfo } from './info.js';
import { record } from './history.js';
import { appendLog } from './log.js';
import { msg } from './messages.js';
import { abilityLostReason, hasAbility, noteMalfunction } from './registration.js';
import type { NightSpec } from './hooks.js';
import type { ActorProgress, ActorPrompt, CharacterId, GameState, Msg, NightScreen, NightTurnShape, PendingRealTurn, PlayerState } from './types.js';
import { GameError } from './types.js';

import { EVIL_INTRO_MIN_PLAYERS } from './constants.js';
export { EVIL_INTRO_MIN_PLAYERS };

/**
 * Dawn breaks the moment the last answer lands — no extra wait: everyone taps once in every round
 * (a real screen or a tip), so being the last to answer reveals nothing. The one floor: a night never ends
 * sooner than MIN_NIGHT_MS after it began — otherwise a night where nobody (or only one quick
 * player) acts would end so fast that everyone could tell.
 */
// (Each can be overridden by an environment variable — only so tests can run a whole night in seconds.)
const fromEnv = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return process.env[name] !== undefined && Number.isFinite(v) && v >= 0 ? v : fallback;
};
export const MIN_NIGHT_MS = fromEnv('BOTC_MIN_NIGHT_MS', 30_000);

/** Nobody — real actor or not — can answer a night screen sooner than this after its round opens, so an
 * instant tap never marks a tip apart from a real choice. Enforced by the server clock. */
export const MIN_ANSWER_MS = fromEnv('BOTC_MIN_ANSWER_MS', 5_000);

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
  const actors = spec.actors ? spec.actors(state, step) : state.players.filter((p) => hasAbility(state, p) && p.perceived === step);
  // A Demon the Exorcist chose does not wake to use their Demon ability tonight.
  const exorcised: string[] = state.data.exorcised ?? [];
  return actors.filter((p) => !(exorcised.includes(p.id) && CHARACTERS[p.character]?.team === 'demon' && !PSEUDO_STEPS[step]));
}

function shapeFor(state: GameState, step: string): NightTurnShape {
  const spec = specOf(step);
  if (spec?.shape) return spec.shape(state);
  return PSEUDO_STEPS[step] ? 'info' : CHARACTERS[step]?.shape ?? 'info';
}

/**
 * Who gets a screen during a step: everyone. The actors get their real screens, everyone else tips;
 * the dead get tips too, so that a player who *looks* dead but still wakes (the Zombuul, a
 * Vigormortis' Minion, the Sage) cannot be spotted by being the only "corpse" with something to do.
 */
function nightParticipants(state: GameState): PlayerState[] {
  return state.players;
}

function startStep(state: GameState, step: string, actors: PlayerState[]): void {
  const slot = `${step}-n${state.night}`;
  const shape = shapeFor(state, step);
  const spec = specOf(step);
  const bodyByPlayer: Record<string, Msg> = {};
  const prompts: Record<string, ActorPrompt> = {};
  const progress: Record<string, ActorProgress> = {};
  let last: ActorPrompt = { min: 0, max: 0 };

  if (shape === 'info') {
    for (const p of actors) {
      const text = spec?.info ? spec.info(state, p, slot) : msg('empty');
      appendLog(state, p.id, text);
      bodyByPlayer[p.id] = text;
      noteMalfunction(state, p);
      record(state, 'info', { actor: p.id, character: p.perceived, step, msg: text, lost: abilityLostReason(state, p) });
      progress[p.id] = { targets: [] };
    }
  } else {
    for (const p of actors) {
      const cfg = spec?.prompt ? spec.prompt(state, p) : { min: 0, max: 0, body: msg('empty') };
      last = {
        min: cfg.min, max: cfg.max,
        ...(cfg.counts ? { counts: cfg.counts } : {}),
        ...(cfg.pickCharacter ? { pickCharacter: true } : {}),
        ...(cfg.optionalCharacter ? { optionalCharacter: true } : {}),
        ...(cfg.characterPool ? { characterPool: cfg.characterPool } : {}),
      };
      prompts[p.id] = last;
      bodyByPlayer[p.id] = cfg.body;
      progress[p.id] = { targets: [] };
    }
  }

  const actorIds = actors.map((p) => p.id);
  if (spec?.abilityWake ? spec.abilityWake(state) : true) {
    const woke: string[] = (state.data.woke ??= []);
    for (const id of actorIds) if (!woke.includes(id)) woke.push(id);
  }
  const participantIds = [...new Set([...actorIds, ...nightParticipants(state).map((p) => p.id)])];

  const t: PendingRealTurn = {
    charId: step, playerIds: actorIds, participantIds, round: -1, screens: {}, progress, prompts,
    shape, min: last.min, max: last.max, ...(last.counts ? { counts: last.counts } : {}), bodyByPlayer,
    responses: {}, openedAt: Date.now(),
    pickCharacter: !!last.pickCharacter, optionalCharacter: !!last.optionalCharacter, characterPool: last.characterPool,
    result: !!spec?.result,
  };
  state.pendingRealTurn = t;
  openNextRound(state, t);
}

/** Which selection sizes an actor may end their picks on. */
function allowedCounts(cfg: ActorPrompt): number[] {
  return cfg.counts ?? Array.from({ length: cfg.max - cfg.min + 1 }, (_, i) => cfg.min + i);
}

/** The next screen a real actor needs, or null if they are finished with this step. */
function actorScreen(t: PendingRealTurn, id: string): NightScreen | null {
  const prog = t.progress[id];
  if (prog.done) return null;
  if (t.shape === 'info') return { kind: 'info', body: t.bodyByPlayer[id] };
  if (prog.applied) return prog.result ? { kind: 'result', body: prog.result } : null;
  const cfg = t.prompts[id];
  const k = prog.targets.length;
  if (!prog.stopped && k < cfg.max) {
    return { kind: 'pick', body: t.bodyByPlayer[id], index: k, total: cfg.max, canSkip: allowedCounts(cfg).includes(k) };
  }
  // Choosing no-one at all ends the turn there (the Assassin, the Seamstress keeping her ability...).
  if (cfg.pickCharacter && !prog.characterDone && !(prog.stopped && k === 0 && cfg.max > 0)) {
    return { kind: 'character', body: t.bodyByPlayer[id], canSkip: !!cfg.optionalCharacter };
  }
  return null; // choosing is over: the ability applies at the end of this round
}

/**
 * Opens the step's next round: every actor who still has something to do gets that screen, everyone
 * else a tip. When no actor has anything left, the step is over and the night moves on.
 */
function openNextRound(state: GameState, t: PendingRealTurn): void {
  // Abilities take effect as soon as their last pick is in (in the step's actor order).
  for (const id of t.playerIds) {
    const prog = t.progress[id];
    if (t.shape !== 'choose' || prog.applied || actorScreen(t, id)) continue;
    const self = findPlayer(state, id);
    const before = self.nightResult;
    applyRealChoice(state, t.charId, id, prog.targets, prog.character);
    prog.applied = true;
    prog.result = t.result && self.nightResult && self.nightResult !== before ? self.nightResult : null;
    if (state.winner) {
      // The kill that was just applied ended the game: no more screens.
      state.pendingRealTurn = null;
      return;
    }
  }
  const screens: Record<string, NightScreen> = {};
  let anyReal = false;
  for (const id of t.participantIds) {
    const s = t.playerIds.includes(id) ? actorScreen(t, id) : null;
    if (s) anyReal = true;
    screens[id] = s ?? { kind: 'tip' };
  }
  if (!anyReal) {
    advanceNightSlot(state);
    return;
  }
  t.round += 1;
  t.screens = screens;
  t.responses = {};
  t.openedAt = Date.now();
}

/** Everyone has answered this round: record each actor's answer, apply finished choices, open the next round. */
function closeRound(state: GameState, t: PendingRealTurn): void {
  for (const id of t.playerIds) {
    const screen = t.screens[id];
    const prog = t.progress[id];
    const answer = t.responses[id] ?? [];
    if (screen.kind === 'info' || screen.kind === 'result') prog.done = true;
    else if (screen.kind === 'pick') {
      if (answer.length === 0) prog.stopped = true;
      else prog.targets.push(answer[0]);
    } else if (screen.kind === 'character') {
      prog.characterDone = true;
      if (answer[0]) prog.character = answer[0]; // a character screen's answer is [character], or [] for "No one"
    }
  }
  openNextRound(state, t);
}

export function beginNight(state: GameState): void {
  state.phase = 'night';
  state.night += 1;
  record(state, 'nightStart');
  state.deathsTonight = [];
  state.data.monkProtectedId = null;
  state.nightSlotIndex = -1;
  state.pendingRealTurn = null;
  state.currentNomination = null; // a day that ended mid-nomination (a Mutant's execution) leaves nothing half-voted
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
    startStep(state, step, actors);
    return;
  }
  // Everyone has acted: day comes now — unless the night is still shorter than MIN_NIGHT_MS, in
  // which case tick() breaks dawn once it has lasted that long.
  state.pendingRealTurn = null;
  const now = Date.now();
  state.dawnAt = Math.max(now, (state.nightStartedAt ?? now) + MIN_NIGHT_MS);
  if (now >= state.dawnAt) finishNight(state);
}

function finishNight(state: GameState): void {
  state.pendingRealTurn = null;
  state.dawnAt = null;
  state.phase = 'day';
  state.day += 1;
  state.effects = state.effects.filter((e) => !e.untilDawn);
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
  if (t && roundComplete(state, t)) closeRound(state, t);
}

/** A round is over once every real actor has answered, and every tip too — except a tip on the phone
 * of someone who has lost connection: a real screen is always waited for, a tip never blocks. */
function roundComplete(state: GameState, t: PendingRealTurn): boolean {
  return t.participantIds.every((id) => {
    if (id in t.responses) return true;
    if (t.screens[id]?.kind !== 'tip') return false;
    return !state.players.find((p) => p.id === id)?.connected;
  });
}

/** Why `targetId` may not be this actor's next pick (the rules of the ability, plus: not someone already picked) — null if they may. */
function pickRefusal(state: GameState, t: PendingRealTurn, actorId: string, targetId: string): string | null {
  const self = state.players.find((p) => p.id === actorId);
  const target = state.players.find((p) => p.id === targetId);
  if (!self || !target) return 'Invalid target';
  const spec = specOf(t.charId);
  if (spec?.notSelf && targetId === actorId) return 'Cannot choose yourself';
  if (t.progress[actorId]?.targets.includes(targetId)) return 'Cannot choose the same player twice';
  // "If you get to choose 'any player' at night, you can choose yourself or a dead player" — unless the ability says otherwise.
  const eligible = spec?.prompt?.(state, self).eligible;
  return !eligible || eligible(state, self, target) ? null : 'You cannot choose that player';
}

/** Whether `targetId` may be this actor's next pick. */
export function canPick(state: GameState, t: PendingRealTurn, actorId: string, targetId: string): boolean {
  return pickRefusal(state, t, actorId, targetId) === null;
}

/** The characters this actor may name on a character screen. */
export function characterChoices(state: GameState, t: PendingRealTurn, actorId: string): CharacterId[] {
  return t.prompts[actorId]?.characterPool ?? state.scriptChars;
}

/**
 * A player's tap on their current night screen: one pick (`[playerId]`, or `[]` for "No one"), one
 * character, or "Got it" (info, result, tip). The protocol is the same for every kind, so the
 * server alone knows whose tap was real. `now` is the server clock: when given, a tap sooner than
 * MIN_ANSWER_MS after the round opened is refused.
 */
export function submitRealResponse(state: GameState, playerId: string, targetIds: string[], now?: number, character?: string): void {
  const t = state.pendingRealTurn;
  if (!t || !t.participantIds.includes(playerId)) throw new GameError('No pending night turn for this player');
  if (playerId in t.responses) throw new GameError('Already responded');
  if (now !== undefined && now < t.openedAt + MIN_ANSWER_MS) throw new GameError('Too early — take a few seconds');
  const screen = t.screens[playerId];
  let answer: string[] = [];
  if (screen.kind === 'pick') {
    if (targetIds.length > 1) throw new GameError('Choose one player at a time');
    if (targetIds.length === 0 && !screen.canSkip) throw new GameError('Choose a player');
    const refusal = targetIds.length === 1 ? pickRefusal(state, t, playerId, targetIds[0]) : null;
    if (refusal) throw new GameError(refusal);
    answer = targetIds.slice();
  } else if (screen.kind === 'character') {
    if (!character && !screen.canSkip) throw new GameError('Choose a character');
    if (character && (!CHARACTERS[character] || !characterChoices(state, t, playerId).includes(character))) throw new GameError('Choose a valid character');
    answer = character ? [character] : [];
  }
  // (An info, result or tip screen is just "Got it": whatever else was sent is ignored.)
  t.responses[playerId] = answer;
  maybeAdvance(state);
}

/** Night upkeep, once a second: a step whose only missing answers are decoys of disconnected
 * players moves on, and dawn breaks once its time has come. Nobody's real turn ever times out. */
export function tick(state: GameState, now: number): void {
  if (state.phase !== 'night' || state.winner) return;
  if (state.pendingRealTurn) maybeAdvance(state);
  if (state.dawnAt != null && now >= state.dawnAt) finishNight(state);
}
