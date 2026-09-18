import { BMR } from './chars/bmr.js';
import { SV } from './chars/sv.js';
import { TB } from './chars/tb.js';
import type { CharacterDef } from './hooks.js';
import type { CharacterId, Team } from './types.js';

export type { CharacterDef };

/** Every character of every edition, by id. The engine only ever looks characters up here. */
export const CHARACTERS: Record<CharacterId, CharacterDef> = Object.fromEntries([...TB, ...BMR, ...SV].map((c) => [c.id, c]));

export const ALL_CHARACTER_IDS: CharacterId[] = Object.keys(CHARACTERS);

/** [townsfolk, outsider, minion, demon] by player count (5..15). Baron adjusts this at setup time. */
export const DISTRIBUTION: Record<number, [number, number, number, number]> = {
  5: [3, 0, 1, 1],
  6: [3, 1, 1, 1],
  7: [5, 0, 1, 1],
  8: [5, 1, 1, 1],
  9: [5, 2, 1, 1],
  10: [7, 0, 2, 1],
  11: [7, 1, 2, 1],
  12: [7, 2, 2, 1],
  13: [9, 0, 3, 1],
  14: [9, 1, 3, 1],
  15: [9, 2, 3, 1],
};

export function isEvilTeam(team: Team): boolean {
  return team === 'minion' || team === 'demon';
}

export function alignmentOfCharacter(id: CharacterId): 'good' | 'evil' {
  return isEvilTeam(CHARACTERS[id].team) ? 'evil' : 'good';
}

/** Display order for a full role reference sheet: good roles first (as on the physical character sheet), then evil. */
export const TEAM_DISPLAY_ORDER: Team[] = ['townsfolk', 'outsider', 'minion', 'demon'];

export interface CharacterSummary {
  id: CharacterId;
  name: string;
  team: Team;
  ability: string;
  edition: string;
}

/** Every character's name/team/ability, grouped by team for a reference sheet. */
export function allCharactersSummary(ids: CharacterId[] = ALL_CHARACTER_IDS): CharacterSummary[] {
  return ids.map((id) => {
    const c = CHARACTERS[id];
    return { id: c.id, name: c.name, team: c.team, ability: c.ability, edition: c.edition };
  }).sort((a, b) => TEAM_DISPLAY_ORDER.indexOf(a.team) - TEAM_DISPLAY_ORDER.indexOf(b.team));
}
