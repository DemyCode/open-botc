export type Team = 'townsfolk' | 'outsider' | 'minion' | 'demon';
export type Alignment = 'good' | 'evil';

export type CharacterId =
  | 'washerwoman' | 'librarian' | 'investigator' | 'chef' | 'empath'
  | 'fortuneteller' | 'undertaker' | 'monk' | 'ravenkeeper' | 'virgin'
  | 'slayer' | 'soldier' | 'mayor'
  | 'butler' | 'drunk' | 'recluse' | 'saint'
  | 'poisoner' | 'spy' | 'scarletwoman' | 'baron'
  | 'imp';

export type Phase = 'lobby' | 'night' | 'day' | 'ended';

export interface InfoLogEntry {
  night: number;
  text: string;
}

export interface PlayerState {
  id: string;
  token: string;
  name: string;
  seat: number;
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
  log: InfoLogEntry[];
}

export type NightTurnShape = 'info' | 'choose';

export interface PendingRealTurn {
  charId: CharacterId | 'minion-info';
  playerIds: string[];
  shape: NightTurnShape;
  min: number;
  max: number;
  /** Per-player prompt text, since minion-info/imp differ slightly per recipient. */
  bodyByPlayer: Record<string, string>;
  responses: Record<string, string[]>;
  deadline: number;
}

export interface DecoyPrompt {
  id: string;
  question: string;
}

export interface PendingDecoyRound {
  prompt: DecoyPrompt;
  /** Always mirrors this round's real turn shape, so a "select someone" round never gets an "info" decoy or vice versa. */
  shape: NightTurnShape;
  playerIds: string[];
  responses: Record<string, string>;
  deadline: number;
}

export type NominationState = 'accusing' | 'defending' | 'voting' | 'closed';

export interface Nomination {
  id: string;
  nominatorId: string;
  nomineeId: string;
  state: NominationState;
  /** Absolute epoch ms when the current accusing/defending speech auto-advances. Unused once voting starts. */
  phaseEndsAt: number;
  /** Seat order the vote goes around in, starting just after the nominee and ending on the nominee. */
  voteOrder: string[];
  voteIndex: number;
  currentVoterId: string | null;
  /** Absolute epoch ms when the current voter's turn auto-resolves as a "no". */
  voterDeadline: number | null;
  votes: Record<string, boolean>;
  yesCount: number;
}

export interface SuperlativeResult {
  question: string;
  tally: Record<string, number>;
}

export interface GameState {
  code: string;
  hostId: string;
  phase: Phase;
  night: number;
  day: number;
  players: PlayerState[];
  secret: string;
  rngState: number;
  bluffs: CharacterId[];
  poisonedId: string | null;
  monkProtectedId: string | null;
  butlerMasterId: string | null;
  deathsTonight: string[];
  nightSlotIndex: number;
  pendingRealTurn: PendingRealTurn | null;
  pendingDecoy: PendingDecoyRound | null;
  publicLog: string[];
  currentNomination: Nomination | null;
  onBlockId: string | null;
  highestYesToday: number;
  usedNominatorIds: string[];
  usedNomineeIds: string[];
  winner: Alignment | null;
  superlativeTally: Record<string, Record<string, number>>;
  lastExecutedId: string | null;
}

export class GameError extends Error {}
