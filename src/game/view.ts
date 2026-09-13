import { CHARACTERS } from './characters.js';
import type { GameState, Msg, Nomination, NominationState, Phase, PlayerState } from './types.js';

function msg(key: string, vars?: Record<string, string | number | string[]>): Msg {
  return vars ? { key, vars } : { key };
}

export interface PublicPlayerView {
  id: string;
  name: string;
  seat: number;
  alive: boolean;
  connected: boolean;
  isSelf: boolean;
  hasDeclaredSeating: boolean;
  /** Who this player currently says is sitting to their right — public (it's physical seating, not a secret), used to draw the seating circle. */
  declaredRightId: string | null;
  character?: string;
  characterName?: string;
}

export interface NightTurnChoice {
  id: string;
  name: string;
  seat: number;
}

export interface NightTurnView {
  shape: 'info' | 'choose';
  title: string;
  body: Msg;
  min: number;
  max: number;
  choices: NightTurnChoice[];
}

export interface NominationView {
  nominatorId: string;
  nominatorName: string;
  nomineeId: string;
  nomineeName: string;
  state: NominationState;
  phaseEndsAt: number;
  /** Ids of everyone (living or dead) who has signaled they're ready for the upcoming speech. Only meaningful while state is readyForAccusation/readyForDefense. */
  readyBy: string[];
  currentVoterId: string | null;
  currentVoterName: string | null;
  voterDeadline: number | null;
  /** Seating order the vote goes around in, so the client can render everyone's vote as a list. */
  voteOrder: { id: string; name: string }[];
  votes: Record<string, boolean>;
}

export interface GameView {
  code: string;
  phase: Phase;
  night: number;
  day: number;
  hostId: string;
  selfId: string;
  players: PublicPlayerView[];
  publicLog: Msg[];
  myCharacter: { id: string; name: string; ability: string; alignment: string } | null;
  myLog: { night: number; msg: Msg }[];
  mySlayerUsed: boolean;
  myGhostVoteUsed: boolean;
  amIAlive: boolean;
  leftNeighborName: string | null;
  rightNeighborName: string | null;
  seatingConfirmed: boolean;
  mySeatRightId: string | null;
  endDayReadyNames: string[];
  endDayReadyCount: number;
  endDayAliveCount: number;
  myEndDayReady: boolean;
  nightTurn: NightTurnView | null;
  /** The outcome of a "choose" ability that produces information (Fortune Teller, Ravenkeeper),
   * shown right after answering — otherwise it would only ever surface later in myLog. */
  nightResult: Msg | null;
  /** Personalized "You died tonight." / "You survived the night." — only set once day begins. */
  dawnMessage: Msg | null;
  /** "The village executed you." / "X was executed." / "Nobody has been killed today..." — only set once night begins. */
  duskMessage: Msg | null;
  waitingForOthers: boolean;
  nomination: NominationView | null;
  onBlockId: string | null;
  winner: string | null;
}

function buildNightTurn(state: GameState, viewerId: string): NightTurnView | null {
  const t = state.pendingRealTurn;
  if (!t || !t.playerIds.includes(viewerId) || viewerId in t.responses) return null;
  const choices: NightTurnChoice[] =
    t.shape === 'choose' ? state.players.filter((p) => p.alive).map((p) => ({ id: p.id, name: p.name, seat: p.seat })) : [];
  return { shape: t.shape, title: 'Your turn', body: t.bodyByPlayer[viewerId] ?? msg('empty'), min: t.min, max: t.max, choices };
}

/** Fixed seating-chart neighbours (not "nearest alive" — a dead player still keeps their chair). */
function seatNeighbors(state: GameState, viewerId: string): { left: string | null; right: string | null } {
  const seated = state.players.slice().sort((a, b) => a.seat - b.seat);
  const idx = seated.findIndex((p) => p.id === viewerId);
  if (idx === -1 || seated.length < 2) return { left: null, right: null };
  const left = seated[(idx - 1 + seated.length) % seated.length];
  const right = seated[(idx + 1) % seated.length];
  return { left: left.name, right: right.name };
}

function buildDawnMessage(self: PlayerState | undefined): Msg | null {
  if (!self) return null;
  if (self.diedTonight) return msg('diedTonight');
  if (self.alive) return msg('survivedNight');
  return null; // already dead from an earlier night/execution — nothing new to announce
}

function buildDuskMessage(state: GameState, self: PlayerState | undefined): Msg | null {
  const executedId = state.lastExecutedId;
  if (!executedId) return msg('noExecutionSleep');
  if (self && self.id === executedId) return msg('executedYou');
  const executed = state.players.find((p) => p.id === executedId);
  return executed ? msg('executedOther', { name: executed.name }) : null;
}

function buildNomination(state: GameState, nom: Nomination): NominationView {
  return {
    nominatorId: nom.nominatorId,
    nominatorName: state.players.find((p) => p.id === nom.nominatorId)?.name ?? '',
    nomineeId: nom.nomineeId,
    nomineeName: state.players.find((p) => p.id === nom.nomineeId)?.name ?? '',
    state: nom.state,
    phaseEndsAt: nom.phaseEndsAt,
    readyBy: nom.readyBy,
    currentVoterId: nom.currentVoterId,
    currentVoterName: nom.currentVoterId ? state.players.find((p) => p.id === nom.currentVoterId)?.name ?? null : null,
    voterDeadline: nom.voterDeadline,
    voteOrder: nom.voteOrder.map((id) => ({ id, name: state.players.find((p) => p.id === id)?.name ?? '' })),
    votes: nom.votes,
  };
}

export function viewFor(state: GameState, viewerId: string): GameView {
  const revealAll = state.phase === 'ended';
  const self = state.players.find((p) => p.id === viewerId);

  const players: PublicPlayerView[] = state.players.map((p) => {
    const isSelf = p.id === viewerId;
    // During the game, a player only ever sees their own *believed* character (perceived) —
    // the Drunk must never learn the truth about themselves before the reveal at game end.
    const charId = revealAll ? p.character : isSelf ? p.perceived : undefined;
    return {
      id: p.id, name: p.name, seat: p.seat, alive: p.alive, connected: p.connected, isSelf,
      // Only "who's on your right" is ever actively asked — the left side is derived via
      // reciprocal auto-fill in declareNeighbor, so it's not part of what counts as "done".
      hasDeclaredSeating: !!p.seatRightId,
      declaredRightId: p.seatRightId,
      character: charId,
      characterName: charId ? CHARACTERS[charId].name : undefined,
    };
  });

  const nomination = state.currentNomination ? buildNomination(state, state.currentNomination) : null;
  const nightTurn = state.phase === 'night' ? buildNightTurn(state, viewerId) : null;
  const nightResult = state.phase === 'night' ? self?.nightResult ?? null : null;
  const dawnMessage = state.phase === 'day' ? buildDawnMessage(self) : null;
  const duskMessage = state.phase === 'night' ? buildDuskMessage(state, self) : null;
  const neighbors = seatNeighbors(state, viewerId);

  return {
    code: state.code, phase: state.phase, night: state.night, day: state.day,
    hostId: state.hostId, selfId: viewerId, players, publicLog: state.publicLog,
    myCharacter: self ? { id: self.perceived, name: CHARACTERS[self.perceived].name, ability: CHARACTERS[self.perceived].ability, alignment: self.alignment } : null,
    myLog: self ? self.log : [],
    mySlayerUsed: self?.slayerUsed ?? false,
    myGhostVoteUsed: self?.ghostVoteUsed ?? false,
    amIAlive: self?.alive ?? false,
    leftNeighborName: neighbors.left,
    rightNeighborName: neighbors.right,
    seatingConfirmed: state.seatingConfirmed,
    mySeatRightId: self?.seatRightId ?? null,
    endDayReadyNames: state.endDayRequestedBy.map((id) => state.players.find((p) => p.id === id)?.name ?? ''),
    endDayReadyCount: state.endDayRequestedBy.length,
    endDayAliveCount: state.players.filter((p) => p.alive).length,
    myEndDayReady: !!self && state.endDayRequestedBy.includes(self.id),
    nightTurn,
    nightResult,
    dawnMessage,
    duskMessage,
    waitingForOthers: state.phase === 'night' && !nightTurn && !nightResult && !!self?.alive,
    nomination,
    onBlockId: state.onBlockId,
    winner: state.winner,
  };
}
