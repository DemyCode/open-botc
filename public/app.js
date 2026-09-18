const state = {
  ws: null,
  code: sessionStorage.getItem('botc.code'),
  token: sessionStorage.getItem('botc.token'),
  playerId: sessionStorage.getItem('botc.playerId'),
  view: null,
  selected: [],
  turnReadyAt: 0, // when the current night screen may be answered (the 5-second minimum)
  decoyResultStep: null, // a decoy's stand-in result screen, still to be dismissed (see submitTurn)
  dawnSeenForDay: null,
  duskSeenForNight: null,
  nightResultSeenForNight: null,
  roleHidden: false,
};

let pendingJoin = null;
let lastTurnKey = null;
let lastVoteBuzzKey = null;

const app = document.getElementById('app');

function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (v == null) return;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null) return;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return e;
}

function send(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws = ws;
  ws.addEventListener('open', () => {
    if (state.code && state.token) {
      send({ t: 'auth', code: state.code, token: state.token });
    } else if (pendingJoin) {
      send(pendingJoin);
      pendingJoin = null;
    }
  });
  ws.addEventListener('close', () => setTimeout(connect, 1500));
  ws.addEventListener('message', (ev) => handleMessage(JSON.parse(ev.data)));
}

function doJoin(code, name) {
  pendingJoin = { t: 'join', code, name };
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    send(pendingJoin);
    pendingJoin = null;
  }
}

function handleMessage(msg) {
  if (msg.t === 'identity') {
    state.code = msg.code;
    state.token = msg.token;
    state.playerId = msg.playerId;
    sessionStorage.setItem('botc.code', msg.code);
    sessionStorage.setItem('botc.token', msg.token);
    sessionStorage.setItem('botc.playerId', msg.playerId);
  } else if (msg.t === 'view') {
    const previous = state.view;
    state.view = msg.view;
    handleAnnouncements(previous, msg.view);
    handleTurnChange(msg.view);
    handleVoteBuzz(msg.view);
  } else if (msg.t === 'error') {
    showError(msg.message);
  }
  render();
}

function turnKey(view) {
  if (view.nightTurn) return `turn-${view.nightTurn.stepKey}`;
  // Deliberately not keyed on phase — a fast night can flip to 'day' while she still hasn't
  // acknowledged the same, unchanged result, and that isn't a new turn worth resetting for again.
  if (view.nightResult) return `result-${view.night}-${JSON.stringify(view.nightResult)}`;
  return null;
}

// The server can push a fresh view for reasons that have nothing to do with your own turn
// (another player's connection status changes, someone else answers their turn, a periodic
// timeout check, ...). Only wipe the in-progress selection when the turn itself actually
// changed — otherwise a routine broadcast mid-click would silently clear what you just picked.
function handleTurnChange(view) {
  const key = turnKey(view);
  if (key === lastTurnKey) return;
  // Never buzz for anything at night: a buzz is audible across a silent table and would give away
  // who just got a real turn or result — the very thing decoy questions exist to hide.
  state.selected = [];
  // Small margin on top of the server's wait, so the button never unlocks before the server
  // would accept the answer.
  state.turnReadyAt = view.nightTurn ? Date.now() + view.nightTurn.waitMs + 300 : 0;
  lastTurnKey = key;
}

function turnSecondsLeft() {
  return Math.max(0, Math.ceil((state.turnReadyAt - Date.now()) / 1000));
}

// Buzzes are for the day only: the one moment the day needs your phone is your turn to vote.
function voteBuzzKey(view) {
  const n = view.phase === 'day' ? view.nomination : null;
  return n && n.currentVoterId === view.selfId ? `vote-${view.day}-${n.nomineeId}` : null;
}

function handleVoteBuzz(view) {
  const key = voteBuzzKey(view);
  if (key === lastVoteBuzzKey) return;
  if (key && navigator.vibrate) navigator.vibrate([180, 80, 180]);
  lastVoteBuzzKey = key;
}

// ---------------------------------------------------------------------------
// Sounds and buzzes for the two moments EVERYONE is told at once: someone is accused, and the
// night begins. Both are public, simultaneous events, so they give nothing away — unlike a buzz
// for a night turn, which would (that one stays off). The tones are synthesized, so there are
// no audio files to load. Browsers only let a page make sound after a tap, so the first tap
// anywhere wakes the audio up.
// ---------------------------------------------------------------------------

let audioCtx = null;
let announcedNomination = null;

function getAudio() {
  if (audioCtx) return audioCtx;
  const AC = typeof AudioContext !== 'undefined' ? AudioContext : typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null;
  if (!AC) return null;
  try {
    audioCtx = new AC();
  } catch {
    return null;
  }
  return audioCtx;
}

function unlockAudio() {
  const c = getAudio();
  if (c && c.state === 'suspended' && c.resume) c.resume();
}
for (const type of ['pointerdown', 'touchstart', 'keydown']) window.addEventListener(type, unlockAudio, { passive: true });

// [frequency Hz, start s, length s]
const SOUNDS = {
  accuse: { wave: 'triangle', notes: [[660, 0, 0.13], [880, 0.15, 0.22]] }, // two quick rising notes
  night: { wave: 'sine', notes: [[392, 0, 0.3], [294, 0.3, 0.3], [220, 0.6, 0.6]] }, // a slow falling lullaby
};
const BUZZES = { accuse: [120, 60, 120], night: [250] };

function playSound(kind) {
  const c = getAudio();
  if (!c) return;
  try {
    if (c.state === 'suspended' && c.resume) c.resume();
    const { wave, notes } = SOUNDS[kind];
    for (const [freq, at, len] of notes) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = wave;
      osc.frequency.value = freq;
      const t0 = c.currentTime + at;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + len + 0.05);
    }
  } catch {
    // no sound is better than a broken screen
  }
}

function announce(kind) {
  playSound(kind);
  if (navigator.vibrate) navigator.vibrate(BUZZES[kind]);
}

/**
 * Called for every new view, with the one before it. Only real CHANGES announce anything: the
 * first view after opening the page (or reconnecting into the same situation) stays silent.
 */
function handleAnnouncements(previous, view) {
  const n = view.phase === 'day' ? view.nomination : null;
  const nominationKey = n ? `${view.day}-${n.nominatorId}-${n.nomineeId}` : null;
  if (previous) {
    if (nominationKey && nominationKey !== announcedNomination) announce('accuse');
    if (view.phase === 'night' && previous.phase !== 'night') announce('night');
  }
  announcedNomination = nominationKey;
}

function showError(message) {
  const bar = el('div', {}, message);
  // Starts below the topbar (leave/lang/roles buttons) instead of at the very top of the
  // viewport, so it never covers them up and makes them briefly unclickable.
  bar.style.cssText =
    'position:fixed;top:max(54px, calc(env(safe-area-inset-top) + 54px));left:0;right:0;background:#f87171;color:#111;padding:10px;text-align:center;z-index:400;font-weight:600;';
  document.body.appendChild(bar);
  setTimeout(() => bar.remove(), 3000);
}

let charactersCache = null;

async function loadCharacters() {
  if (charactersCache) return charactersCache;
  const res = await fetch('/api/characters');
  charactersCache = await res.json();
  return charactersCache;
}

// ---------------------------------------------------------------------------
// i18n — English and French. Ability/name text for French is a plain functional
// translation of the game mechanics, written from scratch (not copied from any
// rulebook), same as the rest of this project's original content.
// ---------------------------------------------------------------------------

// Per-tab, not per-browser: each player is their own tab/device, and testing with several tabs
// in one browser (the same reason identity lives in sessionStorage) must let each pick their own
// language independently rather than forcing everyone in the room onto one shared choice.
let LANG = sessionStorage.getItem('botc.lang') || (navigator.language || 'en').slice(0, 2);
if (LANG !== 'fr') LANG = 'en';

const STRINGS = {
  en: {
    heroTagline: 'Fully automatic storyteller. Play in person, on your phones.',
    yourName: 'Your name',
    roomCode: 'Room code',
    joinGame: 'Join Game',
    createNewGame: 'Create New Game',
    or: 'or',
    enterNameCode: 'Enter your name and a room code',
    enterNameFirst: 'Enter your name first',
    allRoles: 'All Roles',
    allRolesTitle: 'Trouble Brewing — All Roles',
    close: 'Close',
    leaveGame: 'Leave Game',
    leaveConfirm: "Leave this game? You'll go back to the join/create screen.",
    connecting: 'Connecting…',
    lobby: 'Lobby',
    shareCode: 'Share this code with everyone at the table.',
    seating: 'Seating',
    seatingIntro: 'Go around the table — everyone just answers who is sitting to their right.',
    whoRight: 'Who is sitting to your RIGHT?',
    chooseOption: '— choose —',
    needAtLeast3: 'Need at least 3 players before seating can be set.',
    seatingConfirmed: '✓ Seating confirmed — order is locked in.',
    waitingOnSeating: (names) => `Waiting on seating from: ${names}`,
    notFullCircle: "⚠️ Not a full circle yet — someone's answer doesn't line up. Check the diagram below.",
    seated: '✓ seated',
    seatingEllipsis: '… seating',
    startGame: (n) => `Start Game (${n} players)`,
    need5to15: (n) => `Need 5-15 players (${n})`,
    waitingOnSeatingConfirm: 'Waiting on seating to be confirmed',
    waitingHost: 'Waiting for the host to start…',
    you: ' (you)',
    youAlive: '🟢 You are alive',
    youDeadOneVote: '💀 You are dead — you can still vote one more time this game',
    youDeadNoVote: '💀 You are dead — you already used your final vote',
    day: (n) => `Day ${n}`,
    night: (n) => `Night ${n}`,
    yourInformation: 'Your Information',
    yourTurn: 'Your Turn',
    confirm: 'Confirm',
    gotIt: 'Got it',
    yourResult: 'Your Result',
    continueBtn: 'Continue',
    deadRest: 'You are dead and rest peacefully.',
    waitingEveryone: 'Waiting for everyone to answer… Keep your eyes on your phone.',
    decoyNote: "🎭 Decoy — this answer does nothing. Everyone is woken at every step of the night, so nobody can tell who really acted.",
    decoyInfo: 'Nothing to learn at this step. Read this, then tap “Got it”.',
    decoyResult: 'Your answer was noted. Nothing to learn from it.',
    decoyTrust: 'Which player do you trust the most right now?',
    decoySuspect: 'Which player seems the most suspicious to you?',
    decoyQuiet: 'Which player has been the quietest so far?',
    decoyNominate: 'If you had to nominate someone tomorrow, who would it be?',
    decoyDemon: 'Who do you think is the Demon?',
    decoyBelieve: 'Whose claim do you believe the most?',
    decoySameTeam: 'Pick two players you think are on the same team.',
    decoyOutsider: 'Who do you think might be an Outsider?',
    accuses: (a, b) => `${a} accuses ${b}`,
    makingCase: (name, s) => `${name} is making their case… (${s}s)`,
    doneMoveDefense: 'Done — move to defense',
    responding: (name, s) => `${name} is responding… (${s}s)`,
    doneStartVote: 'Done — start the vote',
    yourTurnVote: (name) => `It's your turn. Do you want to execute ${name}? Say your answer out loud too — everyone can see it here either way.`,
    yesExecute: (name) => `Yes, execute ${name}`,
    no: 'No',
    waitingOnVoter: (name) => `Waiting on ${name} to vote…`,
    waitingDots: '· waiting',
    votingEllipsis: 'voting…',
    voteYes: '✓ Yes',
    voteNo: '✗ No',
    endTheDay: 'End the Day',
    readyToMoveOn: (ready, alive, names) => `${ready}/${alive} players ready to move on${names}`,
    changedMind: 'Changed my mind — keep talking',
    readyToEnd: "I'm ready to end the day",
    mustBeSeated: '(you must be seated at your place)',
    onBlock: (name) => `${name} currently has the most votes and will be executed tonight, unless someone else gets more votes first.`,
    tapToNominate: 'Tap a player to nominate them for execution.',
    deadNoVoteLeft: "You're dead and already used your final vote — you can only watch from here.",
    deadOneVoteLeft: "You're dead, but you still have one vote left to use before the game ends.",
    slayerShot: 'Slayer shot',
    slayerDesc: "Once per game, anyone may publicly claim to be the Slayer and shoot a player. If you really are the Slayer and they are the Demon, they die — otherwise nothing happens. Everyone sees this same card, so a shot proves nothing about who fired it.",
    publiclyAccuse: (name) => `Publicly shoot ${name} as the Slayer? You only get one shot per game.`,
    nominateSelfConfirm: 'Nominate yourself for execution?',
    nominateDeadConfirm: (name) => `${name} is already dead. Nominate them anyway? (It still uses up your nomination for today.)`,
    goodWins: 'Good Wins!',
    replayTitle: 'What really happened',
    replayIntro: 'Everything that happened this game, in order — including what was secret.',
    replaySetup: 'Setup',
    replayNightN: (n) => `Night ${n}`,
    replayDayN: (n) => `Day ${n}`,
    evilWins: 'Evil Wins!',
    langLabel: 'FR',
    readyForAccusation: 'Get ready to hear the accusation.',
    readyCount: (ready, total) => `${ready}/${total} players ready`,
    imReadyAccusation: (accuser, accused) => `I'm ready to hear ${accuser}'s accusation against ${accused}`,
    cancelReady: 'Actually, not ready yet',
    hideRole: 'Hide role',
    showRole: 'Show role',
    villageLog: 'Village Log',
    deadSuffix: ' (dead)',
    noTalking: '🤫 No talking during the night — stay silent.',
    voteLeftBadge: '🗳 vote left',
    voteUsedBadge: 'vote used',
    nominatedBadge: 'nominated ✗',
    accusedBadge: 'accused ✗',
    searchRoles: 'Search roles…',
    noRolesMatch: 'No roles match your search.',
  },
  fr: {
    heroTagline: 'Narrateur entièrement automatique. Jouez en personne, sur vos téléphones.',
    yourName: 'Votre nom',
    roomCode: 'Code de la partie',
    joinGame: 'Rejoindre',
    createNewGame: 'Créer une partie',
    or: 'ou',
    enterNameCode: 'Entrez votre nom et un code de partie',
    enterNameFirst: "Entrez d'abord votre nom",
    allRoles: 'Tous les rôles',
    allRolesTitle: 'Trouble Brewing — Tous les rôles',
    close: 'Fermer',
    leaveGame: 'Quitter',
    leaveConfirm: "Quitter cette partie ? Vous retournerez à l'écran d'accueil.",
    connecting: 'Connexion…',
    lobby: 'Salon',
    shareCode: 'Partagez ce code avec tout le monde à la table.',
    seating: 'Placement',
    seatingIntro: 'Faites le tour de la table — chacun indique simplement qui est assis à sa droite.',
    whoRight: 'Qui est assis à votre DROITE ?',
    chooseOption: '— choisir —',
    needAtLeast3: 'Il faut au moins 3 joueurs avant de pouvoir définir le placement.',
    seatingConfirmed: '✓ Placement confirmé — l\'ordre est fixé.',
    waitingOnSeating: (names) => `En attente du placement de : ${names}`,
    notFullCircle: "⚠️ Le cercle n'est pas encore complet — une réponse ne correspond pas. Regardez le schéma ci-dessous.",
    seated: '✓ placé',
    seatingEllipsis: '… en cours',
    startGame: (n) => `Démarrer la partie (${n} joueurs)`,
    need5to15: (n) => `Il faut 5 à 15 joueurs (${n})`,
    waitingOnSeatingConfirm: 'En attente de la confirmation du placement',
    waitingHost: "En attente que l'hôte démarre…",
    you: ' (vous)',
    youAlive: '🟢 Vous êtes vivant',
    youDeadOneVote: '💀 Vous êtes mort — il vous reste un dernier vote pour cette partie',
    youDeadNoVote: '💀 Vous êtes mort — vous avez déjà utilisé votre dernier vote',
    day: (n) => `Jour ${n}`,
    night: (n) => `Nuit ${n}`,
    yourInformation: 'Vos informations',
    yourTurn: 'Votre tour',
    confirm: 'Confirmer',
    gotIt: "J'ai compris",
    yourResult: 'Votre résultat',
    continueBtn: 'Continuer',
    deadRest: 'Vous êtes mort et reposez en paix.',
    waitingEveryone: 'En attente des réponses de tout le monde… Gardez les yeux sur votre téléphone.',
    decoyNote: "🎭 Leurre — cette réponse ne fait rien. Tout le monde est réveillé à chaque étape de la nuit, donc personne ne peut savoir qui a vraiment agi.",
    decoyInfo: "Rien à apprendre à cette étape. Lisez ceci, puis touchez « J'ai compris ».",
    decoyResult: "Votre réponse est notée. Il n'y a rien à en apprendre.",
    decoyTrust: 'En quel joueur avez-vous le plus confiance en ce moment ?',
    decoySuspect: 'Quel joueur vous semble le plus suspect ?',
    decoyQuiet: "Quel joueur a été le plus silencieux jusqu'ici ?",
    decoyNominate: "Si vous deviez nominer quelqu'un demain, qui serait-ce ?",
    decoyDemon: 'Qui pensez-vous être le Démon ?',
    decoyBelieve: 'Quel joueur vous semble le plus sincère sur son rôle ?',
    decoySameTeam: 'Choisissez deux joueurs qui, selon vous, sont dans la même équipe.',
    decoyOutsider: 'Qui pourrait être un Marginal selon vous ?',
    accuses: (a, b) => `${a} accuse ${b}`,
    makingCase: (name, s) => `${name} plaide sa cause… (${s}s)`,
    doneMoveDefense: 'Terminé — passer à la défense',
    responding: (name, s) => `${name} répond… (${s}s)`,
    doneStartVote: 'Terminé — lancer le vote',
    yourTurnVote: (name) => `C'est votre tour. Voulez-vous exécuter ${name} ? Dites aussi votre réponse à voix haute — tout le monde peut la voir ici de toute façon.`,
    yesExecute: (name) => `Oui, exécuter ${name}`,
    no: 'Non',
    waitingOnVoter: (name) => `En attente du vote de ${name}…`,
    waitingDots: '· en attente',
    votingEllipsis: 'vote en cours…',
    voteYes: '✓ Oui',
    voteNo: '✗ Non',
    endTheDay: 'Terminer la journée',
    readyToMoveOn: (ready, alive, names) => `${ready}/${alive} joueurs prêts à passer à la suite${names}`,
    changedMind: "J'ai changé d'avis — continuons de discuter",
    readyToEnd: 'Je suis prêt à terminer la journée',
    mustBeSeated: '(vous devez être assis à votre place)',
    onBlock: (name) => `${name} a actuellement le plus de votes et sera exécuté ce soir, sauf si quelqu'un d'autre obtient plus de votes.`,
    tapToNominate: 'Touchez un joueur pour le nominer à l\'exécution.',
    deadNoVoteLeft: "Vous êtes mort et avez déjà utilisé votre dernier vote — vous ne pouvez qu'observer.",
    deadOneVoteLeft: "Vous êtes mort, mais il vous reste un vote à utiliser avant la fin de la partie.",
    slayerShot: 'Tir de la Pourfendeuse',
    slayerDesc: "Une fois par partie, n'importe qui peut prétendre publiquement être la Pourfendeuse et tirer sur un joueur. Si vous êtes vraiment la Pourfendeuse et que c'est le Démon, il meurt — sinon il ne se passe rien. Tout le monde voit cette même carte : un tir ne prouve rien sur le tireur.",
    publiclyAccuse: (name) => `Tirer publiquement sur ${name} en tant que Pourfendeuse ? Vous n'avez qu'un seul tir par partie.`,
    nominateSelfConfirm: 'Vous nominer vous-même pour être exécuté ?',
    nominateDeadConfirm: (name) => `${name} est déjà mort(e). Le nominer quand même ? (Cela utilise votre nomination du jour.)`,
    goodWins: 'Le Bien gagne !',
    replayTitle: 'Ce qui s’est vraiment passé',
    replayIntro: 'Tout ce qui s’est passé dans cette partie, dans l’ordre — y compris ce qui était secret.',
    replaySetup: 'Mise en place',
    replayNightN: (n) => `Nuit ${n}`,
    replayDayN: (n) => `Jour ${n}`,
    evilWins: 'Le Mal gagne !',
    langLabel: 'EN',
    readyForAccusation: "Préparez-vous à entendre l'accusation.",
    readyCount: (ready, total) => `${ready}/${total} joueurs prêts`,
    imReadyAccusation: (accuser, accused) => `Je suis prêt à écouter l'accusation de ${accuser} envers ${accused}`,
    cancelReady: 'Finalement, pas encore prêt',
    hideRole: 'Masquer le rôle',
    showRole: 'Afficher le rôle',
    villageLog: 'Journal du village',
    deadSuffix: ' (mort)',
    noTalking: '🤫 Interdit de parler pendant la nuit — restez silencieux.',
    voteLeftBadge: '🗳 vote restant',
    voteUsedBadge: 'vote utilisé',
    nominatedBadge: 'a nominé ✗',
    accusedBadge: 'accusé(e) ✗',
    searchRoles: 'Rechercher un rôle…',
    noRolesMatch: 'Aucun rôle ne correspond à votre recherche.',
  },
};

function t(key, ...args) {
  const v = (STRINGS[LANG] && STRINGS[LANG][key]) ?? STRINGS.en[key];
  return typeof v === 'function' ? v(...args) : v;
}

// French names/abilities for every Trouble Brewing character, using the official French edition's
// terminology (provided by the user) rather than home-grown translations.
const CHAR_I18N_FR = {
  washerwoman: { name: 'Lavandière', ability: 'Lors de votre première nuit, vous apprenez un rôle de Villageois en jeu parmi 2 joueurs.' },
  librarian: { name: 'Archiviste', ability: 'Lors de votre première nuit, vous apprenez un rôle de Marginal en jeu parmi 2 joueurs (ou qu’aucun Marginal n’est en jeu).' },
  investigator: { name: 'Détective', ability: 'Lors de votre première nuit, vous apprenez un rôle de Sbire en jeu parmi 2 joueurs.' },
  chef: { name: 'Cuisinier', ability: 'Lors de votre première nuit, vous apprenez le nombre de paires de joueurs maléfiques.' },
  empath: { name: 'Empathe', ability: 'Chaque nuit, vous apprenez combien de vos 2 voisins en vie sont maléfiques.' },
  fortuneteller: { name: 'Voyante', ability: 'Chaque nuit, choisissez 2 joueurs et apprenez si un Démon est parmi eux. Un des joueurs bons vous apparaît comme un Démon.' },
  undertaker: { name: 'Fossoyeur', ability: 'Chaque nuit*, vous apprenez quel rôle est mort par exécution dans la journée.' },
  monk: { name: 'Moine', ability: 'Chaque nuit*, choisissez un joueur (sauf vous-même) : il est protégé du Démon cette nuit.' },
  ravenkeeper: { name: 'Corneille', ability: 'Si vous mourez la nuit, vous êtes réveillée pour choisir un joueur et apprendre son rôle.' },
  virgin: { name: 'Immaculée', ability: 'La première fois qu’un joueur vous nomme, il est exécuté immédiatement s’il s’agit d’un Villageois.' },
  slayer: { name: 'Pourfendeuse', ability: 'Une fois par partie, dans la journée, choisissez publiquement un joueur : s’il est le Démon, il meurt.' },
  soldier: { name: 'Soldat', ability: 'Vous êtes protégé du Démon.' },
  mayor: { name: 'Maire', ability: 'S’il n’y a que 3 joueurs en vie et pas d’exécution, votre équipe gagne. Si vous mourez la nuit, un autre joueur pourrait mourir à votre place.' },
  butler: { name: 'Majordome', ability: 'Chaque nuit, choisissez un joueur (sauf vous-même). Le lendemain, vous pouvez voter uniquement si ce joueur vote.' },
  drunk: { name: 'Ivrogne', ability: 'Vous ne savez pas que vous êtes l’Ivrogne. Vous pensez que vous êtes un Villageois.' },
  recluse: { name: 'Recluse', ability: 'Vous pourriez apparaître comme maléfique et comme Sbire ou Démon, même morte.' },
  saint: { name: 'Saint', ability: 'Si vous mourez par exécution, votre équipe perd.' },
  poisoner: { name: 'Empoisonneur', ability: 'Chaque nuit, choisissez un joueur. Il est empoisonné cette nuit et le jour suivant.' },
  spy: { name: 'Espionne', ability: 'Chaque nuit, vous voyez le Grimoire. Vous pourriez apparaître comme bonne et comme Villageois ou Marginal, même morte.' },
  scarletwoman: { name: 'Femme écarlate', ability: 'S’il y a au moins 5 joueurs en vie et que le Démon meurt, vous devenez le Démon.' },
  baron: { name: 'Baron', ability: 'Il y a deux Marginaux supplémentaires en jeu. [+2 Marginaux]' },
  imp: { name: 'Diablotin', ability: 'Chaque nuit*, choisissez un joueur : il meurt. Si vous vous tuez de cette façon, un Sbire devient le Diablotin.' },
};

/** Merges the server's (English) character summary with the French override for the current language. */
function localizeChar(c) {
  if (!c) return c;
  if (LANG === 'fr' && CHAR_I18N_FR[c.id]) return { ...c, ...CHAR_I18N_FR[c.id] };
  return c;
}

/** Localized display name for a character id, falling back to the raw id if the cache isn't warm yet. */
function roleNameFor(id) {
  const c = charactersCache && charactersCache.find((x) => x.id === id);
  return c ? localizeChar(c).name : id;
}

// ---------------------------------------------------------------------------
// Central message authority — the server never sends a pre-rendered English sentence for game
// narration (log entries, night prompts, dawn/dusk messages, ...), only a {key, vars} descriptor.
// This dictionary is the ONLY place that turns one of those into an actual sentence, in whichever
// language the viewer picked — mirroring the message keys emitted by src/game/*.ts.
// ---------------------------------------------------------------------------

const TEAM_SINGULAR = {
  en: { townsfolk: 'Townsfolk', outsider: 'Outsider', minion: 'Minion' },
  fr: { townsfolk: 'Villageois', outsider: 'Marginal', minion: 'Sbire' },
};
const TEAM_PLURAL = {
  en: { townsfolk: 'Townsfolk', outsider: 'Outsiders', minion: 'Minions' },
  fr: { townsfolk: 'Villageois', outsider: 'Marginaux', minion: 'Sbires' },
};

const MESSAGES = {
  en: {
    noTeamInPlay: (v) => `Neither ${v.a} nor ${v.b} is a ${TEAM_SINGULAR.en[v.team]} — there are no ${TEAM_PLURAL.en[v.team]} in play.`,
    investigativeInfo: (v) => `${v.a} or ${v.b} is the ${roleNameFor(v.role)}.`,
    chefInfo: (v) => `You see ${v.count} pair${v.count === 1 ? '' : 's'} of evil players sitting next to each other.`,
    empathInfo: (v) => `${v.count} of your 2 alive neighbours ${v.count === 1 ? 'is' : 'are'} evil.`,
    fortuneTellerYes: () => 'Yes — one of them is the Demon.',
    fortuneTellerNo: () => 'No — neither is the Demon.',
    undertakerInfo: (v) => `${v.name} was the ${roleNameFor(v.role)}.`,
    ravenkeeperInfo: (v) => `${v.name} is the ${roleNameFor(v.role)}.`,
    minionInfoSolo: (v) => `You have no fellow Minions. The Demon is ${v.demon || 'unknown'}.`,
    minionInfoGroup: (v) => `Your fellow Minion${v.names.length === 1 ? ' is' : 's are'} ${v.names.join(', ')}. The Demon is ${v.demon || 'unknown'}.`,
    demonInfo: (v) => `Your Minion${v.names.length === 1 ? ' is' : 's are'} ${v.names.join(', ') || 'no one'}. Those roles are not in this game: ${v.bluffs.map(roleNameFor).join(', ')}. You are safe to claim being one of them.`,
    spyGrimoire: (v) => 'Grimoire — ' + v.names.map((n, i) => `${n}: ${roleNameFor(v.roles[i])}${v.dead[i] ? ' (dead)' : ''}`).join('; ') + '.',
    poisonerChoose: () => 'Choose a player to poison.',
    monkChoose: () => 'Choose a player to protect (not yourself).',
    fortuneTellerChoose: () => 'Choose 2 players to check for the Demon.',
    butlerChoose: () => 'Choose a player to be your master (not yourself).',
    ravenkeeperChoose: () => 'You died! Choose a player to learn their character.',
    impChoose: () => 'Choose a player to kill.',
    empty: () => '',
    foundDead: (v) => `${v.name} was found dead this morning.`,
    nobodyDiedLastNight: () => 'Nobody died last night.',
    becameImp: () => 'You are now the Imp.',
    scarletWomanPromoted: () => 'The Demon has died — you are now the Imp.',
    wasExecuted: (v) => `${v.name} was executed.`,
    saintWins: (v) => `${v.name} was the Saint — evil wins!`,
    slayerHit: (v) => `${v.slayer} shoots ${v.target} — it was the Demon! They die.`,
    slayerMiss: (v) => `${v.slayer} shoots ${v.target} — nothing happens.`,
    virginExecutesNominator: (v) => `${v.name} nominated the Virgin and is executed immediately!`,
    nominates: (v) => `${v.nominator} nominates ${v.nominee}.`,
    onBlock: (v) => `${v.name} receives ${v.count} votes and is now on the block.`,
    tieClearsBlock: (v) => `${v.name} ties the current highest vote count — no one is on the block.`,
    notEnoughVotes: (v) => `${v.name} receives ${v.count} vote(s) — not enough to be on the block.`,
    noExecutionToday: () => 'No one was executed today.',
    goodWinsDemonDead: () => 'The Demon is dead — good wins!',
    evilWinsTwoLeft: () => 'Only 2 players remain with the Demon alive — evil wins!',
    goodWinsMayor: () => 'No execution with only 3 players left and the Mayor alive — good wins!',
    diedTonight: () => 'You died tonight.',
    survivedNight: () => 'You survived the night.',
    noExecutionSleep: () => 'Nobody has been killed today, the village goes to sleep.',
    executedYou: () => 'The village executed you.',
    executedOther: (v) => `${v.name} was executed by the village.`,
  },
  fr: {
    noTeamInPlay: (v) => `Ni ${v.a} ni ${v.b} n'est un ${TEAM_SINGULAR.fr[v.team]} — il n'y a aucun ${TEAM_PLURAL.fr[v.team]} en jeu.`,
    investigativeInfo: (v) => `${v.a} ou ${v.b} : ${roleNameFor(v.role)}.`,
    chefInfo: (v) => `Vous voyez ${v.count} paire${v.count === 1 ? '' : 's'} de joueurs maléfiques assis côte à côte.`,
    empathInfo: (v) => `${v.count} de vos 2 voisins vivants ${v.count === 1 ? 'est' : 'sont'} maléfique${v.count === 1 ? '' : 's'}.`,
    fortuneTellerYes: () => "Oui — l'un des deux est le Démon.",
    fortuneTellerNo: () => "Non — aucun des deux n'est le Démon.",
    undertakerInfo: (v) => `${v.name} était : ${roleNameFor(v.role)}.`,
    ravenkeeperInfo: (v) => `${v.name} est : ${roleNameFor(v.role)}.`,
    minionInfoSolo: (v) => `Vous n'avez aucun autre Sbire. Le Démon est ${v.demon || 'inconnu'}.`,
    minionInfoGroup: (v) => `Vos autres Sbires sont ${v.names.join(', ')}. Le Démon est ${v.demon || 'inconnu'}.`,
    demonInfo: (v) => `Sbire(s) : ${v.names.join(', ') || 'personne'}. Ces rôles ne sont pas dans cette partie : ${v.bluffs.map(roleNameFor).join(', ')}. Vous pouvez sans risque prétendre être l'un d'eux.`,
    spyGrimoire: (v) => 'Grimoire — ' + v.names.map((n, i) => `${n} : ${roleNameFor(v.roles[i])}${v.dead[i] ? ' (mort)' : ''}`).join('; ') + '.',
    poisonerChoose: () => 'Choisissez un joueur à empoisonner.',
    monkChoose: () => 'Choisissez un joueur à protéger (pas vous-même).',
    fortuneTellerChoose: () => 'Choisissez 2 joueurs pour vérifier le Démon.',
    butlerChoose: () => 'Choisissez un joueur qui sera votre maître (pas vous-même).',
    ravenkeeperChoose: () => 'Vous êtes mort ! Choisissez un joueur pour apprendre son personnage.',
    impChoose: () => 'Choisissez un joueur à tuer.',
    empty: () => '',
    foundDead: (v) => `${v.name} a été retrouvé(e) mort(e) ce matin.`,
    nobodyDiedLastNight: () => "Personne n'est mort cette nuit.",
    becameImp: () => 'Vous êtes maintenant le Démon.',
    scarletWomanPromoted: () => 'Le Démon est mort — vous êtes maintenant le Démon.',
    wasExecuted: (v) => `${v.name} a été exécuté(e).`,
    saintWins: (v) => `${v.name} était le Saint — le Mal gagne !`,
    slayerHit: (v) => `${v.slayer} tire sur ${v.target} — c'était le Démon ! Il/Elle meurt.`,
    slayerMiss: (v) => `${v.slayer} tire sur ${v.target} — il ne se passe rien.`,
    virginExecutesNominator: (v) => `${v.name} a nominé la Vierge et est exécuté(e) immédiatement !`,
    nominates: (v) => `${v.nominator} accuse ${v.nominee}.`,
    onBlock: (v) => `${v.name} reçoit ${v.count} votes et est maintenant sur le billot.`,
    tieClearsBlock: (v) => `${v.name} égalise le score le plus élevé — personne n'est sur le billot.`,
    notEnoughVotes: (v) => `${v.name} reçoit ${v.count} vote(s) — pas assez pour être sur le billot.`,
    noExecutionToday: () => "Personne n'a été exécuté aujourd'hui.",
    goodWinsDemonDead: () => 'Le Démon est mort — le Bien gagne !',
    evilWinsTwoLeft: () => 'Il ne reste que 2 joueurs avec le Démon vivant — le Mal gagne !',
    goodWinsMayor: () => 'Aucune exécution avec seulement 3 joueurs restants et le Maire vivant — le Bien gagne !',
    diedTonight: () => 'Vous êtes mort cette nuit.',
    survivedNight: () => 'Vous avez survécu à la nuit.',
    noExecutionSleep: () => "Personne n'a été tué aujourd'hui, le village va se coucher.",
    executedYou: () => 'Le village vous a exécuté.',
    executedOther: (v) => `${v.name} a été exécuté(e) par le village.`,
  },
};

/** Renders a server-sent {key, vars} message descriptor into localized text. This is the single
 * point where game narration turns into an actual sentence — the server never sends prose. */
function tMsg(m) {
  if (!m) return '';
  const fn = (MESSAGES[LANG] && MESSAGES[LANG][m.key]) || MESSAGES.en[m.key];
  return fn ? fn(m.vars || {}) : m.key;
}

const TEAM_LABELS = {
  en: { townsfolk: 'Townsfolk', outsider: 'Outsiders', minion: 'Minions', demon: 'Demon' },
  fr: { townsfolk: 'Villageois', outsider: 'Marginaux', minion: 'Sbires', demon: 'Démons' },
};

function teamLabel(team) {
  return (TEAM_LABELS[LANG] || TEAM_LABELS.en)[team] || team;
}

const ALIGNMENT_LABELS = {
  en: { good: 'Good', evil: 'Evil' },
  fr: { good: 'Bon', evil: 'Maléfique' },
};

function alignmentLabel(alignment) {
  return (ALIGNMENT_LABELS[LANG] || ALIGNMENT_LABELS.en)[alignment] || alignment;
}

function setLang(lang) {
  LANG = lang;
  sessionStorage.setItem('botc.lang', lang);
  render();
}

function langButton() {
  return el(
    'button',
    { class: 'secondary lang-btn', onclick: () => setLang(LANG === 'fr' ? 'en' : 'fr') },
    t('langLabel')
  );
}

function showRolesModal() {
  loadCharacters().then((chars) => {
    const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
    const teams = ['townsfolk', 'outsider', 'minion', 'demon'];
    const localized = chars.map((c) => localizeChar(c));
    const body = el('div', { class: 'modal-body' });

    function renderSections(query) {
      const q = query.trim().toLowerCase();
      body.innerHTML = '';
      let matched = false;
      for (const team of teams) {
        const teamChars = localized.filter(
          (c) => c.team === team && (!q || c.name.toLowerCase().includes(q) || c.ability.toLowerCase().includes(q))
        );
        if (!teamChars.length) continue;
        matched = true;
        body.appendChild(
          el('div', { class: 'roles-section' }, [
            el('h3', { class: 'roles-team ' + team }, [svgIcon(team, 'roles-team-icon'), teamLabel(team)]),
            ...teamChars.map((c) =>
              el('div', { class: 'roles-card ' + team }, [
                svgIcon(c.id, 'roles-card-icon'),
                el('div', { class: 'roles-card-text' }, [
                  el('div', { class: 'roles-name' }, c.name),
                  el('div', { class: 'roles-ability' }, glossify(c.ability)),
                ]),
              ])
            ),
          ])
        );
      }
      if (!matched) body.appendChild(el('p', { class: 'muted center' }, t('noRolesMatch')));
    }

    renderSections('');
    const searchInput = el('input', {
      placeholder: t('searchRoles'),
      class: 'roles-search',
      oninput: (e) => renderSections(e.target.value),
    });

    overlay.appendChild(
      el('div', { class: 'modal' }, [
        el('div', { class: 'modal-header' }, [
          el('h2', {}, t('allRolesTitle')),
          el('button', { class: 'secondary', onclick: () => overlay.remove() }, t('close')),
        ]),
        el('div', { class: 'modal-search' }, [searchInput]),
        body,
      ])
    );
    document.body.appendChild(overlay);
  });
}

// ---------------------------------------------------------------------------
// Glossary: game terms in any text block are underlined; tapping one opens its strict definition
// (see glossary.js). Only the first occurrence of each term per block is underlined.
// ---------------------------------------------------------------------------

/** Wraps `text` in a span where each glossary term's first occurrence is a tappable, underlined link. */
function glossify(text, excludeId) {
  return el(
    'span',
    {},
    glossarySegments(text || '', LANG, excludeId).map((seg) => (seg.id ? termLink(seg.id, seg.text) : seg.text))
  );
}

function termLink(id, label) {
  const open = (e) => {
    e.preventDefault();
    e.stopPropagation(); // a term inside a tappable row (e.g. a nomination) must not also tap the row
    showTermModal(id);
  };
  return el('span', {
    class: 'term', role: 'button', tabindex: '0',
    onclick: open,
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); },
  }, label);
}

function showTermModal(id) {
  const entry = GLOSSARY.find((g) => g.id === id);
  if (!entry) return;
  const { title, def } = entry[LANG] || entry.en;
  document.querySelectorAll('.term-overlay').forEach((o) => o.remove()); // one definition at a time
  const close = () => overlay.remove();
  const overlay = el('div', { class: 'modal-overlay term-overlay', onclick: (e) => { if (e.target === overlay) close(); } });
  overlay.appendChild(
    el('div', { class: 'modal term-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      el('div', { class: 'modal-header' }, [
        el('h2', {}, title),
        el('button', { class: 'secondary', onclick: close }, t('close')),
      ]),
      // Other terms inside a definition link onward too.
      el('div', { class: 'modal-body term-def' }, glossify(def, id)),
    ])
  );
  document.body.appendChild(overlay);
}

function rolesButton() {
  return el('button', { class: 'secondary roles-btn', onclick: showRolesModal }, '📜 ' + t('allRoles'));
}

function leaveGame() {
  if (!confirm(t('leaveConfirm'))) return;
  send({ t: 'leave' });
  sessionStorage.removeItem('botc.code');
  sessionStorage.removeItem('botc.token');
  sessionStorage.removeItem('botc.playerId');
  state.code = null;
  state.token = null;
  state.playerId = null;
  state.view = null;
  state.dawnSeenForDay = null;
  state.duskSeenForNight = null;
  state.nightResultSeenForNight = null;
  render();
}

function leaveButton() {
  return el('button', { class: 'secondary leave-btn', onclick: leaveGame }, '🚪 ' + t('leaveGame'));
}

// The countdown ticker and small data updates (a vote coming in, a seating pick changing) cause
// a full re-render every second or so. Replaying the screen's entrance animation on every one of
// those made the UI visibly flash. Only animate when the screen's actual identity changes.
let lastScreenSignature = null;
let animateThisRender = true;

function renderScreen(children) {
  return el('div', { class: 'screen' + (animateThisRender ? '' : ' no-anim') }, children);
}

function aliveStatus(v) {
  let text;
  let cls;
  if (v.amIAlive) {
    text = t('youAlive');
    cls = 'alive';
  } else if (!v.myGhostVoteUsed) {
    text = t('youDeadOneVote');
    cls = 'dead';
  } else {
    text = t('youDeadNoVote');
    cls = 'dead';
  }
  return el('div', { class: 'status-bar ' + cls }, glossify(text));
}

function roleBanner(v) {
  if (!v.myCharacter) return null;
  const toggleBtn = el(
    'button',
    {
      class: 'secondary role-hide-btn',
      onclick: () => {
        state.roleHidden = !state.roleHidden;
        render();
      },
    },
    state.roleHidden ? '👁 ' + t('showRole') : '🙈 ' + t('hideRole')
  );

  // Hiding shows only your alive/vote status — no alignment-colored background either, since
  // that alone can hint good/evil to anyone glancing at the screen.
  if (state.roleHidden) {
    return el('div', { class: 'role-banner hidden' + (animateThisRender ? '' : ' no-anim') }, [aliveStatus(v), toggleBtn]);
  }

  const alignCls = v.myCharacter.alignment === 'evil' ? 'evil' : 'good';
  const char = localizeChar(v.myCharacter);
  const team = charactersCache && charactersCache.find((c) => c.id === v.myCharacter.id)?.team;
  const icon = svgIcon(ICON_PATHS[v.myCharacter.id] ? v.myCharacter.id : (alignCls === 'evil' ? 'demon' : 'townsfolk'), 'role-icon');
  return el('div', { class: 'role-banner ' + alignCls + (animateThisRender ? '' : ' no-anim') }, [
    aliveStatus(v),
    toggleBtn,
    icon,
    el('div', { class: 'align' }, alignmentLabel(v.myCharacter.alignment)),
    team ? el('div', { class: 'team' }, teamLabel(team)) : null,
    el('div', { class: 'name' }, char.name),
    el('div', { class: 'ability' }, glossify(char.ability)),
  ]);
}

function secondsLeft(ts) {
  return Math.max(0, Math.ceil((ts - Date.now()) / 1000));
}

function playerRow(p, opts = {}) {
  const children = [
    el('div', { class: 'seat' }, String(p.seat + 1)),
    el('div', {}, p.name + (p.isSelf ? t('you') : '')),
  ];
  if (opts.showSeating) {
    children.push(
      el('div', { class: 'vote-status ' + (p.hasDeclaredSeating ? 'yes' : 'muted') }, p.hasDeclaredSeating ? t('seated') : t('seatingEllipsis'))
    );
  }
  if (opts.showDayStatus) {
    const badges = el('div', { class: 'day-badges' });
    // Alive rows need no badge — normal (non-struck-through) styling already says "alive" —
    // but "dead" alone doesn't say whether their one ghost vote is still available.
    if (!p.alive) {
      badges.appendChild(
        el('span', { class: 'badge ' + (p.ghostVoteUsed ? 'muted' : 'yes') }, p.ghostVoteUsed ? t('voteUsedBadge') : t('voteLeftBadge'))
      );
    }
    if (p.hasNominatedToday) badges.appendChild(el('span', { class: 'badge cross' }, t('nominatedBadge')));
    if (p.hasBeenNominatedToday) badges.appendChild(el('span', { class: 'badge cross' }, t('accusedBadge')));
    if (badges.childNodes.length) children.push(badges);
  }
  children.push(el('div', { class: 'dot ' + (p.connected ? 'on' : 'off') }));
  return el('div', { class: 'player-row' + (p.alive === false ? ' dead' : '') }, children);
}

function renderLog(v) {
  if (!v.publicLog.length) return null; // nothing has happened yet — an empty card here just reads as a mystery blank box
  return el('div', { class: 'card' }, [
    el('h2', {}, t('villageLog')),
    el(
      'div',
      { class: 'log' },
      v.publicLog
        .slice(-12)
        .reverse()
        .map((line) => el('div', { class: 'log-entry' }, glossify(tMsg(line))))
    ),
  ]);
}

function renderLanding() {
  const nameInput = el('input', { placeholder: t('yourName'), value: localStorage.getItem('botc.name') || '' });
  const codeInput = el('input', { placeholder: t('roomCode') });
  codeInput.style.textTransform = 'uppercase';

  const joinBtn = el(
    'button',
    {
      class: 'block',
      onclick: () => {
        const name = nameInput.value.trim();
        const code = codeInput.value.trim().toUpperCase();
        if (!name || !code) return showError(t('enterNameCode'));
        localStorage.setItem('botc.name', name);
        doJoin(code, name);
      },
    },
    t('joinGame')
  );

  const createBtn = el(
    'button',
    {
      class: 'block secondary',
      onclick: async () => {
        const name = nameInput.value.trim();
        if (!name) return showError(t('enterNameFirst'));
        localStorage.setItem('botc.name', name);
        const res = await fetch('/api/rooms', { method: 'POST' });
        const data = await res.json();
        doJoin(data.code, name);
      },
    },
    t('createNewGame')
  );

  return renderScreen([
    el('div', { class: 'hero' }, [
      el('div', { class: 'hero-icon' }, svgIcon('logo')),
      el('h1', { class: 'hero-title' }, 'Blood on the Clocktower'),
      el('p', { class: 'hero-tagline' }, t('heroTagline')),
    ]),
    el('div', { class: 'card', style: 'display:flex;flex-direction:column;gap:10px;' }, [nameInput, codeInput, joinBtn]),
    el('div', { class: 'center muted' }, t('or')),
    createBtn,
  ]);
}

function rightNeighborSelect(v) {
  // Anyone but yourself — no other restriction here. Whether the picks actually form one
  // consistent circle is checked all at once by seatingConfirmed, not per-answer.
  const others = v.players.filter((p) => p.id !== v.selfId);
  const current = v.mySeatRightId;
  return el(
    'select',
    { onchange: (e) => send({ t: 'declareNeighbor', neighborId: e.target.value }) },
    [
      el('option', { value: '', disabled: 'true', selected: current ? null : 'true' }, t('chooseOption')),
      ...others.map((p) => el('option', { value: p.id, selected: p.id === current ? 'true' : null }, p.name)),
    ]
  );
}

// Walks the "who's on your right" pointers into a display order for the circle diagram: chains
// with a clear starting point (no one claims them as their right) are walked first so partial
// progress reads left-to-right sensibly; whatever's left over must be part of a cycle (every
// node in it has both an incoming and outgoing edge) and gets walked too. When the seating is
// fully confirmed this always recovers the exact real circle, since every node has exactly one
// edge in and one out.
function computeSeatingOrder(players) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const hasIncoming = new Set(players.filter((p) => p.declaredRightId).map((p) => p.declaredRightId));
  const visited = new Set();
  const order = [];
  const walk = (start) => {
    let cur = start;
    while (cur && !visited.has(cur.id)) {
      order.push(cur);
      visited.add(cur.id);
      cur = cur.declaredRightId ? byId.get(cur.declaredRightId) : null;
    }
  };
  for (const p of players) if (!visited.has(p.id) && !hasIncoming.has(p.id)) walk(p);
  for (const p of players) if (!visited.has(p.id)) walk(p);
  return order;
}

function svgEl(tag, attrs = {}) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, val);
  return e;
}

// Original icon set (not the official Blood on the Clocktower artwork, which the publisher's
// Community Created Content Policy doesn't allow in a digital tool) — a bell/moon mark for the
// app, one emblem per team, and one simple pictogram per Trouble Brewing character, all drawn
// from scratch as plain shapes.
const ICON_PATHS = {
  logo: '<path d="M12 2a1 1 0 0 1 1 1v1.07A7.002 7.002 0 0 1 19 11v3.38l1.45 2.9A1 1 0 0 1 19.55 19H4.45a1 1 0 0 1-.9-1.72L5 14.38V11a7.002 7.002 0 0 1 6-6.93V3a1 1 0 0 1 1-1z"/><rect x="10" y="20" width="4" height="2" rx="1"/>',
  townsfolk: '<path d="M12 2c.3 1.6-.4 2.5-1.1 3.6-.5.8-.9 1.7-.9 2.9a2.5 2.5 0 0 0 5 0c0-.9-.4-1.6-.9-2.2 1.7 1 2.9 2.8 2.9 4.7a4.5 4.5 0 1 1-9 0c0-3.6 2.6-5.9 4-9z"/><rect x="11" y="15" width="2" height="7" rx="1"/>',
  outsider: '<path d="M14.5 3a8.5 8.5 0 1 0 0 17 6.8 6.8 0 0 1 0-17z"/><circle cx="18.6" cy="6" r="1.2"/>',
  minion: '<path d="M12 1.5 13 12h-2z"/><rect x="8.5" y="12" width="7" height="2" rx="0.5"/><rect x="11" y="14.5" width="2" height="7.5" rx="1"/>',
  demon: '<circle cx="12" cy="13.5" r="6"/><path d="M6.5 10 3 3.5 9 8Z"/><path d="M17.5 10 21 3.5 15 8Z"/>',

  washerwoman: '<path d="M4 15a8 8 0 0 1 16 0z"/><path d="M2.5 15h19l-1.6 5.6a1 1 0 0 1-1 .7H5.1a1 1 0 0 1-1-.7L2.5 15z"/>',
  librarian: '<path d="M12 5.2c-1.9-1.2-4.3-1.7-6.8-1.3a1 1 0 0 0-.8 1v11.9c0 .6.5 1.1 1.2 1 2.2-.4 4.5.1 6.4 1.4V5.2z"/><path d="M12 5.2c1.9-1.2 4.3-1.7 6.8-1.3a1 1 0 0 1 .8 1v11.9c0 .6-.5 1.1-1.2 1-2.2-.4-4.5.1-6.4 1.4V5.2z"/>',
  investigator: '<circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2.6"/><rect x="16.6" y="16.6" width="3" height="7.4" rx="1.3" transform="rotate(45 18.1 20.3)"/>',
  chef: '<path d="M12 3a4 4 0 0 1 3.9 3.2A3.6 3.6 0 0 1 18.5 9.5c0 1.3-.7 2.4-1.7 3.1V15H7.2v-2.4c-1-.7-1.7-1.8-1.7-3.1a3.6 3.6 0 0 1 2.6-3.3A4 4 0 0 1 12 3z"/><rect x="8.2" y="16" width="7.6" height="5" rx="1"/>',
  empath: '<path d="M12 20 5.4 13.6a4.5 4.5 0 0 1 6.4-6.3l.2.2.2-.2a4.5 4.5 0 0 1 6.4 6.3z"/>',
  fortuneteller: '<path d="M6.2 19a5.8 5.8 0 0 1 11.6 0z"/><circle cx="12" cy="10.2" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m12 7.4.9 2 2.2.3-1.6 1.5.4 2.2-1.9-1-1.9 1 .4-2.2-1.6-1.5 2.2-.3z"/>',
  undertaker: '<rect x="11" y="2" width="2" height="12.5" rx="1"/><path d="M6.5 12.5a5.5 5.5 0 0 0 11 0z"/>',
  monk: '<path d="M12 2.2a6 6 0 0 1 6 6v1.5c1.7.9 2.8 2.7 2.8 4.7V21H5.2v-6.6c0-2 1.1-3.8 2.8-4.7V8.2a6 6 0 0 1 4-5.9z"/>',
  ravenkeeper: '<ellipse cx="12" cy="14" rx="6.4" ry="4"/><path d="M17.8 12 22 8.8l-3.4 5.6z"/><path d="M6.5 12.4 2.5 10l3 4.4z"/>',
  virgin: '<circle cx="12" cy="7" r="2.3"/><circle cx="17" cy="11" r="2.3"/><circle cx="15" cy="17" r="2.3"/><circle cx="9" cy="17" r="2.3"/><circle cx="7" cy="11" r="2.3"/><circle cx="12" cy="12" r="2"/>',
  slayer: '<rect x="11" y="2" width="2" height="19" rx="1" transform="rotate(20 12 11.5)"/><rect x="11" y="2" width="2" height="19" rx="1" transform="rotate(-20 12 11.5)"/>',
  soldier: '<path d="M12 2 19 5v6c0 5-3.5 8.5-7 9-3.5-.5-7-4-7-9V5z"/>',
  mayor: '<circle cx="12" cy="9" r="5.5"/><path d="m9 14-2.5 7 5.5-2.5L17.5 21 15 14z" opacity="0.85"/>',
  butler: '<path d="M2 8v8l8-4z"/><path d="M22 8v8l-8-4z"/><rect x="10" y="9.4" width="4" height="5.2" rx="1"/>',
  drunk: '<path d="M10 2h4v3.4l1.6 2.2c.5.7.8 1.5.8 2.4V20a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-10c0-.9.3-1.7.8-2.4L10 5.4z"/>',
  recluse: '<path d="M12 2 6 21h12z"/><circle cx="12" cy="9" r="3"/>',
  saint: '<ellipse cx="12" cy="6" rx="5" ry="1.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 9c-2.8 0-5 2.4-5 5.4V21h10v-6.6C17 11.4 14.8 9 12 9z"/>',
  poisoner: '<path d="M10 2h4v5.5l3.6 8.2A2 2 0 0 1 15.8 21H8.2a2 2 0 0 1-1.8-5.3L10 7.5z"/><rect x="9" y="2" width="6" height="2" rx="0.6"/>',
  spy: '<path fill-rule="evenodd" d="M1.4 12S5 5.4 12 5.4 22.6 12 22.6 12 19 18.6 12 18.6 1.4 12 1.4 12zm10.6 3.1a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2z"/>',
  scarletwoman: '<path d="M12 2c1 3-1 4-2 6-1 2 0 3 1 3.4-1-2 .5-3 1.5-4C13 9 15 10 15 13a5 5 0 0 1-10 0c0-3 2-4.6 3-6C9.5 5 10 3 12 2z"/>',
  baron: '<path d="M4 18 3 8l4.5 3L12 5l4.5 6L21 8l-1 10z"/><circle cx="12" cy="16" r="1.3"/>',
  imp: '<path fill-rule="evenodd" d="M12 8.2a5.8 5.8 0 1 0 0 11.6 5.8 5.8 0 0 0 0-11.6zM7.4 5 4 3l1.6 4.6zM16.6 5l3.4-2-1.6 4.6zM9.9 12.6a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2zm4.2 0a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z"/>',
};

function svgIcon(name, extraClass) {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', class: 'icon-svg' + (extraClass ? ' ' + extraClass : '') });
  svg.innerHTML = ICON_PATHS[name] || '';
  return svg;
}

function renderSeatingGraph(v) {
  const order = computeSeatingOrder(v.players);
  const n = order.length;
  const size = 300;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 56;
  const nodeR = 16;
  const color = v.seatingConfirmed ? 'var(--good)' : 'var(--accent)';

  const pos = new Map();
  order.forEach((p, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    pos.set(p.id, {
      x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle),
      labelX: cx + (r + 30) * Math.cos(angle), labelY: cy + (r + 30) * Math.sin(angle),
    });
  });

  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, class: 'seating-graph' });

  const defs = svgEl('defs');
  const marker = svgEl('marker', {
    id: 'seat-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5',
    markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse',
  });
  const arrowHead = svgEl('path', { d: 'M0,0 L10,5 L0,10 z', fill: color });
  marker.appendChild(arrowHead);
  defs.appendChild(marker);
  svg.appendChild(defs);

  for (const p of order) {
    if (!p.declaredRightId) continue;
    const from = pos.get(p.id);
    const to = pos.get(p.declaredRightId);
    if (!from || !to) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const line = svgEl('line', {
      x1: from.x + (dx / dist) * nodeR, y1: from.y + (dy / dist) * nodeR,
      x2: to.x - (dx / dist) * (nodeR + 7), y2: to.y - (dy / dist) * (nodeR + 7),
      stroke: color, 'stroke-width': '2', 'marker-end': 'url(#seat-arrow)',
    });
    svg.appendChild(line);
  }

  for (const p of order) {
    const { x, y, labelX, labelY } = pos.get(p.id);
    svg.appendChild(
      svgEl('circle', { cx: x, cy: y, r: nodeR, fill: p.id === v.selfId ? 'var(--accent)' : 'var(--panel-2)', stroke: 'var(--border)' })
    );
    const label = svgEl('text', {
      x: labelX, y: labelY, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': '11', fill: p.hasDeclaredSeating ? 'var(--text)' : 'var(--muted)',
    });
    label.textContent = p.name + (p.id === v.selfId ? t('you') : '');
    svg.appendChild(label);
  }

  const wrapper = el('div', { class: 'seating-graph-wrap' });
  wrapper.appendChild(svg);
  return wrapper;
}

function renderSeatingSetup(v) {
  const pending = v.players.filter((p) => !p.hasDeclaredSeating).map((p) => p.name);
  let status;
  if (v.players.length < 3) {
    status = el('p', { class: 'muted center' }, t('needAtLeast3'));
  } else if (v.seatingConfirmed) {
    status = el('p', { class: 'muted center' }, t('seatingConfirmed'));
  } else if (pending.length) {
    status = el('p', { class: 'muted center' }, t('waitingOnSeating', pending.join(', ')));
  } else {
    status = el('p', { class: 'muted center' }, t('notFullCircle'));
  }

  return el('div', { class: 'card' }, [
    el('h2', {}, t('seating')),
    el('p', { class: 'muted' }, t('seatingIntro')),
    el('label', { class: 'muted', style: 'display:block;margin-top:10px;font-size:0.85rem;' }, [
      t('whoRight'),
      rightNeighborSelect(v),
    ]),
    status,
    v.players.length >= 3 ? renderSeatingGraph(v) : null,
  ]);
}

function renderLobby(v) {
  const isHost = v.hostId === v.selfId;
  const count = v.players.length;
  const countOk = count >= 5 && count <= 15;
  const canStart = countOk && v.seatingConfirmed;
  let startLabel = t('startGame', count);
  if (!countOk) startLabel = t('need5to15', count);
  else if (!v.seatingConfirmed) startLabel = t('waitingOnSeatingConfirm');

  return renderScreen([
    el('h1', {}, t('lobby')),
    el('div', { class: 'code-badge' }, v.code),
    el('p', { class: 'muted center' }, t('shareCode')),
    el('div', { class: 'card player-list' }, v.players.map((p) => playerRow(p, { showSeating: true }))),
    renderSeatingSetup(v),
    isHost
      ? el('button', { class: 'block', disabled: !canStart ? 'true' : null, onclick: () => send({ t: 'start' }) }, startLabel)
      : el('p', { class: 'muted center' }, t('waitingHost')),
  ]);
}

function toggleChoice(selected, id, max) {
  const i = selected.indexOf(id);
  if (i >= 0) {
    selected.splice(i, 1);
    return;
  }
  if (max <= 1) selected.length = 0;
  else if (selected.length >= max) selected.shift();
  selected.push(id);
}

function submitTurn(t) {
  if (turnSecondsLeft() > 0) return;
  if (t.shape === 'choose') send({ t: 'nightReal', targetIds: state.selected.slice() });
  else send({ t: 'nightReal', targetIds: [] });
  state.selected = [];
  // After a Fortune Teller / Ravenkeeper step, the real player sees their result: a decoy gets
  // a result screen too, so the two look the same from across the table.
  if (t.decoy && t.decoyResult) state.decoyResultStep = t.stepKey;
}

function renderDawnScreen(v) {
  return renderScreen([
    el('div', { class: 'moon' }, '☀️'),
    el('h1', { class: 'center' }, t('day', v.day)),
    el('div', { class: 'card center' }, el('h2', {}, glossify(tMsg(v.dawnMessage)))),
    el(
      'button',
      {
        class: 'block',
        onclick: () => {
          state.dawnSeenForDay = v.day;
          render();
        },
      },
      t('continueBtn')
    ),
  ]);
}

function noTalkingBanner() {
  return el('div', { class: 'no-talking' }, t('noTalking'));
}

function renderDuskScreen(v) {
  return renderScreen([
    el('div', { class: 'moon' }, '🌙'),
    el('h1', { class: 'center' }, t('night', v.night)),
    noTalkingBanner(),
    el('div', { class: 'card center' }, el('h2', {}, glossify(tMsg(v.duskMessage)))),
    el(
      'button',
      {
        class: 'block',
        onclick: () => {
          state.duskSeenForNight = v.night;
          render();
        },
      },
      t('continueBtn')
    ),
  ]);
}

// Shown for a night result (Fortune Teller / Ravenkeeper) regardless of the current phase — a
// fast night can already have moved on to 'day' by the time this renders, but the player must
// still get a screen they actively dismiss before seeing whatever comes next, exactly like the
// dawn/dusk screens. Requires an explicit "Got it" tap rather than just fading away on its own,
// so a quick game around the table can never race past it.
function renderNightResultScreen(v) {
  return renderResultScreen(v, tMsg(v.nightResult), () => {
    state.nightResultSeenForNight = v.night;
  });
}

/** The decoy's stand-in for a result screen — laid out exactly like the real one. */
function renderDecoyResultScreen(v) {
  return renderResultScreen(v, t('decoyResult'), () => {
    state.decoyResultStep = null;
  }, true);
}

function renderResultScreen(v, text, onDone, isDecoy) {
  return renderScreen([
    roleBanner(v),
    el('div', { class: 'moon' }, '🌙'),
    el('h1', { class: 'center' }, t('night', v.night)),
    noTalkingBanner(),
    el('div', { class: 'card' }, [
      el('h2', {}, t('yourResult')),
      el('p', { class: 'muted' }, glossify(text)),
      isDecoy ? el('p', { class: 'muted decoy-note' }, t('decoyNote')) : null,
    ]),
    el(
      'button',
      {
        class: 'block',
        onclick: () => {
          onDone();
          render();
        },
      },
      t('gotIt')
    ),
  ]);
}

function renderNight(v) {
  const banner = el('div', { class: 'moon' }, '🌙');

  if (v.nightTurn) {
    const turn = v.nightTurn;
    const children = [
      roleBanner(v),
      banner,
      el('h1', { class: 'center' }, t('night', v.night)),
      noTalkingBanner(),
      el('div', { class: 'card' }, [
        el('h2', {}, turn.shape === 'info' ? t('yourInformation') : t('yourTurn')),
        el('p', { class: 'muted' }, glossify(turn.decoy ? t(turn.body.key) : tMsg(turn.body))),
        turn.decoy ? el('p', { class: 'muted decoy-note' }, t('decoyNote')) : null,
      ]),
    ];
    // Nobody can answer in the first 5 seconds of a step — real turn or decoy alike.
    const wait = turnSecondsLeft();
    const label = (text) => (wait > 0 ? `${text} (${wait})` : text);

    if (turn.shape === 'choose') {
      const grid = el(
        'div',
        { class: 'choice-grid' },
        turn.choices.map((c) =>
          el(
            'button',
            {
              class: 'choice' + (state.selected.includes(c.id) ? ' selected' : '') + (c.alive ? '' : ' dead'),
              onclick: () => {
                toggleChoice(state.selected, c.id, turn.max);
                render();
              },
            },
            `${c.seat + 1}. ${c.name}` + (c.alive ? '' : t('deadSuffix'))
          )
        )
      );
      children.push(grid);
      children.push(
        el(
          'button',
          { class: 'block', disabled: wait > 0 || state.selected.length < turn.min ? 'true' : null, onclick: () => submitTurn(turn) },
          label(t('confirm'))
        )
      );
    } else {
      children.push(el('button', { class: 'block', disabled: wait > 0 ? 'true' : null, onclick: () => submitTurn(turn) }, label(t('gotIt'))));
    }
    return renderScreen(children);
  }

  // Between steps: you've answered, the others haven't yet. The same screen for everyone.
  return renderScreen([
    roleBanner(v),
    banner,
    el('h1', { class: 'center pulse' }, t('night', v.night)),
    noTalkingBanner(),
    el('p', { class: 'muted center' }, v.amIAlive ? t('waitingEveryone') : t('deadRest')),
  ]);
}

function renderVoteList(v, n) {
  return el(
    'div',
    { class: 'vote-list' },
    n.voteOrder.map(({ id, name }) => {
      const voted = id in n.votes;
      const isCurrent = id === n.currentVoterId;
      let status = t('waitingDots');
      let statusClass = 'muted';
      if (voted) {
        status = n.votes[id] ? t('voteYes') : t('voteNo');
        statusClass = n.votes[id] ? 'yes' : 'no';
      } else if (isCurrent) {
        status = t('votingEllipsis');
        statusClass = 'current';
      }
      return el('div', { class: 'vote-row' + (isCurrent ? ' current' : '') }, [
        el('div', {}, name + (id === v.selfId ? t('you') : '')),
        el('div', { class: 'vote-status ' + statusClass }, status),
      ]);
    })
  );
}

function renderNomination(v) {
  const n = v.nomination;
  const card = [el('h2', {}, glossify(t('accuses', n.nominatorName, n.nomineeName)))];

  if (n.state === 'readyForAccusation') {
    // Everyone — including the dead, who are still watching — has to signal ready before the
    // accusation's timer starts. The defense needs no such step: it follows straight on.
    const total = v.players.length;
    const readyCount = n.readyBy.length;
    const amReady = n.readyBy.includes(v.selfId);
    card.push(el('p', { class: 'muted center' }, glossify(t('readyForAccusation'))));
    card.push(el('p', { class: 'muted center' }, t('readyCount', readyCount, total)));
    card.push(
      el(
        'button',
        { class: 'block' + (amReady ? ' secondary' : ''), onclick: () => send({ t: 'readySpeech' }) },
        amReady ? t('cancelReady') : t('imReadyAccusation', n.nominatorName, n.nomineeName)
      )
    );
  } else if (n.state === 'accusing') {
    card.push(el('p', { class: 'muted center' }, t('makingCase', n.nominatorName, secondsLeft(n.phaseEndsAt))));
    if (v.selfId === n.nominatorId) {
      card.push(el('button', { class: 'block secondary', onclick: () => send({ t: 'skipSpeech' }) }, t('doneMoveDefense')));
    }
  } else if (n.state === 'defending') {
    card.push(el('p', { class: 'muted center' }, t('responding', n.nomineeName, secondsLeft(n.phaseEndsAt))));
    if (v.selfId === n.nomineeId) {
      card.push(el('button', { class: 'block secondary', onclick: () => send({ t: 'skipSpeech' }) }, t('doneStartVote')));
    }
  } else if (n.state === 'voting') {
    if (v.selfId === n.currentVoterId) {
      card.push(el('p', { class: 'center' }, glossify(t('yourTurnVote', n.nomineeName))));
      card.push(
        el('div', { class: 'footer-actions' }, [
          el('button', { onclick: () => send({ t: 'vote', yes: true }) }, t('yesExecute', n.nomineeName)),
          el('button', { class: 'secondary', onclick: () => send({ t: 'vote', yes: false }) }, t('no')),
        ])
      );
    } else {
      card.push(el('p', { class: 'muted center pulse' }, t('waitingOnVoter', n.currentVoterName || '…')));
    }
    card.push(renderVoteList(v, n));
  }

  return el('div', { class: 'card' }, card);
}

function renderEndDayConsensus(v) {
  if (!v.amIAlive) return null;
  const names = v.endDayReadyNames.length ? ` (${v.endDayReadyNames.join(', ')})` : '';
  return el('div', { class: 'card' }, [
    el('h2', {}, t('endTheDay')),
    el('p', { class: 'muted' }, t('readyToMoveOn', v.endDayReadyCount, v.endDayAliveCount, names)),
    el(
      'button',
      { class: 'block' + (v.myEndDayReady ? ' secondary' : ''), onclick: () => send({ t: 'endDay' }) },
      v.myEndDayReady ? t('changedMind') : t('readyToEnd')
    ),
    el('p', { class: 'muted center seated-note' }, t('mustBeSeated')),
  ]);
}

function renderDay(v) {
  const self = v.players.find((p) => p.id === v.selfId);
  const children = [el('h1', {}, t('day', v.day)), roleBanner(v)];

  if (v.onBlockId) {
    const onBlock = v.players.find((p) => p.id === v.onBlockId);
    children.push(el('div', { class: 'card center' }, glossify(t('onBlock', onBlock ? onBlock.name : '?'))));
  }

  if (v.nomination) {
    children.push(renderNomination(v));
  } else {
    children.push(
      el('p', { class: 'muted center' }, glossify(self && self.alive
        ? t('tapToNominate')
        : v.myGhostVoteUsed
          ? t('deadNoVoteLeft')
          : t('deadOneVoteLeft')
      ))
    );
    children.push(
      el(
        'div',
        { class: 'card player-list' },
        v.players.map((p) => {
          const row = playerRow(p, { showDayStatus: true });
          // Any player can be nominated — yourself and the dead included (rarely wise, but legal);
          // those two get a confirmation, since a stray tap would waste today's nomination.
          if (self && self.alive && !self.hasNominatedToday && !p.hasBeenNominatedToday) {
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
              if (p.id === v.selfId && !confirm(t('nominateSelfConfirm'))) return;
              if (p.id !== v.selfId && !p.alive && !confirm(t('nominateDeadConfirm', p.name))) return;
              send({ t: 'nominate', nomineeId: p.id });
            });
          }
          return row;
        })
      )
    );
    children.push(renderEndDayConsensus(v));
  }

  // Shown to every living player who hasn't fired yet — not just the Slayer — so anyone can bluff
  // a shot and nobody can tell the real Slayer from their screen.
  if (v.myCharacter && !v.mySlayerUsed && v.amIAlive) {
    children.push(
      el('div', { class: 'card' }, [
        el('h2', {}, t('slayerShot')),
        el('p', { class: 'muted' }, glossify(t('slayerDesc'))),
        el(
          'div',
          { class: 'choice-grid' },
          v.players
            .map((p) =>
              el(
                'button',
                {
                  class: 'choice',
                  onclick: () => {
                    if (confirm(t('publiclyAccuse', p.name))) send({ t: 'slayer', targetId: p.id });
                  },
                },
                p.name
              )
            )
        ),
      ])
    );
  }

  if (v.myLog && v.myLog.length) {
    children.push(
      el('div', { class: 'card' }, [
        el('h2', {}, t('yourInformation')),
        el(
          'div',
          { class: 'log' },
          v.myLog.map((e) => el('div', { class: 'log-entry' }, glossify(`${t('night', e.night)}: ${tMsg(e.msg)}`)))
        ),
      ])
    );
  }

  children.push(renderLog(v));
  return renderScreen(children);
}

// ---------------------------------------------------------------------------
// The replay: once the game is over, everything that really happened, in order — including all
// the secrets (who did what at night, what was poisoned, what information was false and why).
// The server sends a list of events (players and characters as ids); each one is worded here,
// in either language, by REPLAY[lang][type]. A template returns one or more lines; player
// tokens (c.P) are turned into coloured "Name (Role)" spans when drawn.
// ---------------------------------------------------------------------------

const REPLAY = {
  en: {
    roles: (e, c) => [
      'Roles dealt:',
      ...e.players.map((p) => c.P(p.id) + (p.perceived !== p.character ? ' — believes they are the ' + c.R(p.perceived) : '')),
      e.redHerring ? "The Fortune Teller's red herring (reads as the Demon): " + c.P(e.redHerring) : null,
      "The Demon's bluffs (good characters not in play): " + e.bluffs.map((b) => c.R(b)).join(', '),
    ],
    info: (e, c) =>
      c.P(e.actor) + ' learns, as the ' + c.R(e.character) + ': ' + c.M(e.msg) + (e.lost ? ' — ⚠ unreliable, they were ' + c.lost(e.lost) : ''),
    choice: (e, c) => {
      const [a, b] = e.targets;
      const lostNote = e.lost ? ' — ⚠ no effect, they were ' + c.lost(e.lost) : '';
      switch (e.ability) {
        case 'poisoner': return c.P(e.actor) + ' poisons ' + c.P(a) + lostNote;
        case 'monk': return c.P(e.actor) + ' protects ' + c.P(a) + lostNote;
        case 'butler': return c.P(e.actor) + ' chooses ' + c.P(a) + ' as their master' + lostNote;
        case 'fortuneteller': return c.P(e.actor) + ' checks ' + c.P(a) + ' and ' + c.P(b);
        case 'ravenkeeper': return c.P(e.actor) + ' looks at ' + c.P(a);
        default: return c.P(e.actor) + ' chooses ' + e.targets.map((t) => c.P(t)).join(', ');
      }
    },
    attack: (e, c) => {
      const base = c.P(e.actor) + ' (the Demon) attacks ' + c.P(e.target);
      switch (e.outcome) {
        case 'killed': return base;
        case 'blocked': return base + (e.by === 'soldier' ? ' — the Soldier is safe from the Demon: nothing happens' : ' — protected by the Monk: nothing happens');
        case 'alreadyDead': return base + ' — already dead: nothing happens';
        case 'ineffective': return base + ' — nothing happens: the Demon was ' + c.lost(e.lost);
        case 'mayorBounce':
          return base + (e.victim === e.target ? " — the Mayor's ability, with nobody to bounce to: the Mayor dies" : " — the Mayor's ability: " + c.P(e.victim) + ' dies instead');
        case 'starPass': return base + ' — the Demon kills themselves (star-pass)';
        default: return base;
      }
    },
    death: (e, c) =>
      c.P(e.player) + ' dies — ' + ({
        demon: 'killed by the Demon',
        execution: 'executed',
        virgin: "executed by the Virgin's power",
        slayer: 'shot by the Slayer',
        mayorBounce: "died in the Mayor's place",
        starPass: 'killed themselves (star-pass)',
      }[e.cause] || e.cause),
    poisonEnded: (e, c) => c.P(e.poisoner) + ' is dead: the poison on ' + c.P(e.target) + ' ends',
    promotion: (e, c) =>
      e.reason === 'scarletWoman' ? c.P(e.player) + ' becomes the new Demon (the Scarlet Woman takes over)' : c.P(e.player) + ' becomes the new Imp (star-pass)',
    dawn: (e, c) => (e.deaths.length ? 'Dawn breaks. Found dead: ' + e.deaths.map((d) => c.P(d)).join(', ') : 'Dawn breaks. Nobody died in the night.'),
    nominate: (e, c) => c.P(e.nominator) + ' nominates ' + c.P(e.nominee),
    virgin: (e, c) =>
      e.executed
        ? c.P(e.virgin) + ' is the Virgin — ' + c.P(e.nominator) + ', a Townsfolk, is executed at once'
        : e.reason === 'poisoned'
          ? c.P(e.virgin) + ' is the Virgin but was poisoned: nothing happens'
          : c.P(e.virgin) + ' is the Virgin, but ' + c.P(e.nominator) + ' is not a Townsfolk: nothing happens',
    vote: (e, c) => {
      const yes = e.votes.filter((v) => v.yes).map((v) => c.P(v.id));
      const no = e.votes.filter((v) => !v.yes).map((v) => c.P(v.id));
      return [
        'Vote on ' + c.P(e.nominee) + ': ' + e.yes + ' yes (' + e.needed + ' needed, ' + e.alive + ' alive) — ' +
          ({ block: 'now on the block', tie: 'a tie: nobody is on the block', short: 'not enough votes' }[e.outcome] || e.outcome),
        yes.length ? 'Yes: ' + yes.join(', ') : 'Nobody voted yes',
        no.length ? 'No: ' + no.join(', ') : null,
        ...e.dropped.map((id) => "The Butler's vote (" + c.P(id) + ') did not count: their master did not vote yes'),
      ];
    },
    slayer: (e, c) => {
      const base = c.P(e.shooter) + ' shoots ' + c.P(e.target);
      if (e.hit) return base + ' — the Demon dies';
      if (!e.real) return base + ' — ' + c.P(e.shooter) + ' is not the Slayer (a bluff): nothing happens';
      if (e.lost) return base + ' — the Slayer was ' + c.lost(e.lost) + ': nothing happens';
      if (e.targetDead) return base + ' — already dead: nothing happens';
      return base + ' — ' + c.P(e.target) + ' is not the Demon: nothing happens';
    },
    execution: (e, c) =>
      e.wasDead ? c.P(e.player) + " (already dead) is executed anyway — it counts as the day's execution" : c.P(e.player) + ' is executed',
    dayEnd: () => 'The day ends: nobody is executed.',
    win: (e, c) => (e.winner === 'good' ? 'Good wins: ' : 'Evil wins: ') + c.M(e.message),
  },
  fr: {
    roles: (e, c) => [
      'Rôles distribués :',
      ...e.players.map((p) => c.P(p.id) + (p.perceived !== p.character ? ' — croit être ' + c.R(p.perceived) : '')),
      e.redHerring ? 'Le faux positif de la Voyante (apparaît comme le Démon) : ' + c.P(e.redHerring) : null,
      'Les bluffs du Démon (personnages bons absents de la partie) : ' + e.bluffs.map((b) => c.R(b)).join(', '),
    ],
    info: (e, c) =>
      c.P(e.actor) + ' apprend, en tant que ' + c.R(e.character) + ' : ' + c.M(e.msg) + (e.lost ? ' — ⚠ peu fiable, il/elle était ' + c.lost(e.lost) : ''),
    choice: (e, c) => {
      const [a, b] = e.targets;
      const lostNote = e.lost ? ' — ⚠ sans effet, il/elle était ' + c.lost(e.lost) : '';
      switch (e.ability) {
        case 'poisoner': return c.P(e.actor) + ' empoisonne ' + c.P(a) + lostNote;
        case 'monk': return c.P(e.actor) + ' protège ' + c.P(a) + lostNote;
        case 'butler': return c.P(e.actor) + ' choisit ' + c.P(a) + ' comme maître' + lostNote;
        case 'fortuneteller': return c.P(e.actor) + ' vérifie ' + c.P(a) + ' et ' + c.P(b);
        case 'ravenkeeper': return c.P(e.actor) + ' observe ' + c.P(a);
        default: return c.P(e.actor) + ' choisit ' + e.targets.map((t) => c.P(t)).join(', ');
      }
    },
    attack: (e, c) => {
      const base = c.P(e.actor) + ' (le Démon) attaque ' + c.P(e.target);
      switch (e.outcome) {
        case 'killed': return base;
        case 'blocked': return base + (e.by === 'soldier' ? ' — le Soldat est protégé du Démon : rien ne se passe' : ' — protégé par le Moine : rien ne se passe');
        case 'alreadyDead': return base + ' — déjà mort(e) : rien ne se passe';
        case 'ineffective': return base + ' — rien ne se passe : le Démon était ' + c.lost(e.lost);
        case 'mayorBounce':
          return base + (e.victim === e.target ? ' — la capacité du Maire, sans personne vers qui la dévier : le Maire meurt' : ' — la capacité du Maire : ' + c.P(e.victim) + ' meurt à sa place');
        case 'starPass': return base + ' — le Démon se tue lui-même (passage d’étoile)';
        default: return base;
      }
    },
    death: (e, c) =>
      c.P(e.player) + ' meurt — ' + ({
        demon: 'tué(e) par le Démon',
        execution: 'exécuté(e)',
        virgin: 'exécuté(e) par le pouvoir de l’Immaculée',
        slayer: 'abattu(e) par la Pourfendeuse',
        mayorBounce: 'mort(e) à la place du Maire',
        starPass: 's’est tué(e) (passage d’étoile)',
      }[e.cause] || e.cause),
    poisonEnded: (e, c) => c.P(e.poisoner) + ' est mort(e) : le poison sur ' + c.P(e.target) + ' prend fin',
    promotion: (e, c) =>
      e.reason === 'scarletWoman' ? c.P(e.player) + ' devient le nouveau Démon (la Femme écarlate prend la relève)' : c.P(e.player) + ' devient le nouveau Diablotin (passage d’étoile)',
    dawn: (e, c) => (e.deaths.length ? 'L’aube se lève. Retrouvé(s) mort(s) : ' + e.deaths.map((d) => c.P(d)).join(', ') : 'L’aube se lève. Personne n’est mort cette nuit.'),
    nominate: (e, c) => c.P(e.nominator) + ' nomine ' + c.P(e.nominee),
    virgin: (e, c) =>
      e.executed
        ? c.P(e.virgin) + ' est l’Immaculée — ' + c.P(e.nominator) + ', un Villageois, est exécuté(e) aussitôt'
        : e.reason === 'poisoned'
          ? c.P(e.virgin) + ' est l’Immaculée mais était empoisonné(e) : rien ne se passe'
          : c.P(e.virgin) + ' est l’Immaculée, mais ' + c.P(e.nominator) + ' n’est pas un Villageois : rien ne se passe',
    vote: (e, c) => {
      const yes = e.votes.filter((v) => v.yes).map((v) => c.P(v.id));
      const no = e.votes.filter((v) => !v.yes).map((v) => c.P(v.id));
      return [
        'Vote sur ' + c.P(e.nominee) + ' : ' + e.yes + ' oui (' + e.needed + ' nécessaires, ' + e.alive + ' en vie) — ' +
          ({ block: 'sur le billot', tie: 'égalité : personne sur le billot', short: 'pas assez de votes' }[e.outcome] || e.outcome),
        yes.length ? 'Oui : ' + yes.join(', ') : 'Personne n’a voté oui',
        no.length ? 'Non : ' + no.join(', ') : null,
        ...e.dropped.map((id) => 'Le vote du Majordome (' + c.P(id) + ') n’a pas compté : son maître n’a pas voté oui'),
      ];
    },
    slayer: (e, c) => {
      const base = c.P(e.shooter) + ' tire sur ' + c.P(e.target);
      if (e.hit) return base + ' — le Démon meurt';
      if (!e.real) return base + ' — ' + c.P(e.shooter) + ' n’est pas la Pourfendeuse (un bluff) : rien ne se passe';
      if (e.lost) return base + ' — la Pourfendeuse était ' + c.lost(e.lost) + ' : rien ne se passe';
      if (e.targetDead) return base + ' — déjà mort(e) : rien ne se passe';
      return base + ' — ' + c.P(e.target) + ' n’est pas le Démon : rien ne se passe';
    },
    execution: (e, c) =>
      e.wasDead ? c.P(e.player) + ' (déjà mort(e)) est quand même exécuté(e) — cela compte comme l’exécution du jour' : c.P(e.player) + ' est exécuté(e)',
    dayEnd: () => 'La journée se termine : personne n’est exécuté.',
    win: (e, c) => (e.winner === 'good' ? 'Le Bien gagne : ' : 'Le Mal gagne : ') + c.M(e.message),
  },
};

const REPLAY_ICONS = {
  roles: '🎭', info: '🔎', choice: '👆', attack: '🔪', death: '💀', poisonEnded: '🧪', promotion: '😈', dawn: '🌅',
  nominate: '📣', virgin: '🙏', vote: '✋', slayer: '🏹', execution: '🔨', dayEnd: '🌇', win: '🏆',
};
const LOST_LABELS = { en: { poisoned: 'poisoned', drunk: 'drunk' }, fr: { poisoned: 'empoisonné(e)', drunk: 'ivre' } };

/** The lines of one event, as plain text with player tokens (a player id between two marker characters). */
function replayLines(e, c) {
  const template = (REPLAY[LANG] && REPLAY[LANG][e.type]) || REPLAY.en[e.type];
  if (!template) return [];
  const out = template(e.vars || {}, c);
  return (Array.isArray(out) ? out : [out]).filter((line) => line != null && line !== '');
}

const TOKEN_OPEN = String.fromCharCode(1);
const TOKEN_CLOSE = String.fromCharCode(2);

/** What the wording functions need: names, characters (as dealt), and message texts. */
function replayContext(v) {
  const dealt = {};
  const rolesEvent = (v.replay || []).find((e) => e.type === 'roles');
  if (rolesEvent) for (const p of rolesEvent.vars.players) dealt[p.id] = p.character;
  for (const p of v.players) if (!dealt[p.id]) dealt[p.id] = p.character;
  return {
    dealt,
    P: (id) => TOKEN_OPEN + id + TOKEN_CLOSE,
    R: (charId) => roleNameFor(charId),
    M: (m) => tMsg(m),
    lost: (why) => (LOST_LABELS[LANG] || LOST_LABELS.en)[why] || why,
  };
}

/** Turns text with player tokens into a span: each token becomes a coloured "Name (Role)". */
function richReplayText(text, v, ctx) {
  const span = el('span', {});
  const pattern = new RegExp(TOKEN_OPEN + '([^' + TOKEN_CLOSE + ']*)' + TOKEN_CLOSE, 'g');
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) span.append(text.slice(last, m.index));
    const player = v.players.find((p) => p.id === m[1]);
    const role = ctx.dealt[m[1]];
    const team = role && charactersCache && charactersCache.find((c) => c.id === role)?.team;
    const cls = team === 'minion' || team === 'demon' ? 'evil' : team ? 'good' : '';
    span.appendChild(el('span', { class: 'rname ' + cls }, (player ? player.name : '?') + (role ? ' (' + roleNameFor(role) + ')' : '')));
    last = m.index + m[0].length;
  }
  if (last < text.length) span.append(text.slice(last));
  return span;
}

function renderReplay(v) {
  if (!v.replay || !v.replay.length) return null;
  const ctx = replayContext(v);
  const groups = [];
  let currentKey = null;
  for (const e of v.replay) {
    const key = e.phase + '-' + (e.phase === 'night' ? e.night : e.phase === 'day' ? e.day : 0);
    if (key !== currentKey) {
      currentKey = key;
      groups.push({ phase: e.phase, title: e.phase === 'night' ? t('replayNightN', e.night) : e.phase === 'day' ? t('replayDayN', e.day) : t('replaySetup'), lines: [] });
    }
    const lines = replayLines(e, ctx);
    lines.forEach((line, i) => groups[groups.length - 1].lines.push({ type: e.type, sub: i > 0, text: line }));
  }
  return el('div', { class: 'card replay' }, [
    el('h2', {}, t('replayTitle')),
    el('p', { class: 'muted' }, t('replayIntro')),
    ...groups
      .filter((g) => g.lines.length)
      .map((g) =>
        el('div', { class: 'replay-group ' + g.phase }, [
          el('h3', {}, g.title),
          ...g.lines.map((line) =>
            el('div', { class: 'replay-line ' + line.type + (line.sub ? ' sub' : '') }, [
              el('span', { class: 'replay-icon' }, line.sub ? '' : REPLAY_ICONS[line.type] || '•'),
              el('span', { class: 'replay-text' }, richReplayText(line.text, v, ctx)),
            ])
          ),
        ])
      ),
  ]);
}

function renderEnded(v) {
  const isGood = v.winner === 'good';
  const children = [
    el('div', { class: 'winner-banner ' + (isGood ? 'good' : 'evil') }, [
      el('span', { class: 'icon' }, isGood ? '😇' : '😈'),
      el('h1', {}, isGood ? t('goodWins') : t('evilWins')),
    ]),
    el(
      'div',
      { class: 'card player-list' },
      v.players.map((p) => {
        const team = charactersCache && charactersCache.find((c) => c.id === p.character)?.team;
        const alignCls = team === 'minion' || team === 'demon' ? 'evil' : team ? 'good' : '';
        const localName = LANG === 'fr' && p.character && CHAR_I18N_FR[p.character] ? CHAR_I18N_FR[p.character].name : p.characterName;
        return el('div', { class: `player-row ${alignCls}` + (p.alive ? '' : ' dead') }, [
          el('div', { class: 'seat' }, String(p.seat + 1)),
          el('div', {}, `${p.name} — ${localName || '?'}`),
        ]);
      })
    ),
  ];

  children.push(renderReplay(v));
  children.push(renderLog(v));
  return renderScreen(children);
}

function computeSignature(v) {
  if (!v) return 'connecting';
  if (v.nightResult && state.nightResultSeenForNight !== v.night) return `nightresult-${v.night}`;
  if (v.phase === 'day' && v.dawnMessage && state.dawnSeenForDay !== v.day) return `dawn-${v.day}`;
  if (v.phase === 'night' && v.duskMessage && state.duskSeenForNight !== v.night) return `dusk-${v.night}`;
  if (v.phase === 'lobby') return 'lobby';
  if (v.phase === 'night' && state.decoyResultStep) return `decoyresult-${state.decoyResultStep}`;
  if (v.phase === 'night') return `night-${turnKey(v)}`;
  if (v.phase === 'day') return `day-${v.nomination ? v.nomination.state + ':' + v.nomination.nomineeId : 'none'}`;
  if (v.phase === 'ended') return 'ended';
  return v.phase;
}

function render() {
  const v = state.code && state.playerId ? state.view : null;
  if (!v || v.phase !== 'night') state.decoyResultStep = null;
  const signature = computeSignature(v) + ':' + LANG;
  animateThisRender = signature !== lastScreenSignature;
  lastScreenSignature = signature;

  // The sky ambience follows the live game phase — day fades toward light/warm tones, night
  // toward dark/cool ones — with everything before the game starts kept on the night ambience.
  document.body.classList.toggle('phase-day', !!(v && v.phase === 'day'));

  app.innerHTML = '';
  const topbar = el('div', { class: 'topbar' }, [leaveButtonIfJoined(), el('div', { class: 'topbar-right' }, [langButton(), rolesButton()])]);
  app.appendChild(topbar);
  if (!state.code || !state.playerId) {
    app.appendChild(renderLanding());
    return;
  }
  if (!state.view) {
    app.appendChild(renderScreen([el('p', { class: 'muted center' }, t('connecting'))]));
    return;
  }
  if (v.nightResult && state.nightResultSeenForNight !== v.night) {
    app.appendChild(renderNightResultScreen(v));
    return;
  }
  if (v.phase === 'day' && v.dawnMessage && state.dawnSeenForDay !== v.day) {
    app.appendChild(renderDawnScreen(v));
    return;
  }
  if (v.phase === 'night' && v.duskMessage && state.duskSeenForNight !== v.night) {
    app.appendChild(renderDuskScreen(v));
    return;
  }
  if (v.phase === 'lobby') app.appendChild(renderLobby(v));
  else if (v.phase === 'night') app.appendChild(state.decoyResultStep ? renderDecoyResultScreen(v) : renderNight(v));
  else if (v.phase === 'day') app.appendChild(renderDay(v));
  else if (v.phase === 'ended') app.appendChild(renderEnded(v));
}

function leaveButtonIfJoined() {
  return state.code && state.playerId ? leaveButton() : el('div');
}

// The server only pushes a new view when something actually changes, so an active countdown
// (a speech timer, a per-voter timeout) needs its own local tick purely to refresh the display.
setInterval(() => {
  const n = state.view && state.view.nomination;
  if (n && (n.state === 'accusing' || n.state === 'defending')) render();
  // The 5-second countdown on a night screen's button.
  else if (state.view && state.view.nightTurn && Date.now() < state.turnReadyAt + 1000) render();
}, 1000);

connect();
render();
loadCharacters(); // warm the cache so the end-game reveal can color rows by alignment right away
