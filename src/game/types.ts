export type Team = 'townsfolk' | 'outsider' | 'minion' | 'demon';
export type Alignment = 'good' | 'evil';

/** A character's id. Any string: the registry (characters.ts) says which ones exist. */
export type CharacterId = string;

export type Phase = 'lobby' | 'night' | 'day' | 'ended';

/**
 * All game narration (log entries, night prompts, dawn/dusk messages, ...) is represented as a
 * message key plus its data, never as a pre-rendered English sentence. The server is otherwise
 * entirely language-agnostic — the client's translation dictionary is the single place that
 * turns a key+vars into an actual sentence, in whichever language the viewer picked.
 */
export interface Msg {
  key: string;
  vars?: Record<string, string | number | string[]>;
}

export interface InfoLogEntry {
  night: number;
  msg: Msg;
}

export interface PlayerState {
  id: string;
  token: string;
  name: string;
  seat: number;
  /**
   * This player's own claim of who sits to their right — the only seating fact anyone declares.
   * "Left" is never stored: it's always derived by finding whoever's seatRightId points back at
   * you. Storing it separately caused a real bug — if X first claims Y as their right (setting
   * Y's stored left to X) and later changes their mind, nothing ever reset Y's stale left value
   * back to whoever legitimately claims Y now, permanently wedging seatingConfirmed to false.
   */
  seatRightId: string | null;
  connected: boolean;
  character: CharacterId;
  /** What this player believes their character is. Only differs from `character` for the Drunk. */
  perceived: CharacterId;
  alignment: Alignment;
  alive: boolean;
  ghostVoteUsed: boolean;
  isRedHerring: boolean;
  diedTonight: boolean;
  virginUsed: boolean;
  slayerUsed: boolean;
  /** Per-character memory for hooks (a Fool's first death used, a Gambler's guess...). */
  flags: Record<string, unknown>;
  log: InfoLogEntry[];
  /**
   * The outcome of a "choose" ability that produces information (Fortune Teller, Ravenkeeper),
   * shown for the rest of the night right after answering. Lives on the player, not on the
   * round: a round only ever has one holder for these abilities, so it advances to the next
   * round the instant they answer — storing the result on the round object would lose it before
   * it was ever shown. Reset to null at the start of each night.
   */
  nightResult: Msg | null;
}

export type NightTurnShape = 'info' | 'choose';

/**
 * One step of the night order (Poisoner, Monk, Imp, ...). Every living player is "woken" at every
 * step: the real actors (`playerIds`) get their real screen, everyone else gets a decoy question
 * of the same shape — so nobody can tell who really acted. As for the Storyteller, a step only
 * happens when its character is in play (and, for the Ravenkeeper, was killed tonight).
 */
export interface PendingRealTurn {
  charId: string;
  /** The real actors this step. */
  playerIds: string[];
  /** Everyone woken this step: the real actors plus every other publicly-alive player. */
  participantIds: string[];
  /** The decoy question shown to each non-actor participant (a client-side question key). */
  decoys: Record<string, string>;
  shape: NightTurnShape;
  min: number;
  max: number;
  /** Per-player prompt, since minion-info/imp differ slightly per recipient. */
  bodyByPlayer: Record<string, Msg>;
  responses: Record<string, string[]>;
  /** When this step opened (ms): nobody may answer until MIN_ANSWER_MS after it. */
  openedAt: number;
  /** The real actor also picks a character (Gambler, Cerenovus, Pit-Hag...). */
  pickCharacter?: boolean;
  optionalCharacter?: boolean;
  /** Which characters the actor may pick (default: the whole script). */
  characterPool?: CharacterId[];
  /** The step gives a result right after answering: decoys show a stand-in result screen. */
  result?: boolean;
}

export type NominationState = 'readyForAccusation' | 'accusing' | 'defending' | 'voting' | 'closed';

export interface Nomination {
  id: string;
  nominatorId: string;
  nomineeId: string;
  state: NominationState;
  /** Absolute epoch ms when the current accusing/defending speech auto-advances. Unused during the ready-gate states and once voting starts. */
  phaseEndsAt: number;
  /**
   * Living players who have signaled they're ready to hear the upcoming speech, while state is
   * 'readyForAccusation'. The accusation's timer only starts once every living
   * player has signaled ready; reset to [] each time a new ready-gate begins.
   */
  readyBy: string[];
  /** Seat order the vote goes around in, starting just after the nominee and ending on the nominee. */
  voteOrder: string[];
  voteIndex: number;
  currentVoterId: string | null;
  /** Absolute epoch ms when the current voter's turn auto-resolves as a "no". */
  voterDeadline: number | null;
  votes: Record<string, boolean>;
  yesCount: number;
}

/** A lasting effect on a player's ability: drunk or poisoned, until a night or while its source lives. */
export interface Effect {
  kind: 'drunk' | 'poisoned';
  target: string;
  /** The player whose ability caused it (null: no source, e.g. permanent). */
  source: string | null;
  sourceChar: string;
  /** Removed when a night begins after this night number (null: until removed). */
  untilNight: number | null;
  /** Ends when dawn breaks (the Pukka's victim is healthy again once dead). */
  untilDawn?: boolean;
  /** Ends the moment the source stops being alive. */
  needsSourceAlive?: boolean;
  /** With needsSourceAlive: the source must also still BE this character (a Poisoner turned into something else stops poisoning). */
  needsSourceChar?: string;
  /** Suspended while the source's own ability doesn't work (a drunk Courtier's target sobers up). */
  needsSourceWorking?: boolean;
  /** Ends the moment the target stops being this character (the Philosopher's chosen character). */
  needsTargetChar?: string;
}

/**
 * Scratch space for the characters' hooks. Every key is listed here so a typo is a compile error and
 * a reader can see all the state the abilities share. "Tonight" and "today" keys are reset by the engine
 * (beginNight / finishNight); the rest persist for the game.
 */
export interface GameData {
  // ---- per night
  /** Players the Innkeeper made safe tonight. */
  safe?: string[];
  /** Demons the Exorcist chose (they do not wake). */
  exorcised?: string[];
  /** Players whose abilities woke tonight (for the Cerenovus/Pit-Hag/Exorcist reasoning). */
  woke?: string[];
  /** The Monk's protected player tonight. */
  monkProtectedId?: string | null;
  /** The Devil's Advocate's protected player. */
  daProtected?: string | null;
  /** The Goon's "first to choose me" has been used tonight. */
  goonUsed?: boolean;
  /** Players who came back to life tonight. */
  resurrected?: string[];
  /** The Witch's cursed player. */
  witchTarget?: string | null;
  /** The Cerenovus' madness: who must claim to be what, set by whom. */
  mad?: { player: string; character: string; by: string } | null;
  madClaimed?: boolean;
  /** A death happened tonight that the Storyteller-facing Sage/Barber logic can't attribute to a normal kill. */
  arbitraryDeaths?: boolean;
  // ---- per day
  /** Players who died today (executions, Slayer...). */
  diedToday?: string[];
  malfunctions?: Record<string, true>;
  demonVotedToday?: boolean;
  minionNominatedToday?: boolean;
  /** The Gossip's true statements to resolve at dusk. */
  gossipTrue?: string[];
  /** The Moonchild's kills to resolve. */
  moonchildKills?: { moonchild: string; target: string }[];
  /** True when the last execution did not kill. */
  executionSurvived?: boolean;
  // ---- for the whole game
  /** The Butler's master (whose vote the Butler must follow). */
  butlerMasterId?: string | null;
  /** How each dead player died. */
  deathCause?: Record<string, string>;
  /** How the Demon last died (execution, virgin, slayer...). */
  demonDeathCause?: string;
  /** The Mastermind's extra day: the day on which the Demon died. */
  finalDay?: number;
}

export interface GameState {
  /** Which script (edition or custom mix) this game uses; see scripts.ts. */
  scriptId: string;
  /** The characters the game is dealt from. */
  scriptChars: string[];
  /** Drunk / poisoned effects beyond the Poisoner's own (see registration.ts). */
  effects: Effect[];
  /** Scratch space for characters' hooks: who is safe tonight, who the Exorcist chose, ... Reset by them. */
  data: GameData;
  code: string;
  hostId: string;
  phase: Phase;
  night: number;
  day: number;
  players: PlayerState[];
  secret: string;
  rngState: number;
  bluffs: CharacterId[];
  deathsTonight: string[];
  nightSlotIndex: number;
  pendingRealTurn: PendingRealTurn | null;
  /** When the current night began (ms), for the minimum night length. */
  nightStartedAt?: number;
  /** How many steps have run so far tonight (the screens' identity — never the character's slot). */
  nightStepNumber?: number;
  /** Each player's most recent "pick a player" decoy question, so the next one is always different. */
  lastDecoyKeys?: Record<string, string>;
  /** Set once everyone has acted: dawn breaks at this time (ms), not the instant the last answer lands. */
  dawnAt?: number | null;
  publicLog: Msg[];
  currentNomination: Nomination | null;
  onBlockId: string | null;
  highestYesToday: number;
  usedNominatorIds: string[];
  usedNomineeIds: string[];
  winner: Alignment | null;
  lastExecutedId: string | null;
  /** True once every player's declared left/right neighbor forms one consistent circle. */
  seatingConfirmed: boolean;
  /** Living players who have agreed to end the day early; the day ends once this covers everyone alive. */
  endDayRequestedBy: string[];
  /** Everything that happened, in order — the end-of-game replay. Secret until the game ends. */
  history: HistoryEvent[];
}

/** One line of the replay. Players and characters are ids; the app words it in either language. */
export interface HistoryEvent {
  seq: number;
  phase: 'setup' | 'night' | 'day';
  night: number;
  day: number;
  type: string;
  vars: Record<string, unknown>;
}

export class GameError extends Error {}
