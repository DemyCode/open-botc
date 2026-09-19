// Small helpers shared by the character definitions.
import { CHARACTERS } from '../characters.js';
import { record } from '../history.js';
import { msg } from '../messages.js';
import { stableFloat, stablePick } from '../rng.js';
import type { GameState, PlayerState, Team } from '../types.js';

/** The player with this id (the id always comes from a validated target list, so it exists). */
export const byId = (state: GameState, id: string): PlayerState => state.players.find((p) => p.id === id)!;

/** The plain "choose a player to kill" night prompt shared by most Demons. */
export const demonChoosePrompt = () => ({ min: 1, max: 1, body: msg('demonChoose') });

export const teamOf = (p: PlayerState): Team => CHARACTERS[p.character].team;
export const isGood = (p: PlayerState): boolean => p.alignment === 'good';
export const isDemon = (p: PlayerState): boolean => teamOf(p) === 'demon';
export const isMinion = (p: PlayerState): boolean => teamOf(p) === 'minion';

/** The Storyteller's choice, made by the seeded dice so it never changes on a replay of the same night. */
export function choose<T>(state: GameState, items: T[], ...parts: (string | number)[]): T {
  return stablePick(state.secret, items, ...parts);
}
export function roll(state: GameState, ...parts: (string | number)[]): number {
  return stableFloat(state.secret, ...parts);
}

export function alivePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.alive);
}

/** Someone dead comes back to life with their ability as new (even a "once per game" one already used). */
export function resurrect(state: GameState, p: PlayerState, why: string): void {
  p.alive = true;
  p.ghostVoteUsed = false;
  p.virginUsed = false;
  p.slayerUsed = false;
  p.flags = {};
  (state.data.resurrected ??= []).push(p.id);
  record(state, 'resurrect', { player: p.id, why });
}

/** Changes a player's alignment (the Goon), telling the replay. */
export function setAlignment(state: GameState, p: PlayerState, alignment: 'good' | 'evil', why: string): void {
  if (p.alignment === alignment) return;
  p.alignment = alignment;
  record(state, 'alignment', { player: p.id, alignment, why });
}
