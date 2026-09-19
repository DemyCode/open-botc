// Shared helpers for turning the official wiki "Examples" sections into tests.
import assert from 'node:assert/strict';
import { nominate } from '../game/engine.js';
import type { CharacterId, GameState, PlayerState } from '../game/types.js';
import {
  answerRealTurn, breakDawn, byChar, endDayByConsensus, fastForwardToVote, mk as baseMk, mkDay as baseMkDay,
  runFullNight, skipRound, startNight, voteInOrder,
} from './helpers.js';

/**
 * Player ids are random, and the engine's Storyteller choices (who a Spy registers as, what a
 * drunk Empath is told...) are seeded partly by them. Pinning the ids makes "this secret gives
 * this outcome" reproducible from one game to the next.
 */
export function pin<T extends GameState>(s: T): T {
  s.players.forEach((p, i) => { p.id = `pid-${i}`; });
  return s;
}
export const mk = (chars: CharacterId[], opts: Parameters<typeof baseMk>[1] = {}): GameState => pin(baseMk(chars, opts));
export const mkDay = (chars: CharacterId[]): GameState => pin(baseMkDay(chars));

/** Gives the players the names used in the wiki example (in seat order). */
export function named<T extends GameState>(s: T, names: string[]): T {
  names.forEach((n, i) => { if (s.players[i]) s.players[i].name = n; });
  return s;
}

/** Tries game secrets until `attempt` says this Storyteller made the choice the example describes. */
export function findSecret(attempt: (secret: string) => boolean, what: string, tries = 3000): string {
  for (let i = 0; i < tries; i++) {
    const secret = `wiki-${i}`;
    if (attempt(secret)) return secret;
  }
  assert.fail(`no secret in ${tries} tries produced: ${what}`);
}

/** A game whose night 1 has been played out harmlessly (Poisoners poison themselves, etc.). */
export function afterNight1(layout: CharacterId[], opts: Parameters<typeof mk>[1] = {}): GameState {
  const s = mk(layout, opts);
  startNight(s);
  runFullNight(s);
  return s;
}

export type Pick = CharacterId | PlayerState;
export type Picks = Partial<Record<CharacterId, Pick[]>>;
export const idOf = (s: GameState, x: Pick): string => (typeof x === 'string' ? byChar(s, x).id : x.id);

/** Plays the night that is in progress: named steps answered with the named characters, others skipped. */
export function playSteps(s: GameState, picks: Picks, character?: string): void {
  let guard = 0;
  while (s.pendingRealTurn && guard++ < 60) {
    const p = picks[s.pendingRealTurn.charId as CharacterId];
    if (p) answerRealTurn(s, p.map((c) => idOf(s, c)), character);
    else skipRound(s);
  }
  breakDawn(s);
}

/**
 * Plays the night that is in progress up to (not including) the answer of step `until`, answering
 * the Imp with `impTarget` so nobody the example cares about is killed on the way.
 */
export function untilStep(s: GameState, until: CharacterId, impTarget: CharacterId): void {
  let guard = 0;
  while (s.pendingRealTurn && s.pendingRealTurn.charId !== until && guard++ < 60) {
    const c = s.pendingRealTurn.charId;
    if (c === 'imp') answerRealTurn(s, [byChar(s, impTarget).id]);
    else skipRound(s);
  }
  assert.equal(s.pendingRealTurn?.charId, until, `the ${until} step is reached`);
}

/** Starts the next night and plays it. */
export function night(s: GameState, picks: Picks, character?: string): void {
  startNight(s);
  playSteps(s, picks, character);
}

/** Everyone votes yes on `nominee` (nominated by `nominator`), then the day ends: an execution. */
export function execute(s: GameState, nominator: PlayerState, nominee: PlayerState): void {
  nominate(s, nominator.id, nominee.id);
  if (!s.currentNomination) return;
  fastForwardToVote(s);
  voteInOrder(s, s.players.map((p) => p.id));
  endDayByConsensus(s);
}

export const lastInfo = (p: PlayerState) => p.log.at(-1)!.msg;
export const others = (s: GameState, self: PlayerState) => s.players.filter((p) => p.id !== self.id);
export const pairOf = (m: { vars?: Record<string, unknown> }) => [m.vars!.a, m.vars!.b].sort();
