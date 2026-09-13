import type { CharacterId, NightTurnShape, Team } from './types.js';

export interface CharacterDef {
  id: CharacterId;
  name: string;
  team: Team;
  ability: string;
  firstNight: number;
  otherNight: number;
  shape: NightTurnShape;
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  washerwoman: { id: 'washerwoman', name: 'Washerwoman', team: 'townsfolk', shape: 'info', firstNight: 4, otherNight: 0,
    ability: 'You start knowing that 1 of 2 players is a particular Townsfolk.' },
  librarian: { id: 'librarian', name: 'Librarian', team: 'townsfolk', shape: 'info', firstNight: 5, otherNight: 0,
    ability: 'You start knowing that 1 of 2 players is a particular Outsider (or that there are no Outsiders).' },
  investigator: { id: 'investigator', name: 'Investigator', team: 'townsfolk', shape: 'info', firstNight: 6, otherNight: 0,
    ability: 'You start knowing that 1 of 2 players is a particular Minion.' },
  chef: { id: 'chef', name: 'Chef', team: 'townsfolk', shape: 'info', firstNight: 7, otherNight: 0,
    ability: 'You start knowing how many pairs of evil players are sitting next to each other.' },
  empath: { id: 'empath', name: 'Empath', team: 'townsfolk', shape: 'info', firstNight: 8, otherNight: 6,
    ability: 'Each night, you learn how many of your 2 alive neighbours are evil.' },
  fortuneteller: { id: 'fortuneteller', name: 'Fortune Teller', team: 'townsfolk', shape: 'choose', firstNight: 9, otherNight: 7,
    ability: 'Each night, choose 2 players: you learn if either is the Demon. There is a good player that registers as a Demon to you.' },
  undertaker: { id: 'undertaker', name: 'Undertaker', team: 'townsfolk', shape: 'info', firstNight: 0, otherNight: 8,
    ability: 'Each night*, you learn which character died by execution today.' },
  monk: { id: 'monk', name: 'Monk', team: 'townsfolk', shape: 'choose', firstNight: 0, otherNight: 2,
    ability: 'Each night*, choose a player (not yourself): they are safe from the Demon tonight.' },
  ravenkeeper: { id: 'ravenkeeper', name: 'Ravenkeeper', team: 'townsfolk', shape: 'choose', firstNight: 0, otherNight: 4,
    ability: 'If you die at night, you are woken to choose a player: you learn their character.' },
  virgin: { id: 'virgin', name: 'Virgin', team: 'townsfolk', shape: 'info', firstNight: 0, otherNight: 0,
    ability: 'The first time you are nominated, if the nominator is a Townsfolk, they are executed immediately.' },
  slayer: { id: 'slayer', name: 'Slayer', team: 'townsfolk', shape: 'info', firstNight: 0, otherNight: 0,
    ability: 'Once per game, during the day, publicly choose a player: if they are the Demon, they die.' },
  soldier: { id: 'soldier', name: 'Soldier', team: 'townsfolk', shape: 'info', firstNight: 0, otherNight: 0,
    ability: 'You are safe from the Demon.' },
  mayor: { id: 'mayor', name: 'Mayor', team: 'townsfolk', shape: 'info', firstNight: 0, otherNight: 0,
    ability: 'If only 3 players live and no execution happens, your team wins. If you die at night, another player might die instead.' },
  butler: { id: 'butler', name: 'Butler', team: 'outsider', shape: 'choose', firstNight: 10, otherNight: 5,
    ability: 'Each night, choose a player (not yourself): you may only vote when they do, tomorrow.' },
  drunk: { id: 'drunk', name: 'Drunk', team: 'outsider', shape: 'info', firstNight: 0, otherNight: 0,
    ability: 'You do not know you are the Drunk. You think you are a Townsfolk, but your ability malfunctions.' },
  recluse: { id: 'recluse', name: 'Recluse', team: 'outsider', shape: 'info', firstNight: 0, otherNight: 0,
    ability: 'You might register as evil and as a Minion or Demon, even if dead.' },
  saint: { id: 'saint', name: 'Saint', team: 'outsider', shape: 'info', firstNight: 0, otherNight: 0,
    ability: 'If you die by execution, your team loses.' },
  poisoner: { id: 'poisoner', name: 'Poisoner', team: 'minion', shape: 'choose', firstNight: 3, otherNight: 1,
    ability: 'Each night, choose a player: they are poisoned tonight and tomorrow day.' },
  spy: { id: 'spy', name: 'Spy', team: 'minion', shape: 'info', firstNight: 11, otherNight: 9,
    ability: 'Each night, you see the whole grimoire. You might register as good and as a Townsfolk or Outsider.' },
  scarletwoman: { id: 'scarletwoman', name: 'Scarlet Woman', team: 'minion', shape: 'info', firstNight: 0, otherNight: 0,
    ability: 'If there are 5 or more players alive and the Demon dies, you become the Demon.' },
  baron: { id: 'baron', name: 'Baron', team: 'minion', shape: 'info', firstNight: 0, otherNight: 0,
    ability: 'There are extra Outsiders in play. [+2 Outsiders]' },
  imp: { id: 'imp', name: 'Imp', team: 'demon', shape: 'choose', firstNight: 2, otherNight: 3,
    ability: 'Each night*, choose a player: they die. If you kill yourself this way, a Minion becomes the Imp.' },
};

export const ALL_CHARACTER_IDS = Object.keys(CHARACTERS) as CharacterId[];

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
