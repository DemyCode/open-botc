import { alignmentOfCharacter, CHARACTERS } from './characters.js';
import { appendLog, beginNight, tick as nightTick } from './night.js';
import { abilityWorks, registersAs } from './registration.js';
import { randomId } from './rng.js';
import { dealCharacters } from './setup.js';
import type { GameState, Nomination, PlayerState } from './types.js';
import { GameError } from './types.js';

export { submitDecoyResponse, submitRealResponse } from './night.js';

const ACCUSE_MS = 45_000;
const DEFEND_MS = 45_000;
const VOTER_TIMEOUT_MS = 15_000;

function findPlayer(state: GameState, id: string): PlayerState {
  const p = state.players.find((pl) => pl.id === id);
  if (!p) throw new GameError(`Unknown player ${id}`);
  return p;
}

export function createGame(code: string): GameState {
  return {
    code, hostId: '', phase: 'lobby', night: 0, day: 0, players: [],
    secret: randomId() + randomId(), rngState: 0, bluffs: [],
    poisonedId: null, monkProtectedId: null, butlerMasterId: null,
    deathsTonight: [], nightSlotIndex: -1, pendingRealTurn: null, pendingDecoy: null,
    publicLog: [], currentNomination: null, onBlockId: null, highestYesToday: 0,
    usedNominatorIds: [], usedNomineeIds: [], winner: null, superlativeTally: {},
    lastExecutedId: null,
  };
}

export function addPlayer(state: GameState, name: string): PlayerState {
  if (state.phase !== 'lobby') throw new GameError('Game already started');
  const player: PlayerState = {
    id: randomId(), token: randomId() + randomId(), name, seat: state.players.length, connected: true,
    character: 'soldier', perceived: 'soldier', alignment: 'good', alive: true,
    ghostVoteUsed: false, isRedHerring: false, diedTonight: false,
    virginUsed: false, slayerUsed: false, log: [],
  };
  state.players.push(player);
  if (!state.hostId) state.hostId = player.id;
  return player;
}

export function findPlayerByToken(state: GameState, token: string): PlayerState | undefined {
  return state.players.find((p) => p.token === token);
}

export function startGame(state: GameState): void {
  if (state.phase !== 'lobby') throw new GameError('Game already started');
  const deal = dealCharacters(state.players.map((p) => p.id), state.secret);
  for (const p of state.players) {
    p.character = deal.characters[p.id];
    p.perceived = deal.perceived[p.id];
    p.alignment = alignmentOfCharacter(p.character);
    p.isRedHerring = deal.redHerringId === p.id;
  }
  state.bluffs = deal.bluffs;
  beginNight(state);
}

function setWinner(state: GameState, alignment: 'good' | 'evil', message: string): void {
  if (state.winner) return;
  state.winner = alignment;
  state.phase = 'ended';
  state.publicLog.push(message);
}

function evaluateWin(state: GameState): void {
  if (state.winner) return;
  const alive = state.players.filter((p) => p.alive);
  const demonAlive = alive.some((p) => CHARACTERS[p.character].team === 'demon');
  if (!demonAlive) {
    setWinner(state, 'good', 'The Demon is dead — good wins!');
    return;
  }
  if (alive.length <= 2) {
    setWinner(state, 'evil', 'Only 2 players remain with the Demon alive — evil wins!');
  }
}

function checkDemonDeathPromotion(state: GameState, deadPlayer: PlayerState | null): void {
  if (!deadPlayer || CHARACTERS[deadPlayer.character].team !== 'demon') return;
  const aliveCount = state.players.filter((p) => p.alive).length;
  const sw = state.players.find((p) => p.alive && p.character === 'scarletwoman');
  if (sw && aliveCount >= 5 && abilityWorks(state, sw)) {
    sw.character = 'imp';
    sw.perceived = 'imp';
    appendLog(state, sw.id, 'The Demon has died — you are now the Imp.');
  }
}

function executePlayer(state: GameState, targetId: string): void {
  const p = findPlayer(state, targetId);
  p.alive = false;
  state.lastExecutedId = targetId;
  state.publicLog.push(`${p.name} was executed.`);
  if (p.character === 'saint' && abilityWorks(state, p)) {
    setWinner(state, 'evil', `${p.name} was the Saint — evil wins!`);
    return;
  }
  checkDemonDeathPromotion(state, p);
  evaluateWin(state);
}

export function useSlayer(state: GameState, slayerId: string, targetId: string): void {
  if (state.phase !== 'day') throw new GameError('Slayer can only be used during the day');
  const self = findPlayer(state, slayerId);
  if (!self.alive) throw new GameError('Dead players cannot use the Slayer shot');
  if (self.character !== 'slayer') throw new GameError('You are not the Slayer');
  if (self.slayerUsed) throw new GameError('Slayer shot already used');
  self.slayerUsed = true;
  const target = findPlayer(state, targetId);
  const ctx = { asker: slayerId, slot: `slayer-d${state.day}` };
  const hit = target.alive && abilityWorks(state, self) && registersAs(state, target, 'demon', ctx);
  if (hit) {
    target.alive = false;
    state.publicLog.push(`${self.name} shoots ${target.name} — it was the Demon! They die.`);
    checkDemonDeathPromotion(state, target);
    evaluateWin(state);
  } else {
    state.publicLog.push(`${self.name} shoots ${target.name} — nothing happens.`);
  }
}

export function nominate(state: GameState, nominatorId: string, nomineeId: string): void {
  if (state.phase !== 'day') throw new GameError('Not day phase');
  if (state.currentNomination) throw new GameError('A nomination is already in progress');
  const nominator = findPlayer(state, nominatorId);
  const nominee = findPlayer(state, nomineeId);
  if (!nominator.alive) throw new GameError('Dead players cannot nominate');
  if (!nominee.alive) throw new GameError('Cannot nominate a dead player');
  if (state.usedNominatorIds.includes(nominatorId)) throw new GameError('Already nominated today');
  if (state.usedNomineeIds.includes(nomineeId)) throw new GameError('Already nominated today');

  state.usedNominatorIds.push(nominatorId);
  state.usedNomineeIds.push(nomineeId);

  if (nominee.character === 'virgin' && !nominee.virginUsed) {
    nominee.virginUsed = true;
    const ctx = { asker: nominatorId, slot: `virgin-d${state.day}` };
    if (abilityWorks(state, nominee) && registersAs(state, nominator, 'townsfolk', ctx)) {
      state.publicLog.push(`${nominator.name} nominated the Virgin and is executed immediately!`);
      executePlayer(state, nominatorId);
      maybeAutoEndDay(state);
      return;
    }
  }

  state.currentNomination = {
    id: `nom-${state.usedNominatorIds.length}`, nominatorId, nomineeId,
    state: 'accusing', phaseEndsAt: Date.now() + ACCUSE_MS,
    voteOrder: [], voteIndex: -1, currentVoterId: null, voterDeadline: null,
    votes: {}, yesCount: 0,
  };
  state.publicLog.push(`${nominator.name} nominates ${nominee.name}.`);
}

/**
 * Lets the current speaker end their own speech early instead of waiting out the timer.
 * Deliberately nobody else's call — not even the host: the host is just whoever happened to
 * create the room, not a storyteller with authority to cut another player's turn short. If the
 * speaker says nothing, the accusing/defending timer auto-advances on its own.
 */
export function skipSpeech(state: GameState, playerId: string): void {
  const nom = state.currentNomination;
  if (!nom) throw new GameError('No nomination in progress');
  if (nom.state === 'accusing') {
    if (playerId !== nom.nominatorId) throw new GameError('Only the accuser can end their own speech early');
    nom.state = 'defending';
    nom.phaseEndsAt = Date.now() + DEFEND_MS;
  } else if (nom.state === 'defending') {
    if (playerId !== nom.nomineeId) throw new GameError('Only the accused can end their own defense early');
    startVoting(state, nom);
  } else {
    throw new GameError('Nothing to skip right now');
  }
}

/** Seat order the vote goes around in: everyone once, starting just after the nominee, ending on the nominee. */
function buildVoteOrder(state: GameState, nomineeId: string): string[] {
  const seated = state.players.slice().sort((a, b) => a.seat - b.seat);
  const idx = seated.findIndex((p) => p.id === nomineeId);
  const order: string[] = [];
  for (let i = 1; i <= seated.length; i++) order.push(seated[(idx + i) % seated.length].id);
  return order;
}

function findNextVoterIndex(state: GameState, nom: Nomination, fromIndex: number): number {
  for (let i = fromIndex; i < nom.voteOrder.length; i++) {
    const p = findPlayer(state, nom.voteOrder[i]);
    if (p.alive || !p.ghostVoteUsed) return i;
  }
  return nom.voteOrder.length;
}

function startVoting(state: GameState, nom: Nomination): void {
  nom.state = 'voting';
  nom.voteOrder = buildVoteOrder(state, nom.nomineeId);
  nom.voteIndex = -1;
  advanceVoter(state, nom);
}

function advanceVoter(state: GameState, nom: Nomination): void {
  const nextIdx = findNextVoterIndex(state, nom, nom.voteIndex + 1);
  if (nextIdx >= nom.voteOrder.length) {
    finishVoting(state, nom);
    return;
  }
  nom.voteIndex = nextIdx;
  nom.currentVoterId = nom.voteOrder[nextIdx];
  nom.voterDeadline = Date.now() + VOTER_TIMEOUT_MS;
}

export function castVote(state: GameState, voterId: string, yes: boolean): void {
  const nom = state.currentNomination;
  if (!nom) throw new GameError('No nomination in progress');
  if (nom.state !== 'voting') throw new GameError('Not voting yet');
  if (nom.currentVoterId !== voterId) throw new GameError('Not your turn to vote');
  const voter = findPlayer(state, voterId);
  if (!voter.alive && yes) {
    if (voter.ghostVoteUsed) throw new GameError('Ghost vote already used');
    voter.ghostVoteUsed = true;
  }
  nom.votes[voterId] = yes;
  advanceVoter(state, nom);
}

function computeYesCount(state: GameState, nom: Nomination): number {
  let count = 0;
  for (const p of state.players) {
    let vote = nom.votes[p.id] ?? false;
    if (vote && p.character === 'butler' && abilityWorks(state, p)) {
      const masterVote = state.butlerMasterId ? (nom.votes[state.butlerMasterId] ?? false) : false;
      if (!masterVote) vote = false;
    }
    if (vote) count++;
  }
  return count;
}

function finishVoting(state: GameState, nom: Nomination): void {
  const nominee = findPlayer(state, nom.nomineeId);
  const aliveCount = state.players.filter((p) => p.alive).length;
  const majority = Math.floor(aliveCount / 2) + 1;
  const yesCount = computeYesCount(state, nom);
  nom.yesCount = yesCount;
  nom.state = 'closed';
  nom.currentVoterId = null;
  nom.voterDeadline = null;

  if (yesCount >= majority && yesCount > state.highestYesToday) {
    state.onBlockId = nominee.id;
    state.highestYesToday = yesCount;
    state.publicLog.push(`${nominee.name} receives ${yesCount} votes and is now on the block.`);
  } else if (yesCount > 0 && yesCount === state.highestYesToday) {
    state.onBlockId = null;
    state.publicLog.push(`${nominee.name} ties the current highest vote count — no one is on the block.`);
  } else {
    state.publicLog.push(`${nominee.name} receives ${yesCount} vote(s) — not enough to be on the block.`);
  }

  state.currentNomination = null;
  maybeAutoEndDay(state);
}

export function tick(state: GameState, now: number): void {
  if (state.phase === 'night') {
    nightTick(state, now);
    return;
  }
  if (state.phase !== 'day') return;
  const nom = state.currentNomination;
  if (!nom) return;
  if (nom.state === 'accusing' && now >= nom.phaseEndsAt) {
    nom.state = 'defending';
    nom.phaseEndsAt = now + DEFEND_MS;
  } else if (nom.state === 'defending' && now >= nom.phaseEndsAt) {
    startVoting(state, nom);
  } else if (nom.state === 'voting' && nom.voterDeadline !== null && now >= nom.voterDeadline) {
    nom.votes[nom.currentVoterId!] = false;
    advanceVoter(state, nom);
  }
}

function maybeAutoEndDay(state: GameState): void {
  if (state.currentNomination || state.winner) return;
  const alive = state.players.filter((p) => p.alive).map((p) => p.id);
  const covered = alive.every((id) => state.usedNominatorIds.includes(id) || state.usedNomineeIds.includes(id));
  if (covered) endDay(state);
}

export function requestEndDay(state: GameState): void {
  if (state.currentNomination) throw new GameError('Resolve the current nomination first');
  endDay(state);
}

function endDay(state: GameState): void {
  if (state.phase !== 'day' || state.winner) return;
  const executedId = state.onBlockId;
  if (executedId) {
    executePlayer(state, executedId);
  } else {
    state.lastExecutedId = null;
    state.publicLog.push('No one was executed today.');
  }
  if (state.winner) return;

  const aliveCount = state.players.filter((p) => p.alive).length;
  const mayor = state.players.find((p) => p.alive && p.character === 'mayor');
  if (!executedId && aliveCount === 3 && mayor && abilityWorks(state, mayor)) {
    setWinner(state, 'good', 'No execution with only 3 players left and the Mayor alive — good wins!');
    return;
  }

  evaluateWin(state);
  if (state.winner) return;
  beginNight(state);
}
