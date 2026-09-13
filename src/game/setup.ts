import { ALL_CHARACTER_IDS, CHARACTERS, DISTRIBUTION } from './characters.js';
import { mulberry32, seedFromString } from './rng.js';
import { GameError } from './types.js';
import type { CharacterId } from './types.js';

const TOWNSFOLK = ALL_CHARACTER_IDS.filter((id) => CHARACTERS[id].team === 'townsfolk');
const OUTSIDERS = ALL_CHARACTER_IDS.filter((id) => CHARACTERS[id].team === 'outsider');
const MINIONS = ALL_CHARACTER_IDS.filter((id) => CHARACTERS[id].team === 'minion');
const DEMONS = ALL_CHARACTER_IDS.filter((id) => CHARACTERS[id].team === 'demon');

export interface DealResult {
  characters: Record<string, CharacterId>;
  perceived: Record<string, CharacterId>;
  redHerringId: string | null;
  bluffs: CharacterId[];
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

export function dealCharacters(playerIds: string[], secret: string): DealResult {
  const n = playerIds.length;
  const dist = DISTRIBUTION[n];
  if (!dist) throw new GameError(`Unsupported player count: ${n} (need 5-15)`);
  let [townsfolkCount, outsiderCount] = dist;
  const [, , minionCount, demonCount] = dist;

  const rand = mulberry32(seedFromString(secret + '|deal'));

  const minions = draw(rand, MINIONS, minionCount);
  if (minions.includes('baron')) {
    outsiderCount += 2;
    townsfolkCount -= 2;
  }
  const demon = draw(rand, DEMONS, demonCount);
  const outsiders = draw(rand, OUTSIDERS, Math.max(0, outsiderCount));
  const townsfolk = draw(rand, TOWNSFOLK, Math.max(0, townsfolkCount));

  const hasDrunk = outsiders.includes('drunk');
  let drunkFakeChar: CharacterId | null = null;
  if (hasDrunk) {
    const remaining = TOWNSFOLK.filter((id) => !townsfolk.includes(id));
    drunkFakeChar = remaining.length ? draw(rand, remaining, 1)[0] : (townsfolk[0] ?? null);
  }

  const allTokens: CharacterId[] = [...townsfolk, ...outsiders, ...minions, ...demon];
  if (allTokens.length !== n) {
    throw new GameError(`Character count mismatch: dealt ${allTokens.length}, need ${n}`);
  }

  const shuffledPlayers = draw(rand, playerIds, playerIds.length);
  const characters: Record<string, CharacterId> = {};
  const perceived: Record<string, CharacterId> = {};
  shuffledPlayers.forEach((pid, i) => {
    const char = allTokens[i];
    characters[pid] = char;
    perceived[pid] = char === 'drunk' && drunkFakeChar ? drunkFakeChar : char;
  });

  const goodPlayerIds = shuffledPlayers.filter((pid) => {
    const team = CHARACTERS[characters[pid]].team;
    return team === 'townsfolk' || team === 'outsider';
  });
  const redHerringId = goodPlayerIds.length ? draw(rand, goodPlayerIds, 1)[0] : null;

  const inPlaySet = new Set(allTokens);
  const notInPlayGood = [...TOWNSFOLK, ...OUTSIDERS].filter((id) => !inPlaySet.has(id) && id !== drunkFakeChar);
  const bluffs = draw(rand, notInPlayGood, 3);

  return { characters, perceived, redHerringId, bluffs };
}
