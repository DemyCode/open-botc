import { CHARACTERS } from './characters.js';
import { offeredActions, type OfferedAction } from './dayactions.js';
import { nominationRefusal, slayerShotRefusal } from './offers.js';
import { msg } from './messages.js';
import { MIN_ANSWER_MS, canPick, characterChoices } from './night.js';
import type { GameState, HistoryEvent, Msg, NightScreenKind, Nomination, NominationState, Phase, PlayerState } from './types.js';

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
  /** All public, table-visible facts: whether a dead player still holds their one ghost vote,
   * and whether they've already nominated someone / already been nominated today — in the
   * physical game these are all things anyone at the table can plainly see. */
  ghostVoteUsed: boolean;
  hasNominatedToday: boolean;
  hasBeenNominatedToday: boolean;
}

export interface NightTurnChoice {
  id: string;
  name: string;
  seat: number;
  alive: boolean;
  /** The ability cannot pick this player (only ever set on a real actor's screen). */
  disabled?: boolean;
}

/**
 * One night screen: answered with exactly ONE tap (a player, a character, "No one" or "Got it"), so
 * every phone is tapped the same number of times. A `tip` carries nothing about the game: the app
 * shows a random tip or glossary entry from the script.
 */
export interface NightTurnView {
  kind: NightScreenKind;
  /** The prompt (pick/character) or the information (info/result); null for a tip. */
  body: Msg | null;
  /** pick: the players (any, dead or alive, yourself included unless the ability says otherwise). */
  choices: NightTurnChoice[];
  /** pick: who this ability has already picked this step, in order. */
  picked: { id: string; name: string }[];
  /** pick: this is pick number `index + 1` of at most `total`. */
  index: number;
  total: number;
  /** pick/character: "No one" is a valid answer. */
  canSkip: boolean;
  /** character: the characters that may be named. */
  characters: { id: string; name: string; team: string }[];
  /** Identifies this screen — changes at every round of every step, even when two screens look the same. */
  stepKey: string;
  /** How long (ms) until this screen may be answered (see MIN_ANSWER_MS). */
  waitMs: number;
}

export interface NominationView {
  nominatorId: string;
  nominatorName: string;
  nomineeId: string;
  nomineeName: string;
  state: NominationState;
  phaseEndsAt: number;
  /** Ids of everyone (living or dead) who has signaled they're ready for the upcoming speech. Only meaningful while state is readyForAccusation. */
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
  /** The script (edition or custom mix) and the characters it holds — public, chosen in the lobby. */
  script: { id: string; characters: string[] };
  phase: Phase;
  night: number;
  day: number;
  hostId: string;
  selfId: string;
  players: PublicPlayerView[];
  publicLog: Msg[];
  myCharacter: { id: string; name: string; ability: string; alignment: string } | null;
  myLog: { night: number; msg: Msg }[];
  /** The Slayer shot is on offer to this player (the same for everyone, so it proves nothing about who the Slayer is). */
  slayerShotAvailable: boolean;
  /** This player may nominate right now, and whom (the client just renders these). */
  canNominate: boolean;
  nominatableIds: string[];
  /** Day abilities this player may claim right now (see dayactions.ts). */
  myDayActions: OfferedAction[];
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
  /** Personalized "You died tonight." / "You survived the night." — only set once day begins. */
  dawnMessage: Msg | null;
  /** "The village executed you." / "X was executed." / "Nobody has been killed today..." — only set once night begins. */
  duskMessage: Msg | null;
  waitingForOthers: boolean;
  nomination: NominationView | null;
  onBlockId: string | null;
  winner: string | null;
  /** Everything that happened, in order — only once the game is over (it holds the secrets). */
  replay: HistoryEvent[] | null;
}

/**
 * Whether `p`'s death, if any, is something anyone without special knowledge would currently
 * know about. A death from an earlier night/day is old, already-announced public information; a
 * death *tonight* is not — the Storyteller never reveals a night kill until dawn, so until then
 * everyone (including, per amIAlive below, the victim themselves) must still see them as alive.
 */
function publiclyAlive(p: PlayerState): boolean {
  return p.alive || p.diedTonight;
}

/**
 * The alignment a player is shown on their own card: the one that goes with who they THINK they are.
 * The Lunatic believes they are the (evil) Demon — a card reading "Imp · good" would tell them the truth.
 */
function believedAlignment(p: PlayerState, revealAll: boolean): string {
  const thinks = CHARACTERS[p.character]?.hooks?.setup?.thinksTheyAre;
  if (revealAll || !thinks || p.perceived === p.character) return p.alignment;
  return thinks === 'minion' || thinks === 'demon' ? 'evil' : 'good';
}

function buildNightTurn(state: GameState, viewerId: string): NightTurnView | null {
  const t = state.pendingRealTurn;
  if (!t || !t.participantIds.includes(viewerId) || viewerId in t.responses) return null;
  const screen = t.screens[viewerId] ?? { kind: 'tip' };
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? '';
  const choices: NightTurnChoice[] =
    screen.kind === 'pick'
      ? state.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat, alive: publiclyAlive(p), ...(canPick(state, t, viewerId, p.id) ? {} : { disabled: true }) }))
      : [];
  return {
    kind: screen.kind,
    body: screen.body ?? null,
    choices,
    picked: screen.kind === 'pick' ? (t.progress[viewerId]?.targets ?? []).map((id) => ({ id, name: nameOf(id) })) : [],
    index: screen.index ?? 0,
    total: screen.total ?? 0,
    canSkip: !!screen.canSkip,
    characters: screen.kind === 'character' ? characterChoices(state, t, viewerId).map((id) => ({ id, name: CHARACTERS[id].name, team: CHARACTERS[id].team })) : [],
    stepKey: `${state.night}-${state.nightStepNumber ?? 0}-${t.round}`,
    waitMs: Math.max(0, t.openedAt + MIN_ANSWER_MS - Date.now()),
  };
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

  // A death tonight stays hidden until dawn in EVERY place a phone can read it — not only in the
  // screens the app draws. The Ravenkeeper (or a Drunk who thinks so) sees their own death at once.
  const revealsOwnDeath = !!self && !!CHARACTERS[self.perceived]?.hooks?.night?.wakesWhenDead;
  const shownAlive = (p: PlayerState): boolean =>
    state.phase === 'night' && !(p.id === viewerId && revealsOwnDeath) ? publiclyAlive(p) : p.alive;

  const players: PublicPlayerView[] = state.players.map((p) => {
    const isSelf = p.id === viewerId;
    // During the game, a player only ever sees their own *believed* character (perceived) —
    // the Drunk must never learn the truth about themselves before the reveal at game end.
    const charId = revealAll ? p.character : isSelf ? p.perceived : undefined;
    return {
      id: p.id, name: p.name, seat: p.seat, alive: shownAlive(p), connected: p.connected, isSelf,
      // Only "who's on your right" is ever actively asked — the left side is derived via
      // reciprocal auto-fill in declareNeighbor, so it's not part of what counts as "done".
      hasDeclaredSeating: !!p.seatRightId,
      declaredRightId: p.seatRightId,
      character: charId,
      characterName: charId ? CHARACTERS[charId].name : undefined,
      ghostVoteUsed: p.ghostVoteUsed,
      hasNominatedToday: state.usedNominatorIds.includes(p.id),
      hasBeenNominatedToday: state.usedNomineeIds.includes(p.id),
    };
  });

  const nomination = state.currentNomination ? buildNomination(state, state.currentNomination) : null;
  const nightTurn = state.phase === 'night' ? buildNightTurn(state, viewerId) : null;
  const dawnMessage = state.phase === 'day' ? buildDawnMessage(self) : null;
  const duskMessage = state.phase === 'night' ? buildDuskMessage(state, self) : null;
  const neighbors = seatNeighbors(state, viewerId);

  // A player must not learn they died tonight before dawn does — same as everyone else. This
  // only ever needs to hide anything while it's still night: diedTonight isn't reset until the
  // *next* beginNight, so by day it would otherwise still (wrongly) be hiding a death that dawn
  // has already revealed. The Ravenkeeper is the deliberate exception: being woken at all only
  // happens *because* they just died, so for them (or a Drunk perceiving Ravenkeeper) the death
  // is the whole point of the turn they're currently being given, not something to hide.
  const amIAlive = self ? shownAlive(self) : false;

  return {
    code: state.code, script: { id: state.scriptId, characters: state.scriptChars }, phase: state.phase, night: state.night, day: state.day,
    hostId: state.hostId, selfId: viewerId, players, publicLog: state.publicLog,
    myCharacter: self ? { id: self.perceived, name: CHARACTERS[self.perceived].name, ability: CHARACTERS[self.perceived].ability, alignment: believedAlignment(self, revealAll) } : null,
    myLog: self ? self.log : [],
    slayerShotAvailable: !!self && slayerShotRefusal(state, self) === null,
    canNominate: !!self && nominationRefusal(state, self) === null,
    nominatableIds: self && nominationRefusal(state, self) === null ? state.players.filter((p) => nominationRefusal(state, self, p) === null).map((p) => p.id) : [],
    myDayActions: self ? offeredActions(state, self) : [],
    myGhostVoteUsed: self?.ghostVoteUsed ?? false,
    amIAlive,
    leftNeighborName: neighbors.left,
    rightNeighborName: neighbors.right,
    seatingConfirmed: state.seatingConfirmed,
    mySeatRightId: self?.seatRightId ?? null,
    endDayReadyNames: state.endDayRequestedBy.map((id) => state.players.find((p) => p.id === id)?.name ?? ''),
    endDayReadyCount: state.endDayRequestedBy.length,
    endDayAliveCount: state.players.filter((p) => p.alive).length,
    myEndDayReady: !!self && state.endDayRequestedBy.includes(self.id),
    nightTurn,
    dawnMessage,
    duskMessage,
    waitingForOthers: state.phase === 'night' && !nightTurn && amIAlive,
    nomination,
    onBlockId: state.onBlockId,
    winner: state.winner,
    replay: state.phase === 'ended' ? state.history : null,
  };
}
