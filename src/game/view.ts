import { CHARACTERS, type CharacterId } from './characters.js';
import { previewDistribution } from './setup.js';
import {
  alivePlayers,
  playerById,
  seatOrder,
  type GameState,
  type InfoEntry,
  type LogEntry,
  type Phase,
  type PlayerState,
  type RoomOptions,
} from './types.js';

export interface PlayerView {
  id: string;
  name: string;
  seat: number;
  alive: boolean;
  ghostVoteUsed: boolean;
  connected: boolean;
  isHost: boolean;
  isYou: boolean;
  /** Has already nominated today. */
  hasNominated: boolean;
  /** Has already been nominated today. */
  wasNominated: boolean;
  /** During a vote: has this player answered yet? */
  hasVoted?: boolean;
  /** After a vote resolves (and after the game ends): their actual vote. */
  vote?: boolean;
  /** Has this player confirmed their phone buzzes? Shown in the lobby. */
  pushReady: boolean;
  /** Revealed only once the game is over. */
  character?: CharacterId;
  /** Revealed only once the game is over; differs for the Drunk. */
  perceived?: CharacterId;
  alignment?: 'good' | 'evil';
}

export interface SelfView {
  character: CharacterId | null;
  team: string | null;
  ability: string | null;
  alive: boolean;
  ghostVoteUsed: boolean;
  butlerMaster: string | null;
  slayerUsed: boolean;
  canNominate: boolean;
  canVote: boolean;
  canSlay: boolean;
  canOpenNominations: boolean;
  canEndDay: boolean;
  hasRequestedEndDay: boolean;
  isReady: boolean;
  /** This player's private ntfy topic, for building the one-tap subscribe link. */
  ntfyTopic: string | null;
  /** They have confirmed a test notification actually buzzed. */
  pushConfirmed: boolean;
  log: InfoEntry[];
}

export interface PromptView {
  id: string;
  title: string;
  body: string;
  count: number;
  choices: { playerId: string; label: string; disabled?: boolean; reason?: string }[];
  secondsLeft: number;
}

export interface NominationView {
  nominatorId: string;
  nomineeId: string;
  stage: 'accuser' | 'accusee' | 'voting' | 'result';
  yes?: number;
  required?: number;
  onBlock?: boolean;
  tied?: boolean;
  /** Sequential mode: whose turn it is to vote. */
  currentVoterId?: string;
}

export interface GameView {
  code: string;
  phase: Phase;
  night: number;
  day: number;
  youId: string;
  hostId: string;
  players: PlayerView[];
  self: SelfView;
  prompt: PromptView | null;
  nomination: NominationView | null;
  onTheBlock: string | null;
  voteBar: number;
  requiredVotes: number;
  endDayVotes: number;
  endDayNeeded: number;
  log: LogEntry[];
  phaseSecondsLeft: number | null;
  /** True while the night is running and it is somebody else's turn. */
  nightWaiting: boolean;
  winner: 'good' | 'evil' | null;
  winReason: string | null;
  options: RoomOptions;
  /** Lobby only: what the deal will look like. */
  preview: { townsfolk: number; outsider: number; minion: number; demon: number } | null;
  readyCount: number;
  /** Revealed once the game is over. */
  grimoire: GrimoireRow[] | null;
  scriptName: string;
}

export interface GrimoireRow {
  playerId: string;
  name: string;
  seat: number;
  character: CharacterId;
  perceived: CharacterId;
  alignment: 'good' | 'evil';
  alive: boolean;
  redHerring: boolean;
}

function secondsLeft(deadline: number | null, now: number): number | null {
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function viewFor(s: GameState, playerId: string, now = Date.now()): GameView {
  const you = playerById(s, playerId);
  const over = s.phase === 'over';
  const dayRunning = s.phase === 'day' || s.phase === 'nominations';

  const votes = s.nomination?.votes ?? {};
  const showVotes = over || s.nomination?.stage === 'result';

  const players: PlayerView[] = seatOrder(s).map((p) => {
    const v: PlayerView = {
      id: p.id,
      name: p.name,
      seat: p.seat,
      alive: p.alive,
      ghostVoteUsed: p.ghostVoteUsed,
      connected: p.connected,
      isHost: p.id === s.hostId,
      isYou: p.id === playerId,
      hasNominated: s.hasNominated.includes(p.id),
      wasNominated: s.hasBeenNominated.includes(p.id),
      pushReady: !!p.push?.confirmed,
    };
    if (s.phase === 'voting' || s.nomination) {
      v.hasVoted = p.id in votes;
      if (showVotes && p.id in votes) v.vote = votes[p.id];
    }
    if (over && p.character) {
      v.character = p.character;
      v.perceived = p.perceived ?? p.character;
      v.alignment = p.alignment;
    }
    return v;
  });

  const perceived = you?.perceived ?? null;
  const canSlay =
    !!you &&
    you.alive &&
    perceived === 'slayer' &&
    !you.slayerUsed &&
    dayRunning;

  const eligibleToVote = !!you && (you.alive || !you.ghostVoteUsed);
  const inVoteOrder = s.nomination ? s.nomination.voteOrder.includes(playerId) : false;
  const sequentialTurn =
    s.options.votingMode === 'sequential' &&
    !!s.nomination &&
    s.nomination.voteOrder[s.nomination.voteIndex] === playerId;

  const canVote =
    s.phase === 'voting' &&
    eligibleToVote &&
    !(playerId in votes) &&
    (s.options.votingMode === 'sequential' ? sequentialTurn : inVoteOrder);

  const self: SelfView = {
    character: perceived,
    team: perceived ? CHARACTERS[perceived].team : null,
    ability: perceived ? CHARACTERS[perceived].ability : null,
    alive: you?.alive ?? true,
    ghostVoteUsed: you?.ghostVoteUsed ?? false,
    butlerMaster: perceived === 'butler' ? you?.butlerMaster ?? null : null,
    slayerUsed: you?.slayerUsed ?? false,
    canNominate:
      s.phase === 'nominations' &&
      !!you &&
      you.alive &&
      !s.hasNominated.includes(playerId),
    canVote,
    canSlay,
    canOpenNominations: s.phase === 'day' && !!you && you.alive,
    canEndDay: dayRunning && !!you && you.alive,
    hasRequestedEndDay: s.endDayVotes.includes(playerId),
    isReady: s.ready.includes(playerId),
    ntfyTopic: you?.push?.ntfyTopic ?? null,
    pushConfirmed: !!you?.push?.confirmed,
    log: you?.log ?? [],
  };

  const prompt =
    s.pending && s.pending.playerId === playerId
      ? {
          id: s.pending.id,
          title: s.pending.title,
          body: s.pending.body,
          count: s.pending.count,
          choices: s.pending.choices,
          secondsLeft: secondsLeft(s.pending.deadline, now) ?? 0,
        }
      : null;

  const nomination: NominationView | null = s.nomination
    ? {
        nominatorId: s.nomination.nominatorId,
        nomineeId: s.nomination.nomineeId,
        stage: s.nomination.stage,
        yes: s.nomination.result?.yes,
        required: s.nomination.result?.required,
        onBlock: s.nomination.result?.onBlock,
        tied: s.nomination.result?.tied,
        currentVoterId:
          s.options.votingMode === 'sequential'
            ? s.nomination.voteOrder[s.nomination.voteIndex]
            : undefined,
      }
    : null;

  const grimoire: GrimoireRow[] | null = s.finalGrimoire
    ? seatOrder(s).map((p) => ({
        playerId: p.id,
        name: p.name,
        seat: p.seat,
        character: p.character!,
        perceived: p.perceived ?? p.character!,
        alignment: p.alignment,
        alive: p.alive,
        redHerring: p.redHerring,
      }))
    : null;

  return {
    code: s.code,
    phase: s.phase,
    night: s.night,
    day: s.day,
    youId: playerId,
    hostId: s.hostId,
    players,
    self,
    prompt,
    nomination,
    onTheBlock: s.onTheBlock,
    voteBar: s.voteBar,
    requiredVotes: Math.ceil(alivePlayers(s).length / 2),
    endDayVotes: s.endDayVotes.length,
    endDayNeeded: Math.ceil(alivePlayers(s).length / 2),
    log: s.log.slice(-80),
    phaseSecondsLeft: secondsLeft(s.phaseDeadline, now),
    nightWaiting: s.phase === 'night' && (!s.pending || s.pending.playerId !== playerId),
    winner: s.winner,
    winReason: s.winReason,
    options: s.options,
    preview: s.phase === 'lobby' ? previewDistribution(s.players.length) : null,
    readyCount: s.ready.length,
    grimoire,
    scriptName: 'Trouble Brewing',
  };
}

/** Static character data, served once to the client. */
export function characterCatalogue() {
  return Object.values(CHARACTERS).map((c) => ({
    id: c.id,
    name: c.name,
    team: c.team,
    ability: c.ability,
    emoji: c.emoji,
    setup: c.setup ?? null,
    firstNight: c.firstNight,
    otherNight: c.otherNight,
  }));
}

export type { PlayerState };
