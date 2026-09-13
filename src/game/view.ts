import { CHARACTERS } from './characters.js';
import type { GameState, Nomination, NominationState, Phase, SuperlativeResult } from './types.js';

export interface PublicPlayerView {
  id: string;
  name: string;
  seat: number;
  alive: boolean;
  connected: boolean;
  isSelf: boolean;
  character?: string;
  characterName?: string;
}

export interface NightTurnChoice {
  id: string;
  name: string;
  seat: number;
}

export interface NightTurnView {
  kind: 'real' | 'decoy';
  shape: 'info' | 'choose';
  title: string;
  body: string;
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
  currentVoterId: string | null;
  currentVoterName: string | null;
  voterDeadline: number | null;
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
  publicLog: string[];
  myCharacter: { id: string; name: string; ability: string; alignment: string } | null;
  myLog: { night: number; text: string }[];
  mySlayerUsed: boolean;
  amIAlive: boolean;
  leftNeighborName: string | null;
  rightNeighborName: string | null;
  nightTurn: NightTurnView | null;
  waitingForOthers: boolean;
  nomination: NominationView | null;
  onBlockId: string | null;
  winner: string | null;
  superlatives: SuperlativeResult[];
}

function buildNightTurn(state: GameState, viewerId: string): NightTurnView | null {
  const t = state.pendingRealTurn;
  if (t && t.playerIds.includes(viewerId) && !(viewerId in t.responses)) {
    const choices: NightTurnChoice[] =
      t.shape === 'choose' ? state.players.filter((p) => p.alive).map((p) => ({ id: p.id, name: p.name, seat: p.seat })) : [];
    return { kind: 'real', shape: t.shape, title: 'Your turn', body: t.bodyByPlayer[viewerId] ?? '', min: t.min, max: t.max, choices };
  }
  const d = state.pendingDecoy;
  if (d && d.playerIds.includes(viewerId) && !(viewerId in d.responses)) {
    const choices: NightTurnChoice[] = state.players.filter((p) => p.alive).map((p) => ({ id: p.id, name: p.name, seat: p.seat }));
    return { kind: 'decoy', shape: 'choose', title: 'Your turn', body: d.prompt.question, min: 1, max: 1, choices };
  }
  return null;
}

function buildSuperlatives(state: GameState): SuperlativeResult[] {
  return Object.entries(state.superlativeTally).map(([question, tally]) => ({ question, tally }));
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

function buildNomination(state: GameState, nom: Nomination): NominationView {
  return {
    nominatorId: nom.nominatorId,
    nominatorName: state.players.find((p) => p.id === nom.nominatorId)?.name ?? '',
    nomineeId: nom.nomineeId,
    nomineeName: state.players.find((p) => p.id === nom.nomineeId)?.name ?? '',
    state: nom.state,
    phaseEndsAt: nom.phaseEndsAt,
    currentVoterId: nom.currentVoterId,
    currentVoterName: nom.currentVoterId ? state.players.find((p) => p.id === nom.currentVoterId)?.name ?? null : null,
    voterDeadline: nom.voterDeadline,
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
      character: charId,
      characterName: charId ? CHARACTERS[charId].name : undefined,
    };
  });

  const nomination = state.currentNomination ? buildNomination(state, state.currentNomination) : null;
  const nightTurn = state.phase === 'night' ? buildNightTurn(state, viewerId) : null;
  const neighbors = seatNeighbors(state, viewerId);

  return {
    code: state.code, phase: state.phase, night: state.night, day: state.day,
    hostId: state.hostId, selfId: viewerId, players, publicLog: state.publicLog,
    myCharacter: self ? { id: self.perceived, name: CHARACTERS[self.perceived].name, ability: CHARACTERS[self.perceived].ability, alignment: self.alignment } : null,
    myLog: self ? self.log : [],
    mySlayerUsed: self?.slayerUsed ?? false,
    amIAlive: self?.alive ?? false,
    leftNeighborName: neighbors.left,
    rightNeighborName: neighbors.right,
    nightTurn,
    waitingForOthers: state.phase === 'night' && !nightTurn && !!self?.alive,
    nomination,
    onBlockId: state.onBlockId,
    winner: state.winner,
    superlatives: revealAll ? buildSuperlatives(state) : [],
  };
}
