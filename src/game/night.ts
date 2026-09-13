import { CHARACTERS } from './characters.js';
import {
  chefInfo, demonInfo, empathInfo, fortuneTellerInfo, investigativeInfo,
  minionInfo, ravenkeeperInfo, spyInfo, undertakerInfo,
} from './info.js';
import { abilityWorks } from './registration.js';
import type { CharacterId, GameState, Msg, NightTurnShape, PendingRealTurn, PlayerState } from './types.js';
import { GameError } from './types.js';

function msg(key: string, vars?: Record<string, string | number | string[]>): Msg {
  return vars ? { key, vars } : { key };
}

/**
 * Characters whose choose-shape ability may legally target a dead player: the Fortune Teller can
 * check a corpse, the Ravenkeeper (who is themselves dead when they act) can learn a dead
 * player's character, and the Butler may pick a dead master. Poisoner/Monk/Imp are kept
 * alive-only — targeting a corpse would be a legal no-op in the physical game, but offering it
 * as a choice here would only ever confuse a player since it can never do anything.
 */
export const DEAD_TARGETS_ALLOWED: Partial<Record<CharacterId, true>> = {
  fortuneteller: true,
  ravenkeeper: true,
  butler: true,
};

/** Sets the game's winner exactly once — later calls (e.g. a second condition firing the same
 * tick) are no-ops so the first true result always stands. */
export function setWinner(state: GameState, alignment: 'good' | 'evil', message: Msg): void {
  if (state.winner) return;
  state.winner = alignment;
  state.phase = 'ended';
  state.publicLog.push(message);
}

/** The two win conditions that can become true at any moment, not just after a day action —
 * a night kill can just as easily leave no living Demon (a failed star-pass) or drop the alive
 * count to 2, and both must end the game immediately, the instant they happen. */
export function evaluateWin(state: GameState): void {
  if (state.winner) return;
  const alive = state.players.filter((p) => p.alive);
  const demonAlive = alive.some((p) => CHARACTERS[p.character].team === 'demon');
  if (!demonAlive) {
    setWinner(state, 'good', msg('goodWinsDemonDead'));
    return;
  }
  if (alive.length <= 2) {
    setWinner(state, 'evil', msg('evilWinsTwoLeft'));
  }
}

/**
 * If the player who just died was the Demon, and the Scarlet Woman is alive, able, and there
 * are still 5+ players alive, she becomes the new Demon — learning her minions and bluffs just
 * like any demon would. Returns whether she was promoted, so a caller with its own
 * demon-replacement fallback (the Imp's own star-pass) knows to skip it: the Scarlet Woman's
 * passive trigger takes priority over a random minion becoming the Imp, it doesn't compete
 * with it — only one of them ever fires.
 */
export function promoteScarletWomanIfEligible(state: GameState, deadPlayer: PlayerState | null): boolean {
  if (!deadPlayer || CHARACTERS[deadPlayer.character].team !== 'demon') return false;
  const aliveCount = state.players.filter((p) => p.alive).length;
  const sw = state.players.find((p) => p.alive && p.character === 'scarletwoman');
  if (sw && aliveCount >= 5 && abilityWorks(state, sw)) {
    sw.character = 'imp';
    sw.perceived = 'imp';
    appendLog(state, sw.id, msg('scarletWomanPromoted'));
    appendLog(state, sw.id, demonInfo(state, sw));
    return true;
  }
  return false;
}

export const FIRST_NIGHT_SEQUENCE: (CharacterId | 'minion-info')[] = [
  'minion-info', 'imp', 'poisoner', 'washerwoman', 'librarian', 'investigator',
  'chef', 'empath', 'fortuneteller', 'butler', 'spy',
];

export const OTHER_NIGHT_SEQUENCE: (CharacterId | 'minion-info')[] = [
  'poisoner', 'monk', 'imp', 'ravenkeeper', 'butler', 'empath', 'fortuneteller', 'undertaker', 'spy',
];

const TURN_TIMEOUT_MS = 60_000;

export function appendLog(state: GameState, playerId: string, m: Msg): void {
  const p = state.players.find((pl) => pl.id === playerId);
  if (p) p.log.push({ night: state.night, msg: m });
}

function findPlayer(state: GameState, id: string): PlayerState {
  const p = state.players.find((pl) => pl.id === id);
  if (!p) throw new GameError(`Unknown player ${id}`);
  return p;
}

function sequenceFor(state: GameState): (CharacterId | 'minion-info')[] {
  return state.night === 1 ? FIRST_NIGHT_SEQUENCE : OTHER_NIGHT_SEQUENCE;
}

function actorsFor(state: GameState, charId: CharacterId | 'minion-info'): PlayerState[] {
  if (charId === 'minion-info') {
    return state.players.filter((p) => p.alive && CHARACTERS[p.character].team === 'minion');
  }
  if (charId === 'ravenkeeper') {
    return state.players.filter((p) => !p.alive && state.deathsTonight.includes(p.id) && p.perceived === 'ravenkeeper');
  }
  return state.players.filter((p) => p.alive && p.perceived === charId);
}

function shapeFor(state: GameState, charId: CharacterId | 'minion-info'): NightTurnShape {
  if (charId === 'minion-info') return 'info';
  if (charId === 'imp' && state.night === 1) return 'info';
  return CHARACTERS[charId].shape;
}

function computeInfoText(state: GameState, self: PlayerState, charId: CharacterId | 'minion-info', slot: string): Msg {
  switch (charId) {
    case 'washerwoman': return investigativeInfo(state, self, 'townsfolk', slot);
    case 'librarian': return investigativeInfo(state, self, 'outsider', slot);
    case 'investigator': return investigativeInfo(state, self, 'minion', slot);
    case 'chef': return chefInfo(state, self, slot);
    case 'empath': return empathInfo(state, self, slot);
    case 'undertaker': {
      const executed = state.lastExecutedId ? state.players.find((p) => p.id === state.lastExecutedId) ?? null : null;
      return undertakerInfo(state, self, executed, slot);
    }
    case 'minion-info': return minionInfo(state, self);
    case 'imp': return demonInfo(state, self);
    case 'spy': return spyInfo(state, self, slot);
    default: return msg('empty');
  }
}

function choosePromptFor(charId: CharacterId | 'minion-info'): { min: number; max: number; body: Msg } {
  switch (charId) {
    case 'poisoner': return { min: 1, max: 1, body: msg('poisonerChoose') };
    case 'monk': return { min: 1, max: 1, body: msg('monkChoose') };
    case 'fortuneteller': return { min: 2, max: 2, body: msg('fortuneTellerChoose') };
    case 'butler': return { min: 1, max: 1, body: msg('butlerChoose') };
    case 'ravenkeeper': return { min: 1, max: 1, body: msg('ravenkeeperChoose') };
    case 'imp': return { min: 1, max: 1, body: msg('impChoose') };
    default: return { min: 0, max: 0, body: msg('empty') };
  }
}

function startRound(state: GameState, charId: CharacterId | 'minion-info', actors: PlayerState[]): void {
  const slot = `${charId}-n${state.night}`;
  const shape = shapeFor(state, charId);
  const bodyByPlayer: Record<string, Msg> = {};
  let min = 0;
  let max = 0;

  if (shape === 'info') {
    for (const p of actors) {
      const text = computeInfoText(state, p, charId, slot);
      appendLog(state, p.id, text);
      bodyByPlayer[p.id] = text;
    }
  } else {
    const cfg = choosePromptFor(charId);
    min = cfg.min;
    max = cfg.max;
    for (const p of actors) bodyByPlayer[p.id] = cfg.body;
  }

  state.pendingRealTurn = {
    charId, playerIds: actors.map((p) => p.id), shape, min, max, bodyByPlayer,
    responses: {}, deadline: Date.now() + TURN_TIMEOUT_MS,
  };
}

export function beginNight(state: GameState): void {
  state.phase = 'night';
  state.night += 1;
  state.deathsTonight = [];
  state.monkProtectedId = null;
  state.nightSlotIndex = -1;
  state.pendingRealTurn = null;
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
  const seq = sequenceFor(state);
  while (state.nightSlotIndex + 1 < seq.length) {
    state.nightSlotIndex += 1;
    const charId = seq[state.nightSlotIndex];
    if (charId === 'poisoner') state.poisonedId = null;
    if (charId === 'butler') state.butlerMasterId = null;
    const actors = actorsFor(state, charId);
    if (actors.length === 0) continue;
    startRound(state, charId, actors);
    return;
  }
  finishNight(state);
}

function finishNight(state: GameState): void {
  state.pendingRealTurn = null;
  state.phase = 'day';
  state.day += 1;
  state.onBlockId = null;
  state.highestYesToday = 0;
  state.usedNominatorIds = [];
  state.usedNomineeIds = [];
  state.currentNomination = null;
  state.endDayRequestedBy = [];
  for (const id of state.deathsTonight) {
    const p = state.players.find((pl) => pl.id === id);
    if (p) state.publicLog.push(msg('foundDead', { name: p.name }));
  }
  if (state.deathsTonight.length === 0 && state.night > 1) {
    state.publicLog.push(msg('nobodyDiedLastNight'));
  }
}

function isProtected(state: GameState, target: PlayerState): boolean {
  if (target.character === 'soldier' && abilityWorks(state, target)) return true;
  if (state.monkProtectedId === target.id) return true;
  return false;
}

function killPlayer(state: GameState, target: PlayerState): void {
  target.alive = false;
  target.diedTonight = true;
  state.deathsTonight.push(target.id);
}

function applyImpKill(state: GameState, imp: PlayerState, targetId: string): void {
  const target = state.players.find((p) => p.id === targetId);
  if (!target || !target.alive) return;

  if (targetId === imp.id) {
    if (isProtected(state, target)) return;
    killPlayer(state, target);
    // The Scarlet Woman's passive promotion takes priority over the star-pass — they don't both
    // fire. Only when she isn't in play, isn't eligible, or her ability doesn't work does the
    // star-pass fall back to promoting a random other Minion so the game still has a Demon.
    if (!promoteScarletWomanIfEligible(state, target)) {
      const otherMinions = state.players.filter((p) => p.alive && CHARACTERS[p.character].team === 'minion' && p.id !== imp.id);
      if (otherMinions.length) {
        const promoted = otherMinions[Math.floor(Math.random() * otherMinions.length)];
        promoted.character = 'imp';
        promoted.perceived = 'imp';
        appendLog(state, promoted.id, msg('becameImp'));
        appendLog(state, promoted.id, demonInfo(state, promoted));
      }
    }
    // Either a new Demon now exists, or none does at all (no other Minion was left to promote) —
    // both cases must be checked immediately, not left until the next day action.
    evaluateWin(state);
    return;
  }

  if (isProtected(state, target)) return;

  if (target.character === 'mayor' && abilityWorks(state, target)) {
    const alternatives = state.players.filter((p) => p.alive && p.id !== target.id && p.id !== imp.id && !isProtected(state, p));
    const alt = alternatives.length ? alternatives[Math.floor(Math.random() * alternatives.length)] : null;
    killPlayer(state, alt ?? target);
    evaluateWin(state);
    return;
  }

  killPlayer(state, target);
  evaluateWin(state);
}

/** Applies a choose-shape ability's effect and, for abilities that produce information from the
 * choice (Fortune Teller, Ravenkeeper), records the result so it can be shown to the player
 * immediately — not just written to their permanent log for later. */
function applyRealChoice(state: GameState, charId: CharacterId | 'minion-info', playerId: string, targets: string[]): void {
  const self = findPlayer(state, playerId);
  const slot = `${charId}-n${state.night}`;
  switch (charId) {
    case 'poisoner':
      if (abilityWorks(state, self)) state.poisonedId = targets[0] ?? null;
      break;
    case 'monk':
      if (abilityWorks(state, self)) state.monkProtectedId = targets[0] ?? null;
      break;
    case 'butler':
      if (abilityWorks(state, self)) state.butlerMasterId = targets[0] ?? null;
      break;
    case 'fortuneteller': {
      const text = fortuneTellerInfo(state, self, targets, slot);
      appendLog(state, playerId, text);
      self.nightResult = text;
      break;
    }
    case 'ravenkeeper': {
      const text = ravenkeeperInfo(state, self, targets[0], slot);
      appendLog(state, playerId, text);
      self.nightResult = text;
      break;
    }
    case 'imp':
      applyImpKill(state, self, targets[0]);
      break;
    default:
      break;
  }
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
  if (t && t.playerIds.every((id) => id in t.responses)) advanceNightSlot(state);
}

export function submitRealResponse(state: GameState, playerId: string, targetIds: string[]): void {
  const t = state.pendingRealTurn;
  if (!t || !t.playerIds.includes(playerId)) throw new GameError('No pending real turn for this player');
  if (playerId in t.responses) throw new GameError('Already responded');
  if (t.shape === 'choose') {
    if (targetIds.length < t.min || targetIds.length > t.max) throw new GameError('Invalid selection count');
    const allowDead = DEAD_TARGETS_ALLOWED[t.charId as CharacterId];
    const eligible = new Set(state.players.filter((p) => allowDead || p.alive).map((p) => p.id));
    for (const id of targetIds) if (!eligible.has(id)) throw new GameError('Invalid target');
    if ((t.charId === 'monk' || t.charId === 'butler') && targetIds.includes(playerId)) {
      throw new GameError('Cannot choose yourself');
    }
  }
  t.responses[playerId] = targetIds;
  applyRealChoice(state, t.charId, playerId, targetIds);
  maybeAdvance(state);
}

function randomTargets(state: GameState, t: PendingRealTurn): string[] {
  const pool = state.players.filter((p) => p.alive);
  const copy = pool.slice();
  const chosen: string[] = [];
  for (let i = 0; i < t.min && copy.length; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    chosen.push(copy.splice(idx, 1)[0].id);
  }
  return chosen;
}

export function tick(state: GameState, now: number): void {
  if (state.phase !== 'night') return;
  const t = state.pendingRealTurn;
  if (t && now >= t.deadline) {
    for (const id of t.playerIds) {
      if (!(id in t.responses)) {
        const fallback = t.shape === 'choose' ? randomTargets(state, t) : [];
        t.responses[id] = fallback;
        applyRealChoice(state, t.charId, id, fallback);
      }
    }
  }
  maybeAdvance(state);
}
