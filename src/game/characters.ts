/**
 * Trouble Brewing character definitions.
 *
 * Night-order numbers are the official ones from the Trouble Brewing night
 * sheet, so `firstNight` / `otherNight` can be sorted directly. 0 means the
 * character does not act on that night.
 */

export type Team = 'townsfolk' | 'outsider' | 'minion' | 'demon';

export type CharacterId =
  // Townsfolk
  | 'washerwoman'
  | 'librarian'
  | 'investigator'
  | 'chef'
  | 'empath'
  | 'fortuneteller'
  | 'undertaker'
  | 'monk'
  | 'ravenkeeper'
  | 'virgin'
  | 'slayer'
  | 'soldier'
  | 'mayor'
  // Outsiders
  | 'butler'
  | 'drunk'
  | 'recluse'
  | 'saint'
  // Minions
  | 'poisoner'
  | 'spy'
  | 'scarletwoman'
  | 'baron'
  // Demon
  | 'imp';

export interface Character {
  id: CharacterId;
  name: string;
  team: Team;
  ability: string;
  /** Official first-night order position. 0 = does not act. */
  firstNight: number;
  /** Official other-night order position. 0 = does not act. */
  otherNight: number;
  /** Does the first-night wake require input from the player? */
  choosesFirstNight?: boolean;
  /** Does the other-night wake require input from the player? */
  choosesOtherNight?: boolean;
  /** How many players they select when they choose. */
  choiceCount?: number;
  /** May the player target themselves? */
  mayChooseSelf?: boolean;
  /** Setup modification note shown in the lobby. */
  setup?: string;
  emoji: string;
}

const defs: Character[] = [
  // ---------------------------------------------------------------- Townsfolk
  {
    id: 'washerwoman',
    name: 'Washerwoman',
    team: 'townsfolk',
    ability: 'You start knowing that 1 of 2 players is a particular Townsfolk.',
    firstNight: 32,
    otherNight: 0,
    emoji: '🧺',
  },
  {
    id: 'librarian',
    name: 'Librarian',
    team: 'townsfolk',
    ability:
      'You start knowing that 1 of 2 players is a particular Outsider. (Or that zero are in play.)',
    firstNight: 33,
    otherNight: 0,
    emoji: '📚',
  },
  {
    id: 'investigator',
    name: 'Investigator',
    team: 'townsfolk',
    ability: 'You start knowing that 1 of 2 players is a particular Minion.',
    firstNight: 34,
    otherNight: 0,
    emoji: '🔎',
  },
  {
    id: 'chef',
    name: 'Chef',
    team: 'townsfolk',
    ability: 'You start knowing how many pairs of evil players there are.',
    firstNight: 35,
    otherNight: 0,
    emoji: '🍳',
  },
  {
    id: 'empath',
    name: 'Empath',
    team: 'townsfolk',
    ability: 'Each night, you learn how many of your 2 alive neighbours are evil.',
    firstNight: 36,
    otherNight: 42,
    emoji: '💞',
  },
  {
    id: 'fortuneteller',
    name: 'Fortune Teller',
    team: 'townsfolk',
    ability:
      'Each night, choose 2 players: you learn if either is a Demon. There is a good player that registers as a Demon to you.',
    firstNight: 37,
    otherNight: 43,
    choosesFirstNight: true,
    choosesOtherNight: true,
    choiceCount: 2,
    mayChooseSelf: true,
    emoji: '🔮',
  },
  {
    id: 'undertaker',
    name: 'Undertaker',
    team: 'townsfolk',
    ability: 'Each night*, you learn which character died by execution today.',
    firstNight: 0,
    otherNight: 45,
    emoji: '⚰️',
  },
  {
    id: 'monk',
    name: 'Monk',
    team: 'townsfolk',
    ability:
      'Each night*, choose a player (not yourself): they are safe from the Demon tonight.',
    firstNight: 0,
    otherNight: 12,
    choosesOtherNight: true,
    choiceCount: 1,
    mayChooseSelf: false,
    emoji: '🙏',
  },
  {
    id: 'ravenkeeper',
    name: 'Ravenkeeper',
    team: 'townsfolk',
    ability:
      'If you die at night, you are woken to choose a player: you learn their character.',
    firstNight: 0,
    otherNight: 40,
    choosesOtherNight: true,
    choiceCount: 1,
    mayChooseSelf: true,
    emoji: '🐦‍⬛',
  },
  {
    id: 'virgin',
    name: 'Virgin',
    team: 'townsfolk',
    ability:
      'The 1st time you are nominated, if the nominator is a Townsfolk, they are executed immediately.',
    firstNight: 0,
    otherNight: 0,
    emoji: '🕊️',
  },
  {
    id: 'slayer',
    name: 'Slayer',
    team: 'townsfolk',
    ability:
      'Once per game, during the day, publicly choose a player: if they are the Demon, they die.',
    firstNight: 0,
    otherNight: 0,
    emoji: '🗡️',
  },
  {
    id: 'soldier',
    name: 'Soldier',
    team: 'townsfolk',
    ability: 'You are safe from the Demon.',
    firstNight: 0,
    otherNight: 0,
    emoji: '🛡️',
  },
  {
    id: 'mayor',
    name: 'Mayor',
    team: 'townsfolk',
    ability:
      'If only 3 players live & no execution occurs, your team wins. If you die at night, another player might die instead.',
    firstNight: 0,
    otherNight: 0,
    emoji: '🎩',
  },

  // ---------------------------------------------------------------- Outsiders
  {
    id: 'butler',
    name: 'Butler',
    team: 'outsider',
    ability:
      'Each night, choose a player (not yourself): tomorrow, you may only vote if they are voting too.',
    firstNight: 38,
    otherNight: 46,
    choosesFirstNight: true,
    choosesOtherNight: true,
    choiceCount: 1,
    mayChooseSelf: false,
    emoji: '🤵',
  },
  {
    id: 'drunk',
    name: 'Drunk',
    team: 'outsider',
    ability:
      'You do not know you are the Drunk. You think you are a Townsfolk character, but you are not.',
    firstNight: 0,
    otherNight: 0,
    setup: '[+1 extra Townsfolk token is dealt; that player is really the Drunk]',
    emoji: '🍺',
  },
  {
    id: 'recluse',
    name: 'Recluse',
    team: 'outsider',
    ability: 'You might register as evil & as a Minion or Demon, even if dead.',
    firstNight: 0,
    otherNight: 0,
    emoji: '🏚️',
  },
  {
    id: 'saint',
    name: 'Saint',
    team: 'outsider',
    ability: 'If you die by execution, your team loses.',
    firstNight: 0,
    otherNight: 0,
    emoji: '😇',
  },

  // ------------------------------------------------------------------ Minions
  {
    id: 'poisoner',
    name: 'Poisoner',
    team: 'minion',
    ability: 'Each night, choose a player: they are poisoned tonight and tomorrow day.',
    firstNight: 17,
    otherNight: 7,
    choosesFirstNight: true,
    choosesOtherNight: true,
    choiceCount: 1,
    mayChooseSelf: true,
    emoji: '🧪',
  },
  {
    id: 'spy',
    name: 'Spy',
    team: 'minion',
    ability:
      'Each night, you see the Grimoire. You might register as good & as a Townsfolk or Outsider, even if dead.',
    firstNight: 24,
    otherNight: 27,
    emoji: '🕵️',
  },
  {
    id: 'scarletwoman',
    name: 'Scarlet Woman',
    team: 'minion',
    ability:
      'If there are 5 or more players alive & the Demon dies, you become the Demon.',
    firstNight: 0,
    otherNight: 30,
    emoji: '💃',
  },
  {
    id: 'baron',
    name: 'Baron',
    team: 'minion',
    ability: 'There are extra Outsiders in play.',
    firstNight: 0,
    otherNight: 0,
    setup: '[+2 Outsiders, -2 Townsfolk]',
    emoji: '🎭',
  },

  // -------------------------------------------------------------------- Demon
  {
    id: 'imp',
    name: 'Imp',
    team: 'demon',
    ability:
      'Each night*, choose a player: they die. If you kill yourself this way, a Minion becomes the Imp.',
    firstNight: 0,
    otherNight: 32,
    choosesOtherNight: true,
    choiceCount: 1,
    mayChooseSelf: true,
    emoji: '👹',
  },
];

export const CHARACTERS: Record<CharacterId, Character> = Object.fromEntries(
  defs.map((c) => [c.id, c]),
) as Record<CharacterId, Character>;

export const ALL_CHARACTERS: CharacterId[] = defs.map((c) => c.id);

export function charsOfTeam(team: Team): CharacterId[] {
  return defs.filter((c) => c.team === team).map((c) => c.id);
}

export function char(id: CharacterId): Character {
  const c = CHARACTERS[id];
  if (!c) throw new Error(`unknown character: ${id}`);
  return c;
}

/** Group-wake order slots that are not tied to a single character. */
export const MINION_INFO_FIRST_NIGHT = 6;
export const DEMON_INFO_FIRST_NIGHT = 8;

/**
 * Player-count → [townsfolk, outsiders, minions, demons].
 * Trouble Brewing supports 5–15 players.
 */
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

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 15;

export function teamLabel(team: Team): string {
  switch (team) {
    case 'townsfolk':
      return 'Townsfolk';
    case 'outsider':
      return 'Outsider';
    case 'minion':
      return 'Minion';
    case 'demon':
      return 'Demon';
  }
}

export function teamAlignment(team: Team): 'good' | 'evil' {
  return team === 'minion' || team === 'demon' ? 'evil' : 'good';
}
