import { CHARACTERS, DISTRIBUTION } from './characters.js';
import { hooksOf } from './deaths.js';
import { SCRIPTS } from './scripts.js';
import { mulberry32, seedFromString } from './rng.js';
import { GameError } from './types.js';
import type { CharacterId, Team } from './types.js';

export interface DealResult {
  characters: Record<string, CharacterId>;
  perceived: Record<string, CharacterId>;
  redHerringId: string | null;
  bluffs: CharacterId[];
  /** Setup pairings (the Evil Twin -> the good player they are twinned with), by player id. */
  twins: Record<string, string>;
}

function draw<T>(rand: () => number, pool: T[], count: number): T[] {
  const copy = pool.slice();
  const out: T[] = [];
  for (let i = 0; i < count && copy.length; i++) {
    const idx = Math.floor(rand() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

/** Deals a game from a script (default: Trouble Brewing) with the standard distribution, adjusted by the
 * characters' own setup hooks (Baron +2 Outsiders...). */
export function dealCharacters(playerIds: string[], secret: string, scriptChars: CharacterId[] = SCRIPTS.tb.characters): DealResult {
  const n = playerIds.length;
  const dist = DISTRIBUTION[n];
  if (!dist) throw new GameError(`Unsupported player count: ${n} (need 5-15)`);
  const of = (team: Team) => scriptChars.filter((id) => CHARACTERS[id].team === team);
  const TOWNSFOLK = of('townsfolk');
  const OUTSIDERS = of('outsider');
  let [townsfolkCount, outsiderCount] = dist;
  const [, , minionCount, demonCount] = dist;

  const rand = mulberry32(seedFromString(secret + '|deal'));

  const minions = draw(rand, of('minion'), minionCount);
  const demon = draw(rand, of('demon'), demonCount);
  // Characters that change how many Outsiders are in play (Baron +2, Fang Gu +1, Vigormortis -1...).
  const shift = (id: CharacterId): number => {
    const d = hooksOf(id).setup?.outsiderDelta;
    return d === undefined ? 0 : typeof d === 'number' ? d : rand() < 0.5 ? -1 : 1;
  };
  let delta = 0;
  for (const id of [...minions, ...demon]) delta += shift(id);
  delta = Math.max(-outsiderCount, Math.min(delta, townsfolkCount - 1));
  outsiderCount += delta;
  townsfolkCount -= delta;
  const outsiders = draw(rand, OUTSIDERS, Math.max(0, outsiderCount));
  const townsfolk = draw(rand, TOWNSFOLK, Math.max(0, townsfolkCount));
  if (minions.length < minionCount || demon.length < demonCount || outsiders.length < outsiderCount || townsfolk.length < townsfolkCount) {
    throw new GameError(`This script has too few characters for ${n} players`);
  }

  const allTokens: CharacterId[] = [...townsfolk, ...outsiders, ...minions, ...demon];
  if (allTokens.length !== n) {
    throw new GameError(`Character count mismatch: dealt ${allTokens.length}, need ${n}`);
  }

  // Characters who are told they are someone else (the Drunk: a Townsfolk; the Lunatic: a Demon).
  const fakes: Record<string, CharacterId> = {};
  const usedFakes = new Set<CharacterId>();
  for (const id of allTokens) {
    const team = hooksOf(id).setup?.thinksTheyAre;
    if (!team) continue;
    const pool = of(team).filter((c) => !allTokens.includes(c) && !usedFakes.has(c));
    const anyPool = of(team).filter((c) => !usedFakes.has(c));
    const fake = pool.length ? draw(rand, pool, 1)[0] : anyPool.length ? anyPool[0] : allTokens.find((c) => CHARACTERS[c].team === team);
    if (fake) {
      fakes[id] = fake;
      usedFakes.add(fake);
    }
  }

  const shuffledPlayers = draw(rand, playerIds, playerIds.length);
  const characters: Record<string, CharacterId> = {};
  const perceived: Record<string, CharacterId> = {};
  shuffledPlayers.forEach((pid, i) => {
    const char = allTokens[i];
    characters[pid] = char;
    perceived[pid] = fakes[char] ?? char;
  });

  // Pairings declared by setup hooks (the Evil Twin is bound to a random good player).
  const twins: Record<string, string> = {};
  const takenTwins = new Set<string>();
  for (const pid of shuffledPlayers) {
    if (hooksOf(characters[pid]).setup?.twinWith !== 'good') continue;
    const goodPool = shuffledPlayers.filter((q) => {
      const team = CHARACTERS[characters[q]].team;
      return q !== pid && (team === 'townsfolk' || team === 'outsider') && !takenTwins.has(q);
    });
    if (!goodPool.length) continue;
    const partner = draw(rand, goodPool, 1)[0];
    twins[pid] = partner;
    takenTwins.add(partner);
  }

  const goodPlayerIds = shuffledPlayers.filter((pid) => {
    const team = CHARACTERS[characters[pid]].team;
    return team === 'townsfolk' || team === 'outsider';
  });
  const redHerringId = goodPlayerIds.length ? draw(rand, goodPlayerIds, 1)[0] : null;

  const inPlaySet = new Set(allTokens);
  const notInPlayGood = [...TOWNSFOLK, ...OUTSIDERS].filter((id) => !inPlaySet.has(id) && !usedFakes.has(id));
  const bluffs = draw(rand, notInPlayGood, 3);

  return { characters, perceived, redHerringId, bluffs, twins };
}
