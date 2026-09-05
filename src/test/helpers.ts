import { CHARACTERS, teamAlignment, type CharacterId } from '../game/characters.js';
import {
  addPlayer,
  beginNight,
  createGame,
  requestEndDay,
  submitNightChoice,
  tick,
} from '../game/engine.js';
import { alivePlayers, playerById, type GameState, type RoomOptions } from '../game/types.js';

/** Monotonic fake clock so timeouts are deterministic in tests. */
export class Clock {
  now = 1_700_000_000_000;
  advance(ms: number): number {
    this.now += ms;
    return this.now;
  }
}

export interface TestGame {
  s: GameState;
  clock: Clock;
}

/**
 * Build a game with exactly these characters, in seat order, skipping the deal.
 * Misregistration is switched off by default so assertions are deterministic.
 */
export function mk(chars: CharacterId[], opts?: Partial<RoomOptions>): TestGame {
  const s = createGame('TEST', {
    recluseMisregisterChance: 0,
    spyMisregisterChance: 0,
    mayorBounceChance: 0,
    revealSeconds: 1,
    dawnSeconds: 1,
    nightPromptSeconds: 60,
    speechSeconds: 1,
    voteSeconds: 1,
    ...opts,
  });
  chars.forEach((c, i) => {
    const p = addPlayer(s, `P${i}`);
    p.character = c;
    p.perceived = c;
    p.alignment = teamAlignment(CHARACTERS[c].team);
  });
  s.hostId = s.players[0].id;
  s.demonBluffs = ['chef', 'empath', 'soldier'];
  // Pin the RNG and the misregistration salt so tests never flake.
  s.rng = 0x5eed1234;
  s.secret = 'test-secret';
  return { s, clock: new Clock() };
}

export function seat(s: GameState, i: number) {
  const p = s.players.find((x) => x.seat === i);
  if (!p) throw new Error(`no player at seat ${i}`);
  return p;
}

/** First player holding this character (real, not perceived). */
export function byChar(s: GameState, c: CharacterId) {
  const p = s.players.find((x) => x.character === c);
  if (!p) throw new Error(`no ${c} in this game`);
  return p;
}

export function byPerceived(s: GameState, c: CharacterId) {
  const p = s.players.find((x) => x.perceived === c);
  if (!p) throw new Error(`nobody thinks they are ${c}`);
  return p;
}

export type ChoiceMap = Partial<
  Record<CharacterId, (s: GameState, self: ReturnType<typeof seat>) => string[]>
>;

/** Answer every night prompt, using `choices` where given and a default otherwise. */
export function answerNight(g: TestGame, choices: ChoiceMap = {}): void {
  let guard = 0;
  while (g.s.pending && guard++ < 200) {
    const pending = g.s.pending;
    const self = playerById(g.s, pending.playerId)!;
    const fn = pending.character ? choices[pending.character] : undefined;
    const targets = fn
      ? fn(g.s, self)
      : pending.choices
          .filter((c) => !c.disabled)
          .slice(0, pending.count)
          .map((c) => c.playerId);
    submitNightChoice(g.s, self.id, pending.id, targets, g.clock.advance(100));
  }
  if (guard >= 200) throw new Error('night did not terminate');
}

/** Run a whole night: open it, answer every prompt, land on dawn. */
export function runNight(g: TestGame, choices: ChoiceMap = {}): void {
  beginNight(g.s, g.clock.advance(1000));
  answerNight(g, choices);
}

/** Push through dawn into free discussion. */
export function toDay(g: TestGame): void {
  let guard = 0;
  while (g.s.phase === 'dawn' && guard++ < 10) {
    tick(g.s, g.clock.advance(60_000));
  }
}

/** Every living player asks to end the day. */
export function endDay(g: TestGame): void {
  for (const p of alivePlayers(g.s).slice()) {
    if (g.s.phase !== 'day' && g.s.phase !== 'nominations') break;
    requestEndDay(g.s, p.id, g.clock.advance(100));
  }
}

/** Advance out of dusk into the next night. */
export function toNight(g: TestGame): void {
  let guard = 0;
  while (g.s.phase === 'dusk' && guard++ < 10) {
    tick(g.s, g.clock.advance(60_000));
  }
}

/** The public log as one string, for loose assertions. */
export function logText(s: GameState): string {
  return s.log.map((l) => l.text).join('\n');
}

/** All private info bodies a player has received. */
export function infoText(s: GameState, playerId: string): string {
  return playerById(s, playerId)!.log.map((e) => `${e.title}: ${e.body}`).join('\n');
}
