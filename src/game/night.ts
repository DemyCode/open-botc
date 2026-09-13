import { CHARACTERS } from './characters.js';
import {
  chefInfo, demonInfo, empathInfo, fortuneTellerInfo, investigativeInfo,
  minionInfo, ravenkeeperInfo, spyInfo, undertakerInfo,
} from './info.js';
import { abilityWorks } from './registration.js';
import { stablePick } from './rng.js';
import type { CharacterId, GameState, NightTurnShape, PendingRealTurn, PlayerState } from './types.js';
import { GameError } from './types.js';

export const FIRST_NIGHT_SEQUENCE: (CharacterId | 'minion-info')[] = [
  'minion-info', 'imp', 'poisoner', 'washerwoman', 'librarian', 'investigator',
  'chef', 'empath', 'fortuneteller', 'butler', 'spy',
];

export const OTHER_NIGHT_SEQUENCE: (CharacterId | 'minion-info')[] = [
  'poisoner', 'monk', 'imp', 'ravenkeeper', 'butler', 'empath', 'fortuneteller', 'undertaker', 'spy',
];

const DECOY_QUESTIONS = [
  'Who is the funniest?',
  'Who is the sexiest?',
  'Who is the dumbest?',
  'Who would survive a zombie apocalypse the longest?',
  'Who has the best poker face?',
  'Who is most likely to accidentally reveal a secret?',
  'Who would you trust to keep a secret?',
  'Who is the sleepiest right now?',
  'Who talks the most during the day?',
  'Who would make the best Storyteller?',
  'Who is the most stylish?',
  'Who is the most suspicious right now?',
];

const TURN_TIMEOUT_MS = 60_000;

export function appendLog(state: GameState, playerId: string, text: string): void {
  const p = state.players.find((pl) => pl.id === playerId);
  if (p) p.log.push({ night: state.night, text });
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

function computeInfoText(state: GameState, self: PlayerState, charId: CharacterId | 'minion-info', slot: string): string {
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
    default: return '';
  }
}

function choosePromptFor(charId: CharacterId | 'minion-info'): { min: number; max: number; body: string } {
  switch (charId) {
    case 'poisoner': return { min: 1, max: 1, body: 'Choose a player to poison.' };
    case 'monk': return { min: 1, max: 1, body: 'Choose a player to protect (not yourself).' };
    case 'fortuneteller': return { min: 2, max: 2, body: 'Choose 2 players to check for the Demon.' };
    case 'butler': return { min: 1, max: 1, body: 'Choose a player to be your master (not yourself).' };
    case 'ravenkeeper': return { min: 1, max: 1, body: 'You died! Choose a player to learn their character.' };
    case 'imp': return { min: 1, max: 1, body: 'Choose a player to kill.' };
    default: return { min: 0, max: 0, body: '' };
  }
}

function pickDecoyQuestion(state: GameState, slot: string) {
  const question = stablePick(state.secret, DECOY_QUESTIONS, slot, 'decoy-q');
  return { id: slot, question };
}

function startRound(state: GameState, charId: CharacterId | 'minion-info', actors: PlayerState[]): void {
  const slot = `${charId}-n${state.night}`;
  const shape = shapeFor(state, charId);
  const bodyByPlayer: Record<string, string> = {};
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

  const now = Date.now();
  state.pendingRealTurn = {
    charId, playerIds: actors.map((p) => p.id), shape, min, max, bodyByPlayer,
    responses: {}, deadline: now + TURN_TIMEOUT_MS,
  };

  const actorIds = new Set(actors.map((p) => p.id));
  const others = state.players.filter((p) => p.alive && !actorIds.has(p.id));
  state.pendingDecoy = others.length
    ? { prompt: pickDecoyQuestion(state, slot), playerIds: others.map((p) => p.id), responses: {}, deadline: now + TURN_TIMEOUT_MS }
    : null;
}

export function beginNight(state: GameState): void {
  state.phase = 'night';
  state.night += 1;
  state.deathsTonight = [];
  state.monkProtectedId = null;
  state.nightSlotIndex = -1;
  state.pendingRealTurn = null;
  state.pendingDecoy = null;
  advanceNightSlot(state);
}

export function advanceNightSlot(state: GameState): void {
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
  state.pendingDecoy = null;
  state.phase = 'day';
  state.day += 1;
  state.onBlockId = null;
  state.highestYesToday = 0;
  state.usedNominatorIds = [];
  state.usedNomineeIds = [];
  state.currentNomination = null;
  for (const id of state.deathsTonight) {
    const p = state.players.find((pl) => pl.id === id);
    if (p) state.publicLog.push(`${p.name} was found dead this morning.`);
  }
  if (state.deathsTonight.length === 0 && state.night > 1) {
    state.publicLog.push('Nobody died last night.');
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
    const otherMinions = state.players.filter((p) => p.alive && CHARACTERS[p.character].team === 'minion' && p.id !== imp.id);
    if (otherMinions.length) {
      const promoted = otherMinions[Math.floor(Math.random() * otherMinions.length)];
      promoted.character = 'imp';
      promoted.perceived = 'imp';
      appendLog(state, promoted.id, `You are now the Imp. ${demonInfo(state, promoted)}`);
    }
    return;
  }

  if (isProtected(state, target)) return;

  if (target.character === 'mayor' && abilityWorks(state, target)) {
    const alt = state.players.find((p) => p.alive && p.id !== target.id && p.id !== imp.id && !isProtected(state, p));
    killPlayer(state, alt ?? target);
    return;
  }

  killPlayer(state, target);
}

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
    case 'fortuneteller':
      appendLog(state, playerId, fortuneTellerInfo(state, self, targets, slot));
      break;
    case 'ravenkeeper':
      appendLog(state, playerId, ravenkeeperInfo(state, self, targets[0], slot));
      break;
    case 'imp':
      applyImpKill(state, self, targets[0]);
      break;
    default:
      break;
  }
}

function tallySuperlative(state: GameState, question: string, targetId: string): void {
  if (!targetId) return;
  if (!state.superlativeTally[question]) state.superlativeTally[question] = {};
  state.superlativeTally[question][targetId] = (state.superlativeTally[question][targetId] ?? 0) + 1;
}

function maybeAdvance(state: GameState): void {
  const t = state.pendingRealTurn;
  const d = state.pendingDecoy;
  const realDone = !t || t.playerIds.every((id) => id in t.responses);
  const decoyDone = !d || d.playerIds.every((id) => id in d.responses);
  if (realDone && decoyDone) advanceNightSlot(state);
}

export function submitRealResponse(state: GameState, playerId: string, targetIds: string[]): void {
  const t = state.pendingRealTurn;
  if (!t || !t.playerIds.includes(playerId)) throw new GameError('No pending real turn for this player');
  if (playerId in t.responses) throw new GameError('Already responded');
  if (t.shape === 'choose') {
    if (targetIds.length < t.min || targetIds.length > t.max) throw new GameError('Invalid selection count');
    const alive = new Set(state.players.filter((p) => p.alive).map((p) => p.id));
    for (const id of targetIds) if (!alive.has(id) && id !== playerId) throw new GameError('Invalid target');
    if ((t.charId === 'monk' || t.charId === 'butler') && targetIds.includes(playerId)) {
      throw new GameError('Cannot choose yourself');
    }
  }
  t.responses[playerId] = targetIds;
  applyRealChoice(state, t.charId, playerId, targetIds);
  maybeAdvance(state);
}

export function submitDecoyResponse(state: GameState, playerId: string, targetId: string): void {
  const d = state.pendingDecoy;
  if (!d || !d.playerIds.includes(playerId)) throw new GameError('No pending decoy for this player');
  if (playerId in d.responses) throw new GameError('Already responded');
  d.responses[playerId] = targetId;
  tallySuperlative(state, d.prompt.question, targetId);
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
  const d = state.pendingDecoy;
  if (d && now >= d.deadline) {
    for (const id of d.playerIds) {
      if (!(id in d.responses)) d.responses[id] = '';
    }
  }
  maybeAdvance(state);
}
