// The hook system: a character is data (id, team, ability text, night order) plus a few optional
// HOOKS — small functions the engine calls at well-defined moments. The engine itself knows no
// character by name: to add a character you write a definition, never touch the engine, so any
// script (a mix of characters from any edition) works.
//
// Every hook receives the game state and the OWNER — the player whose true character defines the
// hook. Hooks decide for themselves whether the owner's ability currently works (abilityWorks):
// the engine never checks that on their behalf, because some effects (a Recluse registering,
// a Saint dying) apply whether or not it does.
import type { CharacterId, GameState, Msg, NightTurnShape, PlayerState, Team } from './types.js';
import type { RegisterKind } from './registration.js';

/** What a "choose" night step asks. */
export interface NightPrompt {
  min: number;
  max: number;
  body: Msg;
  /** Also pick a character (Gambler, Cerenovus, Pit-Hag...): the answer then carries `character`. */
  pickCharacter?: boolean;
  /** The character may be left out (the Courtier may shake their head). */
  optionalCharacter?: boolean;
  /** Restrict which characters may be picked (the Pit-Hag may only pick one not in play). */
  characterPool?: CharacterId[];
  /** Which players may be picked; default: everyone (living or dead, yourself included). */
  eligible?: (state: GameState, self: PlayerState, target: PlayerState) => boolean;
}

export interface NightSpec {
  /** Who is woken for this step. Default: living players whose (perceived) character is this one. */
  actors?(state: GameState, step: string): PlayerState[];
  /** The Demon info is given by this character's own first-night step (the Imp), not the shared Demon-info step. */
  ownDemonInfo?: boolean;
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
  /** The apply hook announces each chosen player itself, one at a time (a Po who picks the Goon turns drunk
   * before the NEXT attack, not before the first). See notifyChosen. */
  sequentialTargets?: boolean;
  /** Record the answer in the replay as a "choice" (only abilities that really pick someone). */
  recordsChoice?: boolean;
  /** Whether this step is a wake "due to their ability" tonight (the Chambermaid counts those). Default: yes. */
  abilityWake?: (state: GameState) => boolean;
  /** The step gives a result right after answering (Fortune Teller, Ravenkeeper): decoys show one too. */
  result?: boolean;
  /** The character is woken when they are dead (Ravenkeeper): they learn of their own death at once. */
  wakesWhenDead?: boolean;
  /** A choose step's answer may not include the actor themself. */
  notSelf?: boolean;
}

export interface Hooks {
  /** The character's ability never works (Drunk, Lunatic): they only *think* they have one. The value is the reason shown in the replay. */
  noAbility?: 'drunk' | 'lunatic';
  night?: NightSpec;

  // ---- Death
  /** Does `owner`'s ability stop `victim` from dying now? Returns the reason (a character id) or null. */
  protects?(state: GameState, owner: PlayerState, victim: PlayerState, cause: string): string | null;
  /** Like `protects`, but only asked when nothing else protects — and free to change state (the Fool uses up
   * their one life; the Zombuul "dies" but lives on). Returns the reason, or { by, appearsDead } for a Zombuul. */
  lastResort?(state: GameState, owner: PlayerState, victim: PlayerState, cause: string): string | { by: string; appearsDead: true } | null;
  /** Owner's ability turns a Demon kill of `victim` onto someone else (Mayor). null = no redirect. */
  redirectsKill?(state: GameState, owner: PlayerState, victim: PlayerState, killer: PlayerState): PlayerState | null;
  /** The owner died (any cause). */
  onDeath?(state: GameState, owner: PlayerState, cause: string): void;
  /** Runs after every onDeath/onAnyDeath of a death: for replacements (a Minion becomes the Imp). */
  afterDeath?(state: GameState, owner: PlayerState, cause: string): void;
  /** The owner's own night ability was just used on `targets` (the Lunatic's choices are shown to the real Demon). */
  onOwnNightAction?(state: GameState, owner: PlayerState, step: string, targets: string[]): void;
  /** Another player's night ability chose the owner (the Goon). `step` is the choosing character. */
  onChosen?(state: GameState, owner: PlayerState, chooser: PlayerState, step: string): void;
  /** Someone else died; called for every living owner (Scarlet Woman, Grandmother...). */
  onAnyDeath?(state: GameState, owner: PlayerState, dead: PlayerState, cause: string): void;

  /** While the owner's ability works, this keeps `target` poisoned (the No Dashii's Townsfolk neighbours): a live rule, so it
   * holds from setup and follows the seating and characters as they change — no bookkeeping to go stale. */
  poisons?(state: GameState, owner: PlayerState, target: PlayerState): boolean;

  // ---- Day
  /** The owner was nominated (`nominee`). Return 'endsDay' if it ended the day (Virgin's execution). */
  onNominated?(state: GameState, owner: PlayerState, nominator: PlayerState): 'endsDay' | void;
  /** Anyone nominated anyone: the owner's ability may react (the Witch's curse kills the nominator). */
  onNominate?(state: GameState, owner: PlayerState, nominator: PlayerState): void;
  /** After a day ends with (or without) an execution: extra win conditions (Mayor). */
  endOfDayWin?(state: GameState, owner: PlayerState, executedId: string | null): boolean;
  /** Just before the day's execution: return a player id to execute INSTEAD (the Cerenovus' madness). */
  beforeDayEnd?(state: GameState, owner: PlayerState): string | void;
  /** Does this player's vote count (Butler)? Called for the voter's own character. */
  voteCounts?(state: GameState, voter: PlayerState, votes: Record<string, boolean>): boolean;

  /** The owner would let the good team win by killing the Demon — but play goes on (the Mastermind). */
  delaysGoodWin?(state: GameState, owner: PlayerState): boolean;
  /** While this returns true, good cannot win at all (the Evil Twin, as long as both twins live). */
  blocksGoodWin?(state: GameState, owner: PlayerState): boolean;
  /** The owner's presence makes every Townsfolk ability yield false information (the Vortox). */
  falsifiesTownsfolkInfo?: boolean;

  // ---- Day: a public ability anyone may CLAIM by using it (so bluffing is possible); only the real,
  // working character has an effect. Once-per-player limits are tracked by the engine.
  day?: DayAbility;

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
    /** Paired at setup with a random player of the opposing alignment (the Evil Twin). */
    twinWith?: 'good';
  };
}

export interface DayAbility {
  /** Who is offered the action: "any living player", "any dead player"... — the same for real and bluffers. */
  offeredTo: 'alive' | 'dead';
  /** A private action (Savant, Artist): offered only to those who believe they are this character. */
  private?: boolean;
  /** How many players it points at (0 for a bare statement). */
  targets: number;
  /** A statement is part of the action (Gossip, Savant...). */
  statement?: boolean;
  /** Days on which it is offered (Juggler: only day 1). Default: any. */
  onlyDay?: number;
  /** Extra limits (Moonchild: only right after dying). Return false to hide the action. */
  available?(state: GameState, self: PlayerState): boolean;
  /** Uses the action. `self` is whoever pressed it, real or not; check self.character. */
  use(state: GameState, self: PlayerState, targets: string[], payload: Record<string, unknown>): void;
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
