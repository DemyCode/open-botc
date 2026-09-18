// A script is the list of characters a game is played with: one of the three editions, or a custom
// mix of characters from any edition. The engine deals from it and nothing else.
import { ALL_CHARACTER_IDS, CHARACTERS } from './characters.js';
import type { CharacterId } from './types.js';
import { GameError } from './types.js';

export interface Script {
  id: string;
  name: string;
  characters: CharacterId[];
}

const ofEdition = (edition: string): CharacterId[] => ALL_CHARACTER_IDS.filter((id) => CHARACTERS[id].edition === edition);

export const SCRIPTS: Record<string, Script> = {
  tb: { id: 'tb', name: 'Trouble Brewing', characters: ofEdition('tb') },
  bmr: { id: 'bmr', name: 'Bad Moon Rising', characters: ofEdition('bmr') },
  sv: { id: 'sv', name: 'Sects & Violets', characters: ofEdition('sv') },
};

export const CUSTOM_SCRIPT_ID = 'custom';

/** The characters of a script id — or, for a custom script, of the given list (validated). */
export function resolveScript(scriptId: string, custom?: CharacterId[]): Script {
  if (scriptId === CUSTOM_SCRIPT_ID) {
    const ids = [...new Set(custom ?? [])];
    for (const id of ids) if (!CHARACTERS[id]) throw new GameError(`Unknown character: ${id}`);
    const count = (team: string) => ids.filter((id) => CHARACTERS[id].team === team).length;
    // Enough of each team to deal the largest game (15 players): 9 Townsfolk, 2 Outsiders + a Baron-like bonus,
    // 3 Minions, 1 Demon. Fewer only limits which player counts can be dealt (checked when the game starts).
    if (count('demon') < 1) throw new GameError('A script needs at least one Demon');
    if (count('minion') < 1) throw new GameError('A script needs at least one Minion');
    if (count('townsfolk') < 3) throw new GameError('A script needs at least 3 Townsfolk');
    return { id: CUSTOM_SCRIPT_ID, name: 'Custom', characters: ids };
  }
  const s = SCRIPTS[scriptId];
  if (!s) throw new GameError(`Unknown script: ${scriptId}`);
  return s;
}
