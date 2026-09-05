import {
  CHARACTERS,
  DISTRIBUTION,
  MAX_PLAYERS,
  MIN_PLAYERS,
  charsOfTeam,
  type CharacterId,
} from './characters.js';
import { pick, sample, shuffle } from './rng.js';
import type { GameState, PlayerState } from './types.js';

export interface Deal {
  /** playerId → true character. */
  assignments: Record<string, CharacterId>;
  /** playerId → character they believe they have (differs for the Drunk). */
  perceived: Record<string, CharacterId>;
  /** Characters genuinely in play (the Drunk counts as 'drunk'). */
  inPlay: CharacterId[];
  /** The Drunk's fake Townsfolk token, if the Drunk is in play. */
  drunkFake: CharacterId | null;
  /** Good player who registers as the Demon to the Fortune Teller. */
  redHerring: string | null;
  /** Three good characters not in play, shown to the Demon as bluffs. */
  demonBluffs: CharacterId[];
  counts: { townsfolk: number; outsider: number; minion: number; demon: number };
}

export class SetupError extends Error {}

/**
 * Deal Trouble Brewing characters for `players.length` players.
 *
 * Order matters: minions are drawn first because the Baron changes the
 * Townsfolk/Outsider split, and outsiders before townsfolk because the Drunk
 * adds an extra Townsfolk token to the draw.
 */
export function dealCharacters(state: GameState, players: PlayerState[]): Deal {
  const n = players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new SetupError(
      `Trouble Brewing needs ${MIN_PLAYERS}–${MAX_PLAYERS} players (have ${n}).`,
    );
  }

  const banned = new Set(state.options.banned);
  const poolOf = (team: 'townsfolk' | 'outsider' | 'minion' | 'demon') =>
    charsOfTeam(team).filter((c) => !banned.has(c));

  const dist = DISTRIBUTION[n];
  let [nTownsfolk, nOutsiders, nMinions, nDemons] = dist;

  // --- Minions (Baron first, since it rewrites the split)
  const minionPool = poolOf('minion');
  if (minionPool.length < nMinions) {
    throw new SetupError(`Not enough Minions available (need ${nMinions}).`);
  }
  const minions = sample(state, minionPool, nMinions);

  if (minions.includes('baron')) {
    nOutsiders += 2;
    nTownsfolk -= 2;
  }

  // --- Demon
  const demonPool = poolOf('demon');
  if (demonPool.length < nDemons) {
    throw new SetupError('No Demon available.');
  }
  const demons = sample(state, demonPool, nDemons);

  // --- Outsiders
  const outsiderPool = poolOf('outsider');
  if (outsiderPool.length < nOutsiders) {
    throw new SetupError(
      `Not enough Outsiders available (need ${nOutsiders}, have ${outsiderPool.length}). ` +
        `Un-ban an Outsider or the Baron.`,
    );
  }
  const outsiders = sample(state, outsiderPool, nOutsiders);

  // --- Townsfolk. The Drunk needs one extra token to hold.
  const hasDrunk = outsiders.includes('drunk');
  const townsfolkNeeded = nTownsfolk + (hasDrunk ? 1 : 0);
  const townsfolkPool = poolOf('townsfolk');
  if (townsfolkPool.length < townsfolkNeeded) {
    throw new SetupError(
      `Not enough Townsfolk available (need ${townsfolkNeeded}).`,
    );
  }
  const townsfolkDraw = sample(state, townsfolkPool, townsfolkNeeded);

  const drunkFake = hasDrunk ? townsfolkDraw[townsfolkDraw.length - 1] : null;
  const realTownsfolk = hasDrunk ? townsfolkDraw.slice(0, -1) : townsfolkDraw;

  const inPlay: CharacterId[] = [
    ...realTownsfolk,
    ...outsiders,
    ...minions,
    ...demons,
  ];
  if (inPlay.length !== n) {
    throw new SetupError(
      `Internal error: dealt ${inPlay.length} characters for ${n} players.`,
    );
  }

  // --- Seat them
  const order = shuffle(state, players.map((p) => p.id));
  const assignments: Record<string, CharacterId> = {};
  const perceived: Record<string, CharacterId> = {};
  order.forEach((pid, i) => {
    const c = inPlay[i];
    assignments[pid] = c;
    perceived[pid] = c === 'drunk' && drunkFake ? drunkFake : c;
  });

  // --- Fortune Teller red herring: any good player, possibly the FT itself.
  let redHerring: string | null = null;
  if (inPlay.includes('fortuneteller')) {
    const goodIds = order.filter((pid) => {
      const t = CHARACTERS[assignments[pid]].team;
      return t === 'townsfolk' || t === 'outsider';
    });
    if (goodIds.length > 0) redHerring = pick(state, goodIds);
  }

  // --- Demon bluffs: 3 good characters that nobody holds a token for.
  // The Drunk's fake token is out of the bag too, so it can't be a bluff.
  const taken = new Set<CharacterId>(inPlay);
  if (drunkFake) taken.add(drunkFake);
  const bluffPool = [...poolOf('townsfolk'), ...poolOf('outsider')].filter(
    (c) => !taken.has(c),
  );
  const demonBluffs = sample(state, bluffPool, Math.min(3, bluffPool.length));

  return {
    assignments,
    perceived,
    inPlay,
    drunkFake,
    redHerring,
    demonBluffs,
    counts: {
      townsfolk: realTownsfolk.length,
      outsider: outsiders.length,
      minion: minions.length,
      demon: demons.length,
    },
  };
}

/** What the lobby shows before the game starts. */
export function previewDistribution(
  n: number,
): { townsfolk: number; outsider: number; minion: number; demon: number } | null {
  const d = DISTRIBUTION[n];
  if (!d) return null;
  return { townsfolk: d[0], outsider: d[1], minion: d[2], demon: d[3] };
}
