// The hook system: a character is data (id, team, ability text, night order) plus a few optional
// HOOKS — small functions the engine calls at well-defined moments. The engine itself knows no
// character by name: to add a character you write a definition, never touch the engine, so any
// script (a mix of characters from any edition) works.
//
// Every hook receives the game state and the OWNER — the player whose true character defines the
// hook. Hooks decide for themselves whether the owner's ability currently works (abilityWorks):
// the engine never checks that on their behalf, because some effects (a Recluse registering,
// a Saint dying) apply whether or not it does.
import type { GameState, Msg, NightTurnShape, PlayerState, Team } from './types.js';
import type { RegisterKind } from './registration.js';

/** What a "choose" night step asks. */
export interface NightPrompt {
  min: number;
  max: number;
  body: Msg;
  /** Also pick a character (Gambler, Cerenovus, Pit-Hag...): the answer then carries `character`. */
  pickCharacter?: boolean;
  /** Which players may be picked; default: everyone (living or dead, yourself included). */
  eligible?: (state: GameState, self: PlayerState, target: PlayerState) => boolean;
}

export interface NightSpec {
  /** Who is woken for this step. Default: living players whose (perceived) character is this one. */
  actors?(state: GameState, step: string): PlayerState[];
  /** The step's shape tonight. Default: the definition's `shape`. */
  shape?(state: GameState): NightTurnShape;
  /** "choose" steps: what to ask. */
  prompt?(state: GameState, self: PlayerState): NightPrompt;
  /** "info" steps: the information shown (computed when the step opens). */
  info?(state: GameState, self: PlayerState, slot: string): Msg;
  /** The effect of the real actor's answer (a decoy answer never reaches this). */
  apply?(state: GameState, self: PlayerState, targets: string[], slot: string, character?: string): void;
  /** Runs when the step's turn comes, even if nobody is woken (a poison that wears off...). */
  before?(state: GameState): void;
  /** Record the answer in the replay as a "choice" (only abilities that really pick someone). */
  recordsChoice?: boolean;
  /** The step gives a result right after answering (Fortune Teller, Ravenkeeper): decoys show one too. */
  result?: boolean;
  /** The character is woken when they are dead (Ravenkeeper): they learn of their own death at once. */
  wakesWhenDead?: boolean;
  /** A choose step's answer may not include the actor themself. */
  notSelf?: boolean;
}

export interface Hooks {
  /** The character's ability never works (Drunk, Lunatic): they only *think* they have one. */
  noAbility?: boolean;
  night?: NightSpec;

  // ---- Death
  /** Does `owner`'s ability stop `victim` from dying now? Returns the reason (a character id) or null. */
  protects?(state: GameState, owner: PlayerState, victim: PlayerState, cause: string): string | null;
  /** Owner's ability turns a Demon kill of `victim` onto someone else (Mayor). null = no redirect. */
  redirectsKill?(state: GameState, owner: PlayerState, victim: PlayerState, killer: PlayerState): PlayerState | null;
  /** The owner died (any cause). */
  onDeath?(state: GameState, owner: PlayerState, cause: string): void;
  /** Runs after every onDeath/onAnyDeath of a death: for replacements (a Minion becomes the Imp). */
  afterDeath?(state: GameState, owner: PlayerState, cause: string): void;
  /** Someone else died; called for every living owner (Scarlet Woman, Grandmother...). */
  onAnyDeath?(state: GameState, owner: PlayerState, dead: PlayerState, cause: string): void;

  // ---- Day
  /** The owner was nominated (`nominee`). Return 'endsDay' if it ended the day (Virgin's execution). */
  onNominated?(state: GameState, owner: PlayerState, nominator: PlayerState): 'endsDay' | void;
  /** After a day ends with (or without) an execution: extra win conditions (Mayor). */
  endOfDayWin?(state: GameState, owner: PlayerState, executedId: string | null): boolean;
  /** Does this player's vote count (Butler)? Called for the voter's own character. */
  voteCounts?(state: GameState, voter: PlayerState, votes: Record<string, boolean>): boolean;

  // ---- Information: how the owner registers to other people's abilities.
  misregister?: {
    from: 'good' | 'evil';
    /** Asked about these, the owner may answer wrongly (rolled). */
    kinds: RegisterKind[];
    /** Asked about these, the roll is inverted. */
    invertedKinds?: RegisterKind[];
  };

  // ---- Setup
  setup?: {
    /** Extra Outsiders in play (Baron +2, Vigormortis -1...). */
    outsiderDelta?: number | 'randomPlusMinusOne';
    /** The player is told they are this team's character but isn't (Drunk: townsfolk, Lunatic: demon). */
    thinksTheyAre?: Team;
  };
}

export interface CharacterDef {
  id: string;
  name: string;
  team: Team;
  ability: string;
  edition: 'tb' | 'bmr' | 'sv';
  /** Position in the first / other nights' order (0 = never wakes that night). */
  firstNight: number;
  otherNight: number;
  shape: NightTurnShape;
  hooks?: Hooks;
}
