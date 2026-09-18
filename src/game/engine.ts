import { alignmentOfCharacter } from './characters.js';
import { beginNight, evaluateWin, promoteScarletWomanIfEligible, setWinner, tick as nightTick } from './night.js';
import { abilityWorks, registersAs } from './registration.js';
import { randomId } from './rng.js';
import { dealCharacters } from './setup.js';
import type { GameState, Msg, Nomination, PlayerState } from './types.js';
import { GameError } from './types.js';

export { submitRealResponse } from './night.js';

const ACCUSE_MS = 45_000;
const DEFEND_MS = 45_000;
const VOTER_TIMEOUT_MS = 15_000;

function msg(key: string, vars?: Record<string, string | number | string[]>): Msg {
  return vars ? { key, vars } : { key };
}

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
    deathsTonight: [], nightSlotIndex: -1, pendingRealTurn: null,
    publicLog: [], currentNomination: null, onBlockId: null, highestYesToday: 0,
    usedNominatorIds: [], usedNomineeIds: [], winner: null,
    lastExecutedId: null, seatingConfirmed: false, endDayRequestedBy: [],
  };
}

export function addPlayer(state: GameState, name: string): PlayerState {
  if (state.phase !== 'lobby') throw new GameError('Game already started');
  const player: PlayerState = {
    id: randomId(), token: randomId() + randomId(), name, seat: state.players.length,
    seatRightId: null, connected: true,
    character: 'soldier', perceived: 'soldier', alignment: 'good', alive: true,
    ghostVoteUsed: false, isRedHerring: false, diedTonight: false,
    virginUsed: false, slayerUsed: false, log: [], nightResult: null,
  };
  state.players.push(player);
  if (!state.hostId) state.hostId = player.id;
  // A newcomer isn't part of anyone's declared circle yet, so any earlier confirmation is stale.
  state.seatingConfirmed = false;
  return player;
}

/**
 * Each player declares who sits to their right — the only seating fact anyone ever states.
 * "Left" is never stored, only derived (see PlayerState.seatRightId), so there's no separate
 * value that can go stale when someone changes their answer. Once every player has declared a
 * right-hand neighbor and following those pointers traces one single loop through everyone, the
 * circle is fully determined and everyone's `seat` is assigned by walking it — no arbitrary
 * join-order seating.
 */
export function declareNeighbor(state: GameState, playerId: string, neighborId: string): void {
  if (state.phase !== 'lobby') throw new GameError('Seating can only be set before the game starts');
  const self = findPlayer(state, playerId);
  if (neighborId === playerId) throw new GameError('You cannot be your own neighbor');
  findPlayer(state, neighborId); // validates it exists
  self.seatRightId = neighborId;
  state.seatingConfirmed = tryResolveSeating(state);
}

function tryResolveSeating(state: GameState): boolean {
  const players = state.players;
  const n = players.length;
  if (n < 3) return false;
  if (!players.every((p) => p.seatRightId)) return false;

  const order: PlayerState[] = [players[0]];
  const seen = new Set([players[0].id]);
  let current = players[0];
  for (let i = 1; i < n; i++) {
    const next = players.find((p) => p.id === current.seatRightId);
    if (!next || seen.has(next.id)) return false; // broken or short cycle
    order.push(next);
    seen.add(next.id);
    current = next;
  }
  if (current.seatRightId !== players[0].id) return false; // doesn't close the loop

  order.forEach((p, i) => {
    p.seat = i;
  });
  return true;
}

/**
 * Leaving during the lobby fully removes you — the game hasn't started, so there's nothing
 * that depends on your slot (role counts, seating, night order). Reassigns host if you were it,
 * and invalidates seating confirmation the same way a newcomer would. Leaving after the game has
 * started can't safely remove you (it would corrupt the dealt roles/seat order), so it's treated
 * the same as losing connection — you're just marked disconnected, same as closing the tab.
 */
export function leaveRoom(state: GameState, playerId: string): void {
  if (state.phase === 'lobby') {
    const idx = state.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return;
    state.players.splice(idx, 1);
    if (state.hostId === playerId) state.hostId = state.players[0]?.id ?? '';
    state.seatingConfirmed = false;
    return;
  }
  const player = state.players.find((p) => p.id === playerId);
  if (player) player.connected = false;
}

export function findPlayerByToken(state: GameState, token: string): PlayerState | undefined {
  return state.players.find((p) => p.token === token);
}

export function startGame(state: GameState): void {
  if (state.phase !== 'lobby') throw new GameError('Game already started');
  if (!state.seatingConfirmed) throw new GameError('Seating is not fully confirmed yet');
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

function executePlayer(state: GameState, targetId: string): void {
  const p = findPlayer(state, targetId);
  state.lastExecutedId = targetId;
  state.publicLog.push(msg('wasExecuted', { name: p.name }));
  // Executing a dead player still counts as today's one execution, but "a dead player cannot
  // die again": nothing that triggers on a death (Saint, Scarlet Woman) happens a second time.
  if (!p.alive) return;
  p.alive = false;
  if (p.character === 'saint' && abilityWorks(state, p)) {
    setWinner(state, 'evil', msg('saintWins', { name: p.name }));
    return;
  }
  promoteScarletWomanIfEligible(state, p);
  evaluateWin(state);
}

/**
 * Any living player may publicly claim the Slayer's shot, once per game — bluffing it is part of
 * the game ("If the Imp is claiming to be the Slayer and wants to use their ability, make sure it
 * looks like their ability just didn't work"). Only a real, working Slayer can ever hit; everyone
 * else gets the exact same public "nothing happens" as a Slayer who missed, so a shot proves
 * nothing about who fired it.
 */
export function useSlayer(state: GameState, slayerId: string, targetId: string): void {
  if (state.phase !== 'day') throw new GameError('Slayer can only be used during the day');
  const self = findPlayer(state, slayerId);
  if (!self.alive) throw new GameError('Dead players cannot use the Slayer shot');
  if (self.slayerUsed) throw new GameError('Slayer shot already used');
  const target = findPlayer(state, targetId);
  self.slayerUsed = true;
  // The true character decides it (a Drunk who thinks they're the Slayer never hits either).
  const isRealSlayer = self.character === 'slayer';
  const ctx = { asker: slayerId, slot: `slayer-d${state.day}` };
  const hit = isRealSlayer && target.alive && abilityWorks(state, self) && registersAs(state, target, 'demon', ctx);
  if (hit) {
    target.alive = false;
    state.publicLog.push(msg('slayerHit', { slayer: self.name, target: target.name }));
    promoteScarletWomanIfEligible(state, target);
    evaluateWin(state);
  } else {
    state.publicLog.push(msg('slayerMiss', { slayer: self.name, target: target.name }));
  }
}

export function nominate(state: GameState, nominatorId: string, nomineeId: string): void {
  if (state.phase !== 'day') throw new GameError('Not day phase');
  if (state.currentNomination) throw new GameError('A nomination is already in progress');
  const nominator = findPlayer(state, nominatorId);
  const nominee = findPlayer(state, nomineeId);
  if (!nominator.alive) throw new GameError('Dead players cannot nominate');
  // Dead players can be nominated (rarely wise, but legal) — only the living may nominate.
  if (state.usedNominatorIds.includes(nominatorId)) throw new GameError('Already nominated today');
  if (state.usedNomineeIds.includes(nomineeId)) throw new GameError('Already nominated today');

  state.usedNominatorIds.push(nominatorId);
  state.usedNomineeIds.push(nomineeId);
  state.endDayRequestedBy = []; // a fresh nomination is new information — prior agreement to end the day is stale

  if (nominee.character === 'virgin' && nominee.alive && !nominee.virginUsed) {
    nominee.virginUsed = true;
    const ctx = { asker: nominatorId, slot: `virgin-d${state.day}` };
    if (abilityWorks(state, nominee) && registersAs(state, nominator, 'townsfolk', ctx)) {
      state.publicLog.push(msg('virginExecutesNominator', { name: nominator.name }));
      // That's today's one execution: the day ends right here, so nobody on the block is also
      // executed, and nothing (Mayor, Undertaker) can mistake it for a day without an execution.
      executePlayer(state, nominatorId);
      if (!state.winner) beginNight(state);
      return;
    }
  }

  state.currentNomination = {
    id: `nom-${state.usedNominatorIds.length}`, nominatorId, nomineeId,
    state: 'readyForAccusation', phaseEndsAt: 0, readyBy: [],
    voteOrder: [], voteIndex: -1, currentVoterId: null, voterDeadline: null,
    votes: {}, yesCount: 0,
  };
  state.publicLog.push(msg('nominates', { nominator: nominator.name, nominee: nominee.name }));
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
    nom.state = 'readyForDefense';
    nom.readyBy = [];
  } else if (nom.state === 'defending') {
    if (playerId !== nom.nomineeId) throw new GameError('Only the accused can end their own defense early');
    startVoting(state, nom);
  } else {
    throw new GameError('Nothing to skip right now');
  }
}

/**
 * Before either speech (the accusation, then the defense) actually starts, every player —
 * including the dead, who are still watching — signals they're ready to listen. Only once
 * everyone has done so does the speech's timer actually start; this is deliberately everyone,
 * not just the living (unlike ending the day early, which is a decision only living players get
 * a say in). Clicking again withdraws your readiness.
 */
export function markReadyForSpeech(state: GameState, playerId: string): void {
  const nom = state.currentNomination;
  if (!nom) throw new GameError('No nomination in progress');
  if (nom.state !== 'readyForAccusation' && nom.state !== 'readyForDefense') {
    throw new GameError('Not waiting for readiness right now');
  }
  findPlayer(state, playerId); // validates it exists
  const idx = nom.readyBy.indexOf(playerId);
  if (idx >= 0) nom.readyBy.splice(idx, 1);
  else nom.readyBy.push(playerId);
  maybeAdvanceSpeechReady(state, nom);
}

function maybeAdvanceSpeechReady(state: GameState, nom: Nomination): void {
  const everyone = state.players.map((p) => p.id);
  if (!everyone.every((id) => nom.readyBy.includes(id))) return;
  if (nom.state === 'readyForAccusation') {
    nom.state = 'accusing';
    nom.phaseEndsAt = Date.now() + ACCUSE_MS;
    nom.readyBy = [];
  } else if (nom.state === 'readyForDefense') {
    nom.state = 'defending';
    nom.phaseEndsAt = Date.now() + DEFEND_MS;
    nom.readyBy = [];
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
    // A dead Butler has no ability, so their ghost vote is unrestricted (unlike a living one).
    if (vote && p.alive && p.character === 'butler' && abilityWorks(state, p)) {
      const masterVote = state.butlerMasterId ? (nom.votes[state.butlerMasterId] ?? false) : false;
      if (!masterVote) vote = false;
    }
    if (vote) count++;
  }
  return count;
}

function finishVoting(state: GameState, nom: Nomination): void {
  const nominee = findPlayer(state, nom.nomineeId);
  // The vote succeeds with votes equal to at least HALF the living players (dead players' votes
  // count too) — e.g. 3 of 6 is enough — and more votes than anyone else nominated today.
  const aliveCount = state.players.filter((p) => p.alive).length;
  const needed = Math.ceil(aliveCount / 2);
  const yesCount = computeYesCount(state, nom);
  nom.yesCount = yesCount;
  nom.state = 'closed';
  nom.currentVoterId = null;
  nom.voterDeadline = null;

  if (yesCount >= needed && yesCount > state.highestYesToday) {
    state.onBlockId = nominee.id;
    state.highestYesToday = yesCount;
    state.publicLog.push(msg('onBlock', { name: nominee.name, count: yesCount }));
  } else if (yesCount > 0 && yesCount === state.highestYesToday) {
    state.onBlockId = null;
    state.publicLog.push(msg('tieClearsBlock', { name: nominee.name, count: yesCount }));
  } else {
    state.publicLog.push(msg('notEnoughVotes', { name: nominee.name, count: yesCount }));
  }

  state.currentNomination = null;
}

export function tick(state: GameState, now: number): void {
  // At night only dawn is timed — the night waits for every real answer, however long it takes.
  if (state.phase === 'night') {
    nightTick(state, now);
    return;
  }
  if (state.phase !== 'day') return;
  const nom = state.currentNomination;
  if (!nom) return;
  if (nom.state === 'accusing' && now >= nom.phaseEndsAt) {
    nom.state = 'readyForDefense';
    nom.readyBy = [];
  } else if (nom.state === 'defending' && now >= nom.phaseEndsAt) {
    startVoting(state, nom);
  } else if (nom.state === 'voting' && nom.voterDeadline !== null && now >= nom.voterDeadline) {
    nom.votes[nom.currentVoterId!] = false;
    advanceVoter(state, nom);
  }
}

/**
 * Ending the day early is a group decision, not a host privilege — the host is just whoever
 * created the room. Any living player can toggle their own "ready to end the day" flag; once
 * every living player has done so, the day ends. Changing your mind un-toggles it, and any new
 * nomination clears everyone's flag (see `nominate`), since that's new information the group
 * hasn't weighed in on yet.
 */
export function toggleEndDayRequest(state: GameState, playerId: string): void {
  if (state.phase !== 'day') throw new GameError('Not day phase');
  const player = findPlayer(state, playerId);
  if (!player.alive) throw new GameError('Only living players can vote to end the day');
  if (state.currentNomination) throw new GameError('Resolve the current nomination first');
  const idx = state.endDayRequestedBy.indexOf(playerId);
  if (idx >= 0) state.endDayRequestedBy.splice(idx, 1);
  else state.endDayRequestedBy.push(playerId);
  maybeEndDayByConsensus(state);
}

function maybeEndDayByConsensus(state: GameState): void {
  const alive = state.players.filter((p) => p.alive).map((p) => p.id);
  if (alive.length > 0 && alive.every((id) => state.endDayRequestedBy.includes(id))) {
    endDay(state);
  }
}

function endDay(state: GameState): void {
  if (state.phase !== 'day' || state.winner) return;
  const executedId = state.onBlockId;
  if (executedId) {
    executePlayer(state, executedId);
  } else {
    state.lastExecutedId = null;
    state.publicLog.push(msg('noExecutionToday'));
  }
  if (state.winner) return;

  const aliveCount = state.players.filter((p) => p.alive).length;
  const mayor = state.players.find((p) => p.alive && p.character === 'mayor');
  if (!executedId && aliveCount === 3 && mayor && abilityWorks(state, mayor)) {
    setWinner(state, 'good', msg('goodWinsMayor'));
    return;
  }

  evaluateWin(state);
  if (state.winner) return;
  beginNight(state);
}
