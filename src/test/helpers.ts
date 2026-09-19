import { ALL_CHARACTER_IDS, CHARACTERS, alignmentOfCharacter } from '../game/characters.js';
import { addPlayer, castVote, createGame, markReadyForSpeech, skipSpeech, toggleEndDayRequest } from '../game/engine.js';
import { beginNight, submitRealResponse, tick as nightTick } from '../game/night.js';
import { viewFor } from '../game/view.js';
import type { CharacterId, GameState } from '../game/types.js';

export function mk(charIds: CharacterId[], opts: { drunkFakeChar?: CharacterId } = {}): GameState {
  const state = createGame('TEST');
  // The script is Trouble Brewing plus the whole edition of any character from another one.
  const editions = new Set(['tb', ...charIds.map((c) => CHARACTERS[c].edition)]);
  state.scriptChars = ALL_CHARACTER_IDS.filter((c) => editions.has(CHARACTERS[c].edition));
  for (let i = 0; i < charIds.length; i++) addPlayer(state, `P${i}`);
  state.players.forEach((p, i) => {
    const cid = charIds[i];
    p.character = cid;
    p.perceived = cid === 'drunk' && opts.drunkFakeChar ? opts.drunkFakeChar : cid;
    p.alignment = alignmentOfCharacter(cid);
  });
  return state;
}

export function mkDay(charIds: CharacterId[]): GameState {
  const state = mk(charIds);
  state.phase = 'day';
  state.day = 1;
  state.night = 1; // day 1 follows night 1, so the next night is an "other night"
  return state;
}

export function byChar(state: GameState, charId: CharacterId) {
  const p = state.players.find((pl) => pl.character === charId);
  if (!p) throw new Error(`No player with true character ${charId}`);
  return p;
}

export function byPerceived(state: GameState, charId: CharacterId) {
  const p = state.players.find((pl) => pl.perceived === charId);
  if (!p) throw new Error(`No player perceiving ${charId}`);
  return p;
}

export function startNight(state: GameState): void {
  beginNight(state);
}

/** Answers every still-open decoy question of the current night step with something valid. */
export function answerDecoys(state: GameState): void {
  const t = state.pendingRealTurn;
  if (!t) return;
  for (const id of t.participantIds.slice()) {
    if (t.playerIds.includes(id) || id in t.responses || state.pendingRealTurn !== t) continue;
    submitRealResponse(state, id, t.shape === 'choose' ? state.players.slice(0, t.min).map((p) => p.id) : []);
  }
}

/** Answers the current night step: every real actor with `targetIds`, everyone else's decoy with anything. */
export function answerRealTurn(state: GameState, targetIds: string[] = [], character?: string): void {
  const t = state.pendingRealTurn;
  if (!t) throw new Error('No pending real turn');
  for (const id of t.playerIds) {
    if (!(id in t.responses)) submitRealResponse(state, id, targetIds, undefined, character);
  }
  answerDecoys(state);
}

/** Skips the wait between the last night action and dawn (see DAWN_WAIT_* in night.ts). */
export function breakDawn(state: GameState): void {
  if (state.phase === 'night' && state.dawnAt != null) nightTick(state, state.dawnAt);
}

/** Some players the ability may choose, other than the actor themself (preferring the living). */
function pickable(state: GameState, actor: string, count: number): string[] {
  const choices = viewFor(state, actor).nightTurn?.choices ?? [];
  const ok = choices.filter((c) => !c.disabled && c.id !== actor);
  return [...ok.filter((c) => c.alive), ...ok.filter((c) => !c.alive)].slice(0, count).map((c) => c.id);
}

/** Resolves the current round with arbitrary-but-valid answers, for rounds the test doesn't care
 * about — or, once everyone has acted, lets dawn break. */
export function skipRound(state: GameState): void {
  const t = state.pendingRealTurn;
  if (!t) {
    breakDawn(state);
    return;
  }
  for (const id of t.playerIds.slice()) {
    if (id in t.responses || state.pendingRealTurn !== t) continue;
    // A skipped Poisoner poisons themselves (legal, and harmless): poisoning anyone else would
    // quietly switch off whichever ability the test is actually about.
    // A step that asks for a character (the Gambler) is skipped harmlessly with a correct guess about oneself.
    const me = state.players.find((p) => p.id === id)!;
    const targets =
      t.charId === 'poisoner'
        ? [id]
        : t.pickCharacter && t.min > 0
          ? [id]
          : t.shape === 'choose'
            ? pickable(state, id, t.min)
            : [];
    // A step that asks for a character: pick a legal one from the screen (a Pit-Hag may only name a
    // character not in play, a Cerenovus only a good one), falling back to the actor's own.
    let character: string | undefined;
    if (t.pickCharacter && t.min > 0) {
      const pool = viewFor(state, id).nightTurn?.characters.map((c) => c.id) ?? [];
      character = pool.length ? pool[0] : me.character;
    }
    submitRealResponse(state, id, targets, undefined, character);
  }
  answerDecoys(state);
}

/** Fast-forwards the night until the pending real turn matches `charId`, throwing if it's never reached. */
export function advanceUntil(state: GameState, charId: CharacterId | 'minion-info', maxSteps = 30): void {
  let steps = 0;
  while (state.phase === 'night' && (!state.pendingRealTurn || state.pendingRealTurn.charId !== charId) && steps < maxSteps) {
    skipRound(state);
    steps++;
  }
  if (state.phase !== 'night' || !state.pendingRealTurn || state.pendingRealTurn.charId !== charId) {
    throw new Error(`Could not reach round for ${charId}`);
  }
}

export function runFullNight(state: GameState, maxSteps = 30): void {
  let steps = 0;
  while (state.phase === 'night' && steps < maxSteps) {
    skipRound(state);
    steps++;
  }
}

/** Marks every player (living or dead — the ready gate is for everyone) ready for the current speech. */
export function markAllReady(state: GameState): void {
  const nom = state.currentNomination;
  if (!nom) throw new Error('No nomination in progress');
  for (const p of state.players) {
    if (!nom.readyBy.includes(p.id)) markReadyForSpeech(state, p.id);
  }
}

/** Skips straight past both ready-gates and the accusing/defending speeches (as the actual accuser/accused) to the sequential vote. */
export function fastForwardToVote(state: GameState): void {
  const nom = state.currentNomination;
  if (!nom) throw new Error('No nomination in progress');
  markAllReady(state);
  skipSpeech(state, nom.nominatorId);
  skipSpeech(state, nom.nomineeId);
}

/** Casts votes in the official going-around order until the nomination resolves, voting yes for `yesIds`. */
export function voteInOrder(state: GameState, yesIds: string[]): void {
  let steps = 0;
  while (state.currentNomination && state.currentNomination.state === 'voting' && steps < 100) {
    const voterId = state.currentNomination.currentVoterId!;
    castVote(state, voterId, yesIds.includes(voterId));
    steps++;
  }
}

/** Has every living player agree to end the day, which ends it once the last one does. */
export function endDayByConsensus(state: GameState): void {
  for (const p of state.players.filter((pl) => pl.alive)) {
    toggleEndDayRequest(state, p.id);
  }
}

/** Poisons `targetId` as a living Poisoner at the table would (until the Poisoner dies or stops being one). */
export function poison(state: GameState, targetId: string): void {
  const poisoner = state.players.find((p) => p.alive && p.character === 'poisoner');
  const target = state.players.find((p) => p.id === targetId);
  if (!target) throw new Error('no such player');
  if (!poisoner) throw new Error('poison(): seat a living Poisoner first — poison only lasts while one lives');
  state.effects.push({ kind: 'poisoned', target: target.id, source: poisoner.id, sourceChar: 'poisoner', untilNight: null, needsSourceAlive: true, needsSourceChar: 'poisoner' });
}

/** Whom the Poisoner's poison currently targets (whether or not it is working), or null. */
export function poisonedId(state: GameState): string | null {
  return state.effects.find((e) => e.kind === 'poisoned' && e.sourceChar === 'poisoner')?.target ?? null;
}
