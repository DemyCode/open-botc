// Statements: structured things a player can say about the game (the Gossip's public statement, the
// Savant's true-and-false pair, the Artist's question). The app never judges free speech — it checks
// a statement built from menus against the real game.
import { CHARACTERS } from './characters.js';
import { registersAs } from './registration.js';
import { stableFloat, stablePick } from './rng.js';
import type { GameState, PlayerState, Team } from './types.js';
import { GameError } from './types.js';

export type Statement =
  | { t: 'alignment'; p: string; v: 'good' | 'evil' }
  | { t: 'team'; p: string; v: Team }
  | { t: 'character'; p: string; v: string }
  | { t: 'alive'; p: string; v: boolean }
  | { t: 'neighbours'; a: string; b: string }
  | { t: 'count'; what: 'alive' | 'dead' | 'evilAlive'; op: '>=' | '<=' | '='; n: number }
  | { t: 'both'; a: Statement; b: Statement }
  | { t: 'not'; s: Statement };

const TEAMS: Team[] = ['townsfolk', 'outsider', 'minion', 'demon'];
const OPS = ['>=', '<=', '='];
const WHATS = ['alive', 'dead', 'evilAlive'];

/** Checks the shape of something a client sent, throwing a readable error. Depth-limited. */
export function parseStatement(state: GameState, raw: unknown, depth = 0): Statement {
  if (typeof raw !== 'object' || raw === null || depth > 2) throw new GameError('Invalid statement');
  const s = raw as Record<string, unknown>;
  const player = (v: unknown): string => {
    if (typeof v !== 'string' || !state.players.some((p) => p.id === v)) throw new GameError('Invalid statement: unknown player');
    return v;
  };
  switch (s.t) {
    case 'alignment':
      if (s.v !== 'good' && s.v !== 'evil') break;
      return { t: 'alignment', p: player(s.p), v: s.v };
    case 'team':
      if (!TEAMS.includes(s.v as Team)) break;
      return { t: 'team', p: player(s.p), v: s.v as Team };
    case 'character':
      if (typeof s.v !== 'string' || !CHARACTERS[s.v]) break;
      return { t: 'character', p: player(s.p), v: s.v };
    case 'alive':
      if (typeof s.v !== 'boolean') break;
      return { t: 'alive', p: player(s.p), v: s.v };
    case 'neighbours':
      return { t: 'neighbours', a: player(s.a), b: player(s.b) };
    case 'count':
      if (!OPS.includes(s.op as string) || !WHATS.includes(s.what as string) || typeof s.n !== 'number' || !Number.isInteger(s.n) || s.n < 0 || s.n > 20) break;
      return { t: 'count', what: s.what as 'alive', op: s.op as '>=', n: s.n };
    case 'both':
      return { t: 'both', a: parseStatement(state, s.a, depth + 1), b: parseStatement(state, s.b, depth + 1) };
    case 'not':
      return { t: 'not', s: parseStatement(state, s.s, depth + 1) };
  }
  throw new GameError('Invalid statement');
}

const find = (state: GameState, id: string): PlayerState => state.players.find((p) => p.id === id)!;

/** Whether the statement is true right now. Registration follows the same rules as every information ability. */
export function evalStatement(state: GameState, s: Statement, ctx: { asker: string; slot: string }): boolean {
  switch (s.t) {
    case 'alignment': return registersAs(state, find(state, s.p), s.v === 'evil' ? 'evil' : 'good', ctx);
    case 'team': return registersAs(state, find(state, s.p), s.v, ctx);
    case 'character': return find(state, s.p).character === s.v;
    case 'alive': return find(state, s.p).alive === s.v;
    case 'neighbours': {
      const seated = state.players.slice().sort((x, y) => x.seat - y.seat);
      const i = seated.findIndex((p) => p.id === s.a);
      const j = seated.findIndex((p) => p.id === s.b);
      const d = Math.abs(i - j);
      return i !== j && (d === 1 || d === seated.length - 1);
    }
    case 'count': {
      const n = s.what === 'alive' ? state.players.filter((p) => p.alive).length
        : s.what === 'dead' ? state.players.filter((p) => !p.alive).length
        : state.players.filter((p) => p.alive && registersAs(state, p, 'evil', ctx)).length;
      return s.op === '>=' ? n >= s.n : s.op === '<=' ? n <= s.n : n === s.n;
    }
    case 'both': return evalStatement(state, s.a, ctx) && evalStatement(state, s.b, ctx);
    case 'not': return !evalStatement(state, s.s, ctx);
  }
}

/** A statement in a message: player ids replaced by names (it is public), as JSON. */
export function statementForMessage(state: GameState, s: Statement): string {
  const name = (id: string) => find(state, id).name;
  const walk = (x: Statement): unknown => {
    switch (x.t) {
      case 'alignment': case 'team': case 'character': case 'alive': return { ...x, p: name(x.p) };
      case 'neighbours': return { ...x, a: name(x.a), b: name(x.b) };
      case 'count': return x;
      case 'both': return { t: 'both', a: walk(x.a), b: walk(x.b) };
      case 'not': return { t: 'not', s: walk(x.s) };
    }
  };
  return JSON.stringify(walk(s));
}

/** A random statement about the game, and whether it is true — for the Savant. `truth`: make a true or a false one. */
export function generateStatement(state: GameState, truth: boolean, slot: string, ctx: { asker: string; slot: string }): Statement {
  const players = state.players;
  for (let i = 0; i < 60; i++) {
    const k = `${slot}|${truth}|${i}`;
    const pick = <T>(items: T[], tag: string): T => stablePick(state.secret, items, k, tag);
    const p = pick(players, 'p');
    const kind = Math.floor(stableFloat(state.secret, k, 'kind') * 5);
    let s: Statement;
    if (kind === 0) s = { t: 'alignment', p: p.id, v: pick(['good', 'evil'] as const, 'v') };
    else if (kind === 1) s = { t: 'team', p: p.id, v: pick(TEAMS, 'v') };
    else if (kind === 2) s = { t: 'alive', p: p.id, v: pick([true, false], 'v') };
    else if (kind === 3) s = { t: 'neighbours', a: p.id, b: pick(players.filter((q) => q.id !== p.id), 'b').id };
    else s = { t: 'count', what: pick(['alive', 'dead', 'evilAlive'] as const, 'w'), op: pick(['>=', '<=', '='] as const, 'o'), n: Math.floor(stableFloat(state.secret, k, 'n') * 8) };
    if (evalStatement(state, s, ctx) === truth) return s;
  }
  // Always possible: "N players are alive" with N right or wrong.
  const alive = state.players.filter((p) => p.alive).length;
  return { t: 'count', what: 'alive', op: '=', n: truth ? alive : alive + 1 };
}
