import type { CharacterId } from './characters.js';

export type Alignment = 'good' | 'evil';

export type Phase =
  /** Waiting for players to join. */
  | 'lobby'
  /** Characters are being dealt / players reading their role. */
  | 'reveal'
  /** Night actions resolving in official order. */
  | 'night'
  /** Deaths announced, everybody reads the morning report. */
  | 'dawn'
  /** Free discussion. Nobody's phone needs them. */
  | 'day'
  /** Nominations are open. */
  | 'nominations'
  /** A nomination is live: accuser or accusee is speaking. */
  | 'speech'
  /** Voting on the live nomination. */
  | 'voting'
  /** Execution announced. */
  | 'dusk'
  /** Game finished. */
  | 'over';

export interface RoomOptions {
  /** Seconds players get to read their character before the first night. */
  revealSeconds: number;
  /** Seconds a player has to answer a night prompt before it auto-resolves. */
  nightPromptSeconds: number;
  /** Seconds each of the accuser / accusee gets to speak. */
  speechSeconds: number;
  /** Seconds to vote on a nomination. */
  voteSeconds: number;
  /** Seconds the morning report is shown before free discussion starts. */
  dawnSeconds: number;
  /** Length of free discussion before nominations may open. 0 = immediately. */
  discussionSeconds: number;
  /** 'simultaneous' = everyone votes at once. 'sequential' = around the circle. */
  votingMode: 'simultaneous' | 'sequential';
  /**
   * If true, the Drunk registers as their fake Townsfolk character to other
   * players' abilities (softer, preserves the bluff). If false (official), the
   * Drunk registers as the Drunk.
   */
  drunkShowsAsFake: boolean;
  /** Probability the Recluse registers as evil when it could matter. */
  recluseMisregisterChance: number;
  /** Probability the Spy registers as good when it could matter. */
  spyMisregisterChance: number;
  /** Probability the Mayor's night death bounces to another player. */
  mayorBounceChance: number;
  /** Characters excluded from the deal (by player agreement). */
  banned: CharacterId[];
}

export const DEFAULT_OPTIONS: RoomOptions = {
  revealSeconds: 30,
  nightPromptSeconds: 75,
  speechSeconds: 60,
  voteSeconds: 30,
  dawnSeconds: 25,
  discussionSeconds: 0,
  votingMode: 'simultaneous',
  drunkShowsAsFake: false,
  recluseMisregisterChance: 0.5,
  spyMisregisterChance: 0.5,
  mayorBounceChance: 0.5,
  banned: [],
};

/** A private piece of information delivered to one player. */
export interface InfoEntry {
  id: string;
  night: number;
  /** Short heading, e.g. "Empath". */
  title: string;
  /** Human-readable body. */
  body: string;
  /** Players this info points at, for highlighting in the UI. */
  players?: string[];
  /** Character this info names, for showing the token. */
  character?: CharacterId;
  ts: number;
}

export interface PushTarget {
  /**
   * Secret ntfy topic, generated for this player when they join. This is the
   * primary channel: it buzzes a locked phone without needing HTTPS.
   */
  ntfyTopic?: string;
  /** Web Push subscription. A bonus when the server is behind TLS. */
  webPush?: unknown;
  /** The player pressed "yes, it buzzed" after a test notification. */
  confirmed?: boolean;
}

export interface PlayerState {
  id: string;
  /** Secret reconnect token. Never sent to other players. */
  token: string;
  name: string;
  /** Position in the circle; determines neighbours for Chef / Empath. */
  seat: number;
  connected: boolean;
  lastSeen: number;

  /** True character. Null until the game starts. */
  character: CharacterId | null;
  /** Character the player believes they are. Differs only for the Drunk. */
  perceived: CharacterId | null;
  alignment: Alignment;
  alive: boolean;
  ghostVoteUsed: boolean;

  // ---- statuses
  /** Poisoned tonight and through tomorrow's day. Cleared at the next dusk. */
  poisoned: boolean;
  /** Monk protection. Cleared at dawn. */
  protected: boolean;
  /** The Fortune Teller's red herring. */
  redHerring: boolean;
  virginUsed: boolean;
  slayerUsed: boolean;
  /** The Butler's chosen master for the coming day. */
  butlerMaster: string | null;
  /** Set when the player is killed during the night; drives the Ravenkeeper. */
  diedTonight: boolean;

  log: InfoEntry[];
  push?: PushTarget;
}

export type StepKind = 'minion_info' | 'demon_info' | 'character';

export interface NightStep {
  id: string;
  order: number;
  kind: StepKind;
  character?: CharacterId;
  /** Owner of a character step. */
  playerId?: string;
  /** Recipients of a group step. */
  playerIds?: string[];
}

export interface PromptChoice {
  playerId: string;
  label: string;
  disabled?: boolean;
  reason?: string;
}

export interface Prompt {
  id: string;
  playerId: string;
  stepId: string;
  character: CharacterId | null;
  title: string;
  body: string;
  count: number;
  choices: PromptChoice[];
  deadline: number;
}

export interface Nomination {
  nominatorId: string;
  nomineeId: string;
  stage: 'accuser' | 'accusee' | 'voting' | 'result';
  /** playerId → true (yes) / false (no). Missing = not yet voted. */
  votes: Record<string, boolean>;
  /** Sequential mode: the order phones are asked, starting left of the nominee. */
  voteOrder: string[];
  voteIndex: number;
  result?: {
    yes: number;
    required: number;
    onBlock: boolean;
    tied: boolean;
  };
}

export interface LogEntry {
  id: string;
  ts: number;
  /** Which in-game day/night this belongs to. */
  phase: Phase;
  night: number;
  day: number;
  text: string;
  /** Rendered with emphasis in the client. */
  important?: boolean;
}

export type OutEvent =
  | {
      k: 'buzz';
      playerIds: string[];
      title: string;
      body: string;
      pattern: number[];
      /** Send an OS-level push (web push / ntfy) as well as an in-page buzz. */
      push: boolean;
      /** Tag so repeat notifications replace rather than stack. */
      tag?: string;
    }
  | { k: 'gameover' };

export interface GameState {
  code: string;
  createdAt: number;
  updatedAt: number;
  hostId: string;
  phase: Phase;
  /** 1-based. 0 while in the lobby. */
  night: number;
  day: number;
  players: PlayerState[];
  options: RoomOptions;
  rng: number;
  /** Per-game secret mixed into misregistration hashing. */
  secret: string;

  // ---- night
  steps: NightStep[];
  stepIndex: number;
  pending: Prompt | null;
  /** Deaths accumulated during the night, announced at dawn. */
  pendingDeaths: string[];
  /** Who the Imp targeted this night (for the star-pass check). */
  impTarget: string | null;

  /** Three good characters not in play, shown to the Demon on night 1. */
  demonBluffs: CharacterId[];
  /** The Townsfolk token the Drunk is holding, if any. */
  drunkFake: CharacterId | null;

  // ---- day
  hasNominated: string[];
  hasBeenNominated: string[];
  nomination: Nomination | null;
  /** Player currently due to be executed at dusk. */
  onTheBlock: string | null;
  /** Highest vote count reached today; a nominee must beat it to take the block. */
  voteBar: number;
  /** Living players who have asked to end the day. */
  endDayVotes: string[];
  /** Player executed today, for the Undertaker. Null if nobody was. */
  executedToday: string | null;
  executionHappened: boolean;
  /** Players who tapped "ready" during the reveal phase. */
  ready: string[];

  phaseDeadline: number | null;
  log: LogEntry[];
  outbox: OutEvent[];
  winner: Alignment | null;
  winReason: string | null;
  /** Set once the game ends so the full grimoire can be revealed. */
  finalGrimoire: boolean;
}

export function alivePlayers(s: GameState): PlayerState[] {
  return s.players.filter((p) => p.alive);
}

export function playerById(s: GameState, id: string): PlayerState | undefined {
  return s.players.find((p) => p.id === id);
}

export function seatOrder(s: GameState): PlayerState[] {
  return s.players.slice().sort((a, b) => a.seat - b.seat);
}
