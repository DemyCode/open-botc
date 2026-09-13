import { alignmentOfCharacter } from '../game/characters.js';
import { addPlayer, castVote, createGame, skipSpeech } from '../game/engine.js';
import { beginNight, submitDecoyResponse, submitRealResponse } from '../game/night.js';
import type { CharacterId, GameState } from '../game/types.js';

export function mk(charIds: CharacterId[], opts: { drunkFakeChar?: CharacterId } = {}): GameState {
  const state = createGame('TEST');
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

function answerDecoys(state: GameState): void {
  const d = state.pendingDecoy;
  if (!d) return;
  const ids = d.playerIds.slice();
  for (const id of ids) {
    if (!(id in d.responses)) submitDecoyResponse(state, id, state.players[0].id);
  }
}

/** Answers the current pending real turn for every acting player with `targetIds`, then clears decoys. */
export function answerRealTurn(state: GameState, targetIds: string[] = []): void {
  const t = state.pendingRealTurn;
  if (!t) throw new Error('No pending real turn');
  for (const id of t.playerIds) {
    if (!(id in t.responses)) submitRealResponse(state, id, targetIds);
  }
  answerDecoys(state);
}

/** Resolves the current round with arbitrary-but-valid answers, for rounds the test doesn't care about. */
export function skipRound(state: GameState): void {
  const t = state.pendingRealTurn;
  if (t) {
    for (const id of t.playerIds.slice()) {
      if (id in t.responses) continue;
      const targets =
        t.shape === 'choose'
          ? state.players.filter((p) => p.alive && p.id !== id).slice(0, t.min).map((p) => p.id)
          : [];
      submitRealResponse(state, id, targets);
    }
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

/** Skips straight past the accusing/defending speeches (as the actual accuser/accused) to the sequential vote. */
export function fastForwardToVote(state: GameState): void {
  const nom = state.currentNomination;
  if (!nom) throw new Error('No nomination in progress');
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
