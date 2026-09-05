// Blood on the Clocktower — Trouble Brewing. Phone client.

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

const S = {
  ws: null,
  connected: false,
  view: null,
  session: loadSession(),
  config: null,
  chars: {},
  tab: 'game',
  /** Player ids currently picked for a prompt / nomination / slay. */
  picked: [],
  /** 'slay' puts the day screen into Slayer targeting mode. */
  mode: null,
  seenInfo: 0,
  promptDeadline: null,
  phaseDeadline: null,
  retry: 0,
  swReg: null,
  pushOn: false,
  /** A test notification has been sent and we're waiting for a yes/no. */
  testSent: false,
  testDelivered: null,
  showSettings: false,
  busy: false,
};

// ---------------------------------------------------------------- utilities

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

const ch = (id) => S.chars[id] || { name: id, emoji: '❓', team: 'townsfolk', ability: '' };

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem('botc.session') || 'null');
  } catch {
    return null;
  }
}

function saveSession(s) {
  S.session = s;
  if (s) localStorage.setItem('botc.session', JSON.stringify(s));
  else localStorage.removeItem('botc.session');
}

let toastTimer = null;
function toast(msg, ok = false) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  toastEl.style.background = ok ? 'var(--ok)' : 'var(--evil)';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 3600);
}

// ------------------------------------------------------------- buzz & sound

let audioCtx = null;
function unlockAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    /* no audio available */
  }
}

function beep(pattern = [400]) {
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    const count = Math.max(1, Math.min(3, Math.ceil(pattern.length / 2)));
    for (let i = 0; i < count; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 660 - i * 90;
      const t = now + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.17);
    }
  } catch {
    /* ignore */
  }
}

function handleBuzz(b) {
  const pattern = Array.isArray(b.pattern) ? b.pattern : [400];
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* vibration not permitted */
  }
  beep(pattern);

  // The socket can be alive while the phone is in a pocket — show a local
  // notification too, so the buzz is accompanied by something readable.
  if (document.hidden && S.swReg && Notification.permission === 'granted') {
    S.swReg.showNotification(b.title || 'Clocktower', {
      body: b.body || '',
      tag: b.tag || 'botc',
      renotify: true,
      vibrate: pattern,
      icon: '/icon.svg',
      badge: '/icon.svg',
    });
  }
}

// -------------------------------------------------------------- push set-up

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    S.swReg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const sub = await S.swReg.pushManager.getSubscription();
    S.pushOn = !!sub;
  } catch (err) {
    console.warn('service worker unavailable', err);
  }
}

async function enablePush() {
  if (!S.swReg) {
    toast('Notifications need HTTPS (or localhost). Use ntfy instead.');
    return;
  }
  if (!('PushManager' in window)) {
    toast('This browser cannot do push. Use ntfy instead.');
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return toast('Notifications were blocked.');
    let sub = await S.swReg.pushManager.getSubscription();
    if (!sub) {
      sub = await S.swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(S.config.vapidPublicKey),
      });
    }
    send({ t: 'push', webPush: sub.toJSON() });
    S.pushOn = true;
    toast('Notifications on — your phone will buzz at night.', true);
    render();
  } catch (err) {
    console.warn(err);
    toast('Could not turn on notifications.');
  }
}

// ------------------------------------------------------------------ socket

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function send(msg) {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(msg));
  else toast('Not connected — reconnecting…');
}

function connect(afterOpen) {
  if (S.ws && (S.ws.readyState === WebSocket.OPEN || S.ws.readyState === WebSocket.CONNECTING)) {
    if (afterOpen && S.ws.readyState === WebSocket.OPEN) afterOpen();
    return;
  }
  const ws = new WebSocket(wsUrl());
  S.ws = ws;

  ws.onopen = () => {
    S.connected = true;
    S.retry = 0;
    if (afterOpen) afterOpen();
    else if (S.session) ws.send(JSON.stringify({ t: 'auth', ...S.session }));
    render();
  };

  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    onMessage(msg);
  };

  ws.onclose = () => {
    S.connected = false;
    render();
    const delay = Math.min(8000, 500 * 2 ** Math.min(S.retry++, 4));
    setTimeout(() => connect(), delay);
  };

  ws.onerror = () => ws.close();
}

function onMessage(msg) {
  switch (msg.t) {
    case 'identity':
      saveSession({ code: msg.code, token: msg.token });
      location.hash = msg.code;
      // Re-register any Web Push subscription this device already has.
      if (S.pushOn && S.swReg) {
        S.swReg.pushManager.getSubscription().then((sub) => {
          if (sub) send({ t: 'push', webPush: sub.toJSON() });
        });
      }
      break;

    case 'view': {
      const prev = S.view;
      S.view = msg.view;
      // A brand-new prompt clears whatever was picked for the last one.
      if (msg.view.prompt?.id !== prev?.prompt?.id) S.picked = [];
      if (msg.view.phase !== prev?.phase) {
        S.mode = null;
        if (msg.view.phase !== 'nominations') S.picked = [];
      }
      S.promptDeadline = msg.view.prompt
        ? Date.now() + msg.view.prompt.secondsLeft * 1000
        : null;
      S.phaseDeadline =
        msg.view.phaseSecondsLeft != null
          ? Date.now() + msg.view.phaseSecondsLeft * 1000
          : null;
      if (S.tab === 'me') S.seenInfo = msg.view.self.log.length;
      S.busy = false;
      render();
      break;
    }

    case 'buzz':
      handleBuzz(msg);
      break;

    case 'left':
      saveSession(null);
      S.view = null;
      location.hash = '';
      render();
      break;

    case 'error':
      S.busy = false;
      if (msg.message === 'expired') {
        saveSession(null);
        S.view = null;
        render();
        toast('That game is no longer available.');
      } else {
        toast(msg.message);
      }
      break;

    case 'testBuzzResult':
      S.testDelivered = msg.delivered;
      if (!msg.delivered) {
        toast('The server could not reach ntfy — check the network.');
      }
      render();
      break;

    case 'pong':
    case 'pushOk':
      break;
  }
}

// ------------------------------------------------------------------ actions

async function createRoom() {
  const name = (document.getElementById('name')?.value || '').trim();
  if (!name) return toast('Enter your name first.');
  localStorage.setItem('botc.name', name);
  try {
    const res = await fetch('/api/rooms', { method: 'POST' });
    const { code } = await res.json();
    connect(() => send({ t: 'join', code, name }));
  } catch {
    toast('Could not reach the server.');
  }
}

function joinRoom() {
  const name = (document.getElementById('name')?.value || '').trim();
  const code = (document.getElementById('code')?.value || '').trim().toUpperCase();
  if (!name) return toast('Enter your name first.');
  if (!code) return toast('Enter the room code.');
  localStorage.setItem('botc.name', name);
  connect(() => send({ t: 'join', code, name }));
}

const ACTIONS = {
  create: createRoom,
  join: joinRoom,
  tab: (arg) => {
    S.tab = arg;
    S.mode = null;
    if (arg === 'me' && S.view) S.seenInfo = S.view.self.log.length;
    render();
  },
  start: () => send({ t: 'start' }),
  ready: () => send({ t: 'ready' }),
  leave: () => {
    if (confirm('Leave this room?')) send({ t: 'leave' });
  },
  forget: () => {
    saveSession(null);
    S.view = null;
    location.hash = '';
    if (S.ws) S.ws.close();
    render();
  },
  kick: (arg) => {
    if (confirm('Remove this player?')) send({ t: 'kick', playerId: arg });
  },
  seatUp: (arg) => send({ t: 'moveSeat', playerId: arg, delta: -1 }),
  seatDown: (arg) => send({ t: 'moveSeat', playerId: arg, delta: 1 }),
  pick: (arg) => {
    togglePick(arg);
    render();
  },
  confirmPrompt: () => {
    if (!S.view?.prompt) return;
    S.busy = true;
    send({ t: 'choose', promptId: S.view.prompt.id, targets: S.picked });
  },
  openNominations: () => send({ t: 'openNominations' }),
  nominate: () => {
    if (S.picked.length !== 1) return;
    S.busy = true;
    send({ t: 'nominate', targetId: S.picked[0] });
    S.picked = [];
  },
  endSpeech: () => send({ t: 'endSpeech' }),
  voteYes: () => send({ t: 'vote', vote: true }),
  voteNo: () => send({ t: 'vote', vote: false }),
  endDay: () => send({ t: 'endDay' }),
  slayMode: () => {
    S.mode = S.mode === 'slay' ? null : 'slay';
    S.picked = [];
    render();
  },
  slay: () => {
    if (S.picked.length !== 1) return;
    if (!confirm('Publicly claim Slayer and shoot this player? This is one use only.')) return;
    send({ t: 'slay', targetId: S.picked[0] });
    S.mode = null;
    S.picked = [];
  },
  playAgain: () => send({ t: 'playAgain' }),
  enablePush,
  settings: () => {
    S.showSettings = !S.showSettings;
    render();
  },
  testBuzz: () => {
    send({ t: 'testBuzz' });
    S.testSent = true;
    S.testDelivered = null;
    render();
  },
  confirmBuzz: () => {
    send({ t: 'pushConfirmed', ok: true });
    S.testSent = false;
    toast('Set. Your phone will buzz at night.', true);
  },
  retryBuzz: () => {
    S.testSent = false;
    render();
    toast('Tap ① to subscribe in the ntfy app, then test again.');
  },
  unconfirm: () => {
    send({ t: 'pushConfirmed', ok: false });
    S.testSent = false;
  },
  opt: (arg) => {
    const [key, raw] = arg.split('=');
    let value = raw;
    if (raw === 'true' || raw === 'false') value = raw === 'true';
    else if (!isNaN(Number(raw)) && raw !== '') value = Number(raw);
    send({ t: 'setOptions', options: { [key]: value } });
  },
};

function togglePick(id) {
  const v = S.view;
  const max = v?.prompt ? v.prompt.count : 1;
  const i = S.picked.indexOf(id);
  if (i >= 0) S.picked.splice(i, 1);
  else {
    S.picked.push(id);
    while (S.picked.length > max) S.picked.shift();
  }
}

document.addEventListener('click', (ev) => {
  unlockAudio();
  const target = ev.target.closest('[data-act]');
  if (!target) return;
  const act = target.dataset.act;
  const fn = ACTIONS[act];
  if (!fn) return;
  ev.preventDefault();
  fn(target.dataset.arg);
});

document.addEventListener('change', (ev) => {
  const sel = ev.target.closest('select[data-opt]');
  if (!sel) return;
  ACTIONS.opt(`${sel.dataset.opt}=${sel.value}`);
});

// ------------------------------------------------------------------- render

/** Headline is the in-game moment; the activity goes in the subtitle. */
function phaseHeading(v) {
  switch (v.phase) {
    case 'lobby':
      return ['Lobby', null];
    case 'reveal':
      return ['Your character', null];
    case 'night':
      return [`Night ${v.night}`, null];
    case 'dawn':
      return [`Day ${v.day}`, 'the morning after'];
    case 'day':
      return [`Day ${v.day}`, 'discussion'];
    case 'nominations':
      return [`Day ${v.day}`, 'nominations open'];
    case 'speech':
      return [`Day ${v.day}`, 'a nomination is live'];
    case 'voting':
      return [`Day ${v.day}`, 'voting'];
    case 'dusk':
      return [`Day ${v.day}`, 'dusk'];
    case 'over':
      return ['Game over', null];
    default:
      return [v.phase, null];
  }
}

function render() {
  const focusId = document.activeElement?.id;
  const selection = focusId ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  const values = {};
  for (const input of app.querySelectorAll('input[id]')) values[input.id] = input.value;

  app.innerHTML = S.view ? renderGame(S.view) : renderHome();
  document.body.dataset.phase = S.view ? S.view.phase : 'home';

  for (const [id, val] of Object.entries(values)) {
    const input = document.getElementById(id);
    if (input && !input.value) input.value = val;
  }
  if (focusId) {
    const input = document.getElementById(focusId);
    if (input) {
      input.focus();
      try {
        if (selection) input.setSelectionRange(selection[0], selection[1]);
      } catch {
        /* not a text input */
      }
    }
  }
  tickUI();
}

function renderHome() {
  const name = localStorage.getItem('botc.name') || '';
  const code = (location.hash || '').replace('#', '').toUpperCase();
  return `
    <div class="topbar">
      <span class="dot ${S.connected ? '' : 'off'}"></span>
      <div class="grow">
        <div class="phase">Blood on the Clocktower</div>
        <div class="sub">Trouble Brewing · self-hosted</div>
      </div>
    </div>
    <main>
      <div class="hero">
        <div style="font-size:56px;line-height:1">🩸🕰️</div>
        <div class="big" style="margin-top:10px">No storyteller.<br />Just phones.</div>
        <div class="lede">
          Everyone sits in one room. Your phone buzzes when the night needs you,
          and again when someone is accused.
        </div>
      </div>

      <div class="card stack">
        <div class="field">
          <label for="name">Your name</label>
          <input id="name" type="text" maxlength="20" autocomplete="nickname"
                 placeholder="e.g. Robin" value="${esc(name)}" />
        </div>
        <button class="btn primary" data-act="create">Create a new room</button>
      </div>

      <div class="card stack">
        <div class="field">
          <label for="code">Room code</label>
          <input id="code" class="code-input" type="text" maxlength="6"
                 inputmode="text" autocapitalize="characters" autocomplete="off"
                 placeholder="ABCD" value="${esc(code)}" />
        </div>
        <button class="btn" data-act="join">Join that room</button>
      </div>

      <p class="faint center">
        5–15 players. Everything runs on this server — no accounts, nothing leaves your network.
      </p>
    </main>`;
}

function renderGame(v) {
  return topbar(v) + `<main>${mainBody(v)}</main>` + tabsBar(v);
}

function topbar(v) {
  const [label, activity] = phaseHeading(v);
  const alive = v.players.filter((p) => p.alive).length;
  const sub = [v.code, `${alive}/${v.players.length} alive`, activity].filter(Boolean).join(' · ');
  return `
    <div class="topbar">
      <span class="dot ${S.connected ? '' : 'off'}"></span>
      <div class="grow">
        <div class="phase">${esc(label)}</div>
        <div class="sub">${esc(sub)}</div>
      </div>
      <span class="timer" id="timer" hidden></span>
    </div>`;
}

function tabsBar(v) {
  const unread = Math.max(0, v.self.log.length - S.seenInfo);
  const tab = (id, ic, label, badge) => `
    <button class="tab ${S.tab === id ? 'active' : ''}" data-act="tab" data-arg="${id}">
      <span class="ic">${ic}${badge ? `<span class="badge">${badge}</span>` : ''}</span>
      <span>${label}</span>
    </button>`;
  return `<div class="tabs">
    ${tab('game', '🎲', 'Game', 0)}
    ${tab('me', '🎭', 'You', unread)}
    ${tab('log', '📜', 'History', 0)}
  </div>`;
}

function mainBody(v) {
  if (S.tab === 'me') return meTab(v);
  if (S.tab === 'log') return logTab(v);
  switch (v.phase) {
    case 'lobby':
      return lobbyScreen(v);
    case 'reveal':
      return revealScreen(v);
    case 'night':
      return nightScreen(v);
    case 'dawn':
      return dawnScreen(v);
    case 'day':
      return dayScreen(v);
    case 'nominations':
      return nominationsScreen(v);
    case 'speech':
      return speechScreen(v);
    case 'voting':
      return votingScreen(v);
    case 'dusk':
      return duskScreen(v);
    case 'over':
      return overScreen(v);
    default:
      return '<div class="card">…</div>';
  }
}

// ------------------------------------------------------------------- pieces

function playerRow(p, opts = {}) {
  const tags = [];
  if (opts.tags) tags.push(...opts.tags);
  if (!p.alive) tags.push(`<span class="tag">${p.ghostVoteUsed ? 'no vote' : 'ghost vote'}</span>`);
  if (p.isHost && opts.showHost) tags.push('<span class="tag gold">host</span>');
  if (!p.connected && opts.showConnection) tags.push('<span class="tag">offline</span>');

  const selected = S.picked.includes(p.id);
  const clickable = opts.selectable && !opts.disabled;
  const tag = clickable ? 'button' : 'div';
  const attrs = clickable ? `data-act="pick" data-arg="${p.id}"` : '';

  return `<${tag} class="player ${p.alive ? '' : 'dead'} ${selected ? 'selected' : ''}
      ${clickable ? 'selectable' : ''} ${p.isYou ? 'you' : ''}"
      ${attrs} ${opts.disabled ? 'disabled' : ''}>
    <span class="seat">${p.seat + 1}</span>
    <span class="name">${esc(p.name)}${p.isYou ? ' <span class="faint">(you)</span>' : ''}</span>
    <span class="tags">${tags.join('')}</span>
  </${tag}>`;
}

function roleCard(v) {
  if (!v.self.character) return '';
  const c = ch(v.self.character);
  return `
    <div class="role">
      <div class="emoji">${c.emoji}</div>
      <div class="rname">${esc(c.name)}</div>
      <div class="team ${c.team}">${teamName(c.team)}</div>
      <div class="ability">${esc(c.ability)}</div>
    </div>`;
}

function teamName(t) {
  return { townsfolk: 'Townsfolk', outsider: 'Outsider', minion: 'Minion', demon: 'Demon' }[t] || t;
}

function infoCard(entry) {
  const c = entry.character ? ch(entry.character) : null;
  return `
    <div class="info">
      <div class="head">
        <span class="title">${c ? c.emoji + ' ' : ''}${esc(entry.title)}</span>
        <span class="when">Night ${entry.night}</span>
      </div>
      <div class="body">${esc(entry.body)}</div>
    </div>`;
}

// ------------------------------------------------------------------ screens

function lobbyScreen(v) {
  const isHost = v.youId === v.hostId;
  const url = `${location.origin}/#${v.code}`;
  const enough = v.players.length >= 5;
  const dist = v.preview;
  const notReady = v.players.filter((p) => !p.pushReady);

  return `
    <div class="card center stack">
      <div class="muted">Room code</div>
      <div class="roomcode">${esc(v.code)}</div>
      <img class="qr" alt="QR code to join" src="/api/qr?d=${encodeURIComponent(url)}" />
      <div class="faint">${esc(url)}</div>
    </div>

    ${notificationCard(v)}

    <div class="card">
      <h2>Players &middot; ${v.players.length}</h2>
      <p class="muted" style="margin-bottom:12px">
        ${dist
          ? `${dist.townsfolk} Townsfolk · ${dist.outsider} Outsider${dist.outsider === 1 ? '' : 's'} · ${dist.minion} Minion${dist.minion === 1 ? '' : 's'} · 1 Demon`
          : enough
            ? 'Too many players for Trouble Brewing (max 15).'
            : `Need ${5 - v.players.length} more to start.`}
      </p>
      <div class="players">
        ${v.players
          .map((p) =>
            playerRow(p, {
              showHost: true,
              showConnection: true,
              tags: [
                p.pushReady
                  ? '<span class="tag ok">🔔 ready</span>'
                  : '<span class="tag">no buzz yet</span>',
                ...(isHost && !p.isYou
                  ? [`<button class="tag" data-act="kick" data-arg="${p.id}">remove</button>`]
                  : []),
              ],
            }),
          )
          .join('')}
      </div>
      ${notReady.length
        ? `<div class="banner warn" style="margin-top:12px">
             ${notReady.length === 1
               ? `<b>${esc(notReady[0].name)}</b> has not set up phone buzzing yet.`
               : `<b>${notReady.length} players</b> have not set up phone buzzing yet:
                  ${notReady.map((p) => esc(p.name)).join(', ')}.`}
             Without it they will miss their night turn.
           </div>`
        : `<div class="banner info" style="margin-top:12px">
             ✓ Everyone's phone is ready to buzz.
           </div>`}
      <p class="faint" style="margin-top:12px">
        Seat order matters — the Chef and Empath read the circle. Sit in the same
        order as this list.
      </p>
      ${isHost ? seatControls(v) : ''}
    </div>

    ${isHost ? settingsCard(v) : `<div class="banner info">Waiting for the host to start.</div>`}

    ${isHost
      ? `<button class="btn primary" data-act="start" ${enough && dist ? '' : 'disabled'}>
           ${enough && dist ? 'Start the game' : 'Need 5–15 players'}
         </button>`
      : ''}

    <button class="btn ghost" data-act="leave">Leave room</button>`;
}

function seatControls(v) {
  return `
    <hr class="sep" style="margin:14px 0" />
    <div class="muted" style="margin-bottom:8px">Reorder seats</div>
    <div class="rows">
      ${v.players
        .map(
          (p) => `<div class="row">
            <span class="lbl">${p.seat + 1}. ${esc(p.name)}</span>
            <span style="display:flex;gap:6px">
              <button class="btn small" data-act="seatUp" data-arg="${p.id}">↑</button>
              <button class="btn small" data-act="seatDown" data-arg="${p.id}">↓</button>
            </span>
          </div>`,
        )
        .join('')}
    </div>`;
}

function settingsCard(v) {
  const o = v.options;
  if (!S.showSettings) {
    return `<button class="btn ghost" data-act="settings">⚙️ Game settings</button>`;
  }
  const num = (key, label, hint, choices) => `
    <div class="row">
      <span class="lbl">${label}<small>${hint}</small></span>
      <select data-opt="${key}">
        ${choices.map((c) => `<option value="${c}" ${o[key] === c ? 'selected' : ''}>${c}s</option>`).join('')}
      </select>
    </div>`;

  return `
    <div class="card">
      <h2>Settings</h2>
      <div class="rows">
        <div class="row">
          <span class="lbl">Voting<small>Everyone at once, or around the circle</small></span>
          <select data-opt="votingMode">
            <option value="simultaneous" ${o.votingMode === 'simultaneous' ? 'selected' : ''}>All at once</option>
            <option value="sequential" ${o.votingMode === 'sequential' ? 'selected' : ''}>Around the circle</option>
          </select>
        </div>
        ${num('speechSeconds', 'Speech length', 'Accuser, then accused', [30, 45, 60, 90, 120])}
        ${num('voteSeconds', 'Voting time', 'Before votes are counted', [15, 20, 30, 45, 60])}
        ${num('nightPromptSeconds', 'Night prompt', 'Before a choice is made for you', [45, 60, 75, 90, 120])}
        ${num('dawnSeconds', 'Morning report', 'Time to read who died', [10, 15, 25, 40])}
        ${num('revealSeconds', 'Character reveal', 'Time to read your role', [15, 30, 45, 60])}
        <div class="row">
          <span class="lbl">Drunk shows as<small>What other players' abilities see</small></span>
          <select data-opt="drunkShowsAsFake">
            <option value="false" ${!o.drunkShowsAsFake ? 'selected' : ''}>the Drunk (official)</option>
            <option value="true" ${o.drunkShowsAsFake ? 'selected' : ''}>their fake role</option>
          </select>
        </div>
      </div>
      <button class="btn ghost small" style="margin-top:12px" data-act="settings">Done</button>
    </div>`;
}

/** `ntfy://host/topic` opens the ntfy app and subscribes in one tap. */
function ntfyDeepLink(v) {
  const host = S.config?.ntfyHost || 'ntfy.sh';
  const name = encodeURIComponent(`Clocktower (${v.players.find((p) => p.isYou)?.name || 'you'})`);
  return `ntfy://${host}/${v.self.ntfyTopic}?display=${name}`;
}

function ntfyWebLink(v) {
  const base = S.config?.ntfyBase || 'https://ntfy.sh';
  return `${base}/${v.self.ntfyTopic}`;
}

function notificationCard(v) {
  if (!v.self.ntfyTopic) return '';

  // Step 3 — done.
  if (v.self.pushConfirmed) {
    return `
      <div class="card stack">
        <h2>🔔 Your phone is set up</h2>
        <p class="muted">
          It will buzz when the night needs you, and when anyone is accused.
          You can lock your screen.
        </p>
        <div class="btn-row">
          <button class="btn small ghost" data-act="testBuzz">Test again</button>
          <button class="btn small ghost" data-act="unconfirm">Set up again</button>
        </div>
      </div>`;
  }

  // Step 2 — the test has been sent, waiting for the player to say if it worked.
  if (S.testSent) {
    return `
      <div class="card stack">
        <h2>🔔 Did your phone buzz?</h2>
        <p class="muted">
          A test notification just went out${S.testDelivered === false ? ' — but the server could not reach ntfy' : ''}.
        </p>
        <div class="btn-row">
          <button class="btn primary" data-act="confirmBuzz">Yes, it buzzed</button>
          <button class="btn" data-act="retryBuzz">No</button>
        </div>
      </div>`;
  }

  // Step 1 — subscribe.
  const deep = ntfyDeepLink(v);
  return `
    <div class="card stack">
      <h2>🔔 Buzz my phone</h2>
      <p class="muted">
        Two taps. You need the free <b>ntfy</b> app — it is what rings your phone
        while the screen is off.
      </p>

      <a class="btn primary" href="${esc(deep)}">① Subscribe me (opens ntfy)</a>
      <button class="btn" data-act="testBuzz">② Send me a test buzz</button>

      <details>
        <summary class="muted" style="cursor:pointer;padding:6px 0">
          Don't have the ntfy app yet?
        </summary>
        <div class="stack" style="margin-top:10px">
          <div class="pill-row">
            <a class="btn small" href="https://play.google.com/store/apps/details?id=io.heckel.ntfy"
               target="_blank" rel="noreferrer">Android — Play</a>
            <a class="btn small" href="https://f-droid.org/en/packages/io.heckel.ntfy/"
               target="_blank" rel="noreferrer">Android — F-Droid</a>
            <a class="btn small" href="https://apps.apple.com/us/app/ntfy/id1625396347"
               target="_blank" rel="noreferrer">iPhone</a>
          </div>
          <p class="faint">
            Install it, come back here, then tap ① again. No account needed.
          </p>
          <p class="faint">
            No app at all? Leave
            <a href="${esc(ntfyWebLink(v))}" target="_blank" rel="noreferrer">this page</a>
            open in a browser tab — it rings too, but only while unlocked.
          </p>
        </div>
      </details>

      ${window.isSecureContext
        ? `<button class="btn ghost small" data-act="enablePush">
             ${S.pushOn ? '✓ Browser notifications also on' : 'Also use browser notifications'}
           </button>`
        : ''}

      <p class="faint">
        Your topic is private to you — it is how your secret night information
        reaches your phone. Don't share it.
      </p>
    </div>`;
}

function pushNag(v) {
  if (v.self.pushConfirmed) return '';
  return `<div class="banner warn">
    🔕 Your phone will not buzz yet — you will miss your night turn.
    Set it up in the <b>You</b> tab.
  </div>`;
}

function revealScreen(v) {
  return `
    ${pushNag(v)}
    ${roleCard(v)}
    <div class="banner info">
      Memorise it. Everyone else sees a different card — nobody, not even the
      host, can see yours.
    </div>
    ${v.self.character === 'imp' || v.self.team === 'minion'
      ? '<div class="banner warn">You are evil. You will meet your team in a moment.</div>'
      : ''}
    <button class="btn primary" data-act="ready" ${v.self.isReady ? 'disabled' : ''}>
      ${v.self.isReady ? `Ready — waiting for others (${v.readyCount}/${v.players.length})` : "I've got it"}
    </button>`;
}

function nightScreen(v) {
  if (v.prompt) {
    const p = v.prompt;
    const done = S.picked.length === p.count;
    return `
      <div class="card center">
        <h2 style="font-size:22px">${esc(p.title)}</h2>
        <p class="muted" style="margin-top:6px">${esc(p.body)}</p>
        <div class="countdown" id="promptCountdown">–</div>
      </div>
      <div class="players">
        ${p.choices
          .map((c) => {
            const pl = v.players.find((x) => x.id === c.playerId);
            if (!pl) return '';
            return playerRow(pl, {
              selectable: !c.disabled,
              disabled: c.disabled,
              tags: c.disabled && c.reason ? [`<span class="tag">${esc(c.reason)}</span>`] : [],
            });
          })
          .join('')}
      </div>
      <button class="btn primary" data-act="confirmPrompt" ${done && !S.busy ? '' : 'disabled'}>
        ${done ? 'Confirm' : `Choose ${p.count - S.picked.length} more`}
      </button>`;
  }

  return `
    ${pushNag(v)}
    <div class="night-idle">
      <div class="moon">🌙</div>
      <h2 style="margin-top:16px">Night ${v.night}</h2>
      <p class="muted" style="margin-top:6px">
        Eyes closed. Your phone will buzz if the night needs you.
      </p>
    </div>
    ${latestInfo(v)}`;
}

function latestInfo(v) {
  const mine = v.self.log.filter((e) => e.night === v.night);
  if (mine.length === 0) return '';
  return `<div class="stack">${mine.map(infoCard).join('')}</div>`;
}

function dawnScreen(v) {
  const deaths = v.log.filter((l) => l.night === v.day && /died in the night|nobody died/i.test(l.text));
  return `
    <div class="card center">
      <div style="font-size:52px">🌅</div>
      <h2 style="font-size:24px;margin-top:8px">Day ${v.day}</h2>
      <div class="countdown" id="phaseCountdown">–</div>
      <div class="stack" style="margin-top:8px">
        ${deaths.length
          ? deaths.map((d) => `<p style="font-size:18px;font-weight:650">${esc(d.text)}</p>`).join('')
          : '<p class="muted">Opening your eyes…</p>'}
      </div>
    </div>
    ${latestInfo(v)}
    <div class="card">
      <h2>The town</h2>
      <div class="players">${v.players.map((p) => playerRow(p, {})).join('')}</div>
    </div>`;
}

function dayScreen(v) {
  if (S.mode === 'slay') return slayScreen(v);
  return `
    <div class="card center">
      <div style="font-size:44px">☀️</div>
      <h2 style="margin-top:6px">Day ${v.day} — talk it out</h2>
      <p class="muted">When the town is ready, open nominations.</p>
    </div>
    ${latestInfo(v)}
    <div class="card">
      <h2>The town</h2>
      <div class="players">${v.players.map((p) => playerRow(p, {})).join('')}</div>
    </div>
    ${dayButtons(v)}`;
}

function dayButtons(v) {
  const parts = [];
  if (v.self.canOpenNominations) {
    parts.push(`<button class="btn primary" data-act="openNominations">Open nominations</button>`);
  }
  if (v.self.canSlay) {
    parts.push(`<button class="btn gold" data-act="slayMode">🗡️ Use the Slayer ability</button>`);
  }
  if (v.self.canEndDay) {
    parts.push(`<button class="btn ghost" data-act="endDay">
      ${v.self.hasRequestedEndDay ? '✓ ' : ''}End the day${v.endDayVotes ? ` (${v.endDayVotes}/${v.endDayNeeded})` : ''}
    </button>`);
  }
  if (!v.self.alive) {
    parts.push(`<div class="banner info">You are dead. You may still talk, and you have
      ${v.self.ghostVoteUsed ? 'used your ghost vote' : 'one ghost vote left'}.</div>`);
  }
  return parts.length ? `<div class="stack">${parts.join('')}</div>` : '';
}

function slayScreen(v) {
  return `
    <div class="card center">
      <div style="font-size:44px">🗡️</div>
      <h2 style="margin-top:6px">Shoot who?</h2>
      <p class="muted">This is public and can only be done once. If they are the
        Demon, they die on the spot.</p>
    </div>
    <div class="players">
      ${v.players.filter((p) => p.alive).map((p) => playerRow(p, { selectable: true })).join('')}
    </div>
    <div class="btn-row">
      <button class="btn ghost" data-act="slayMode">Cancel</button>
      <button class="btn danger" data-act="slay" ${S.picked.length === 1 ? '' : 'disabled'}>Shoot</button>
    </div>`;
}

function nominationsScreen(v) {
  if (S.mode === 'slay') return slayScreen(v);

  const result = v.nomination?.stage === 'result' ? v.nomination : null;
  const blockName = v.onTheBlock ? v.players.find((p) => p.id === v.onTheBlock)?.name : null;

  const resultBanner = result
    ? `<div class="banner ${result.onBlock ? 'warn' : 'info'}">
         ${esc(v.players.find((p) => p.id === result.nomineeId)?.name || '')}:
         <b>${result.yes}</b> vote${result.yes === 1 ? '' : 's'} of ${result.required} needed.
         ${result.onBlock ? 'They are on the block.' : result.tied ? 'Tied — nobody is on the block.' : 'Not enough.'}
       </div>`
    : '';

  const blockBanner = blockName
    ? `<div class="banner warn">⚖️ <b>${esc(blockName)}</b> will be executed at dusk
        (${v.voteBar} vote${v.voteBar === 1 ? '' : 's'} to beat).</div>`
    : v.voteBar > 0
      ? `<div class="banner info">Nobody is on the block. ${v.voteBar + 1} votes would take it.</div>`
      : '';

  const canPick = v.self.canNominate;
  const list = v.players
    .map((p) => {
      const disabled = !p.alive || p.wasNominated;
      const tags = [];
      if (p.wasNominated) tags.push('<span class="tag">nominated</span>');
      if (p.hasNominated) tags.push('<span class="tag">has nominated</span>');
      if (p.id === v.onTheBlock) tags.push('<span class="tag block">on the block</span>');
      return playerRow(p, { selectable: canPick && !disabled, disabled: canPick && disabled, tags });
    })
    .join('');

  return `
    ${resultBanner}
    ${blockBanner}
    <div class="card">
      <h2>${canPick ? 'Nominate someone' : 'Nominations are open'}</h2>
      <p class="muted">${canPick
        ? 'Tap a player, then confirm. You may nominate once today.'
        : v.self.alive
          ? 'You have already nominated today.'
          : 'The dead may not nominate.'}</p>
    </div>
    <div class="players">${list}</div>
    ${canPick
      ? `<button class="btn primary" data-act="nominate" ${S.picked.length === 1 && !S.busy ? '' : 'disabled'}>
           ${S.picked.length === 1
             ? `Nominate ${esc(v.players.find((p) => p.id === S.picked[0])?.name || '')}`
             : 'Pick a player'}
         </button>`
      : ''}
    ${dayButtons(v)}`;
}

function speechScreen(v) {
  const n = v.nomination;
  if (!n) return dayScreen(v);
  const nominator = v.players.find((p) => p.id === n.nominatorId);
  const nominee = v.players.find((p) => p.id === n.nomineeId);
  const speakingId = n.stage === 'accuser' ? n.nominatorId : n.nomineeId;
  const speaker = n.stage === 'accuser' ? nominator : nominee;
  const isSpeaker = speakingId === v.youId;
  const isHost = v.youId === v.hostId;

  return `
    <div class="card center">
      <div style="font-size:15px;color:var(--ink-dim);letter-spacing:.04em">
        ${esc(nominator?.name || '?')} &nbsp;→&nbsp; ${esc(nominee?.name || '?')}
      </div>
      <div class="speaker">
        <div class="who">${esc(speaker?.name || '?')}</div>
        <div class="what">${n.stage === 'accuser' ? 'is making the accusation' : 'is defending themselves'}</div>
      </div>
      <div class="countdown" id="phaseCountdown">–</div>
      ${isSpeaker ? '<p class="muted">Everyone is listening to you.</p>' : '<p class="muted">Listen.</p>'}
    </div>
    ${isSpeaker || isHost
      ? `<button class="btn primary" data-act="endSpeech">
           ${isSpeaker ? "I'm done" : 'Move on'}
         </button>`
      : ''}`;
}

function votingScreen(v) {
  const n = v.nomination;
  if (!n) return dayScreen(v);
  const nominee = v.players.find((p) => p.id === n.nomineeId);
  const sequential = v.options.votingMode === 'sequential';
  const current = n.currentVoterId ? v.players.find((p) => p.id === n.currentVoterId) : null;

  const head = `
    <div class="card center">
      <h2 style="font-size:22px">Execute ${esc(nominee?.name || '?')}?</h2>
      <p class="muted">${v.requiredVotes} vote${v.requiredVotes === 1 ? '' : 's'} needed${
        v.voteBar > 0 ? `, and more than ${v.voteBar} to take the block` : ''
      }.</p>
      <div class="countdown" id="phaseCountdown">–</div>
      ${sequential && current ? `<p class="muted">Now voting: <b>${esc(current.name)}</b></p>` : ''}
    </div>`;

  const buttons = v.self.canVote
    ? `<div class="vote-row">
         <button class="btn danger" data-act="voteYes">✋ Yes</button>
         <button class="btn" data-act="voteNo">✕ No</button>
       </div>
       ${v.self.alive ? '' : '<p class="faint center">Voting yes spends your one ghost vote.</p>'}
       ${v.self.character === 'butler' && v.self.butlerMaster
         ? `<div class="banner warn">Your master is
             <b>${esc(v.players.find((p) => p.id === v.self.butlerMaster)?.name || '?')}</b>.
             Your vote only counts if they vote yes too.</div>`
         : ''}`
    : `<div class="banner info">${
        !v.self.alive && v.self.ghostVoteUsed
          ? 'You have used your ghost vote.'
          : sequential
            ? 'Wait for your turn.'
            : 'Vote recorded. Waiting for the others.'
      }</div>`;

  const hands = v.players
    .filter((p) => p.alive || !p.ghostVoteUsed)
    .map((p) =>
      playerRow(p, {
        tags: [p.hasVoted ? '<span class="tag ok">voted</span>' : '<span class="tag">…</span>'],
      }),
    )
    .join('');

  return `${head}${buttons}<div class="card"><h2>Hands</h2><div class="players">${hands}</div></div>`;
}

function duskScreen(v) {
  const executed = v.log.filter((l) => l.day === v.day && /is executed|No execution today/.test(l.text));
  return `
    <div class="card center">
      <div style="font-size:48px">🌆</div>
      <h2 style="margin-top:8px">Dusk</h2>
      <div class="stack" style="margin-top:10px">
        ${executed.map((e) => `<p style="font-size:19px;font-weight:650">${esc(e.text)}</p>`).join('') ||
        '<p class="muted">The day is over.</p>'}
      </div>
      <p class="muted" style="margin-top:12px">Night falls in <span id="phaseCountdown">–</span></p>
    </div>`;
}

function overScreen(v) {
  const good = v.winner === 'good';
  return `
    <div class="card center">
      <div style="font-size:56px">${good ? '🕊️' : '👹'}</div>
      <h2 style="font-size:28px;margin-top:8px;color:${good ? 'var(--good)' : 'var(--evil)'}">
        ${good ? 'Good wins' : 'Evil wins'}
      </h2>
      <p class="muted" style="margin-top:6px">${esc(v.winReason || '')}</p>
    </div>
    <div class="card">
      <h2>The grimoire</h2>
      ${(v.grimoire || [])
        .map((r) => {
          const c = ch(r.character);
          const fake = r.character === 'drunk' && r.perceived !== 'drunk' ? ch(r.perceived) : null;
          return `<div class="grim-row">
            <span class="em">${c.emoji}</span>
            <span class="who">
              <b>${esc(r.name)}${r.alive ? '' : ' ☠️'}</b>
              <span>${esc(c.name)}${fake ? ` — thought they were the ${esc(fake.name)}` : ''}${
                r.redHerring ? ' · red herring' : ''
              }</span>
            </span>
            <span class="tag ${r.alignment === 'evil' ? 'evil' : 'good'}">${r.alignment}</span>
          </div>`;
        })
        .join('')}
    </div>
    ${v.youId === v.hostId ? '<button class="btn primary" data-act="playAgain">Play again</button>' : ''}
    <button class="btn ghost" data-act="leave">Leave room</button>`;
}

function meTab(v) {
  const entries = v.self.log.slice().reverse();
  return `
    ${notificationCard(v)}
    ${roleCard(v)}
    ${!v.self.alive ? '<div class="banner warn">You are dead — but you still talk, and you still win or lose with your team.</div>' : ''}
    ${v.self.butlerMaster
      ? `<div class="banner info">Your master is
          <b>${esc(v.players.find((p) => p.id === v.self.butlerMaster)?.name || '?')}</b>.</div>`
      : ''}
    <div class="card">
      <h2>What you know</h2>
      ${entries.length === 0
        ? '<p class="muted">Nothing yet. Information arrives at night.</p>'
        : `<div class="stack" style="margin-top:10px">${entries.map(infoCard).join('')}</div>`}
    </div>
    <button class="btn ghost" data-act="forget">Sign out on this phone</button>`;
}

function logTab(v) {
  const lines = v.log
    .slice()
    .reverse()
    .map((l) => {
      const marker = l.phase === 'night' ? `N${l.night}` : l.day ? `D${l.day}` : '·';
      return `<div class="logline ${l.important ? 'important' : ''}">
        <span class="marker">${marker}</span><span>${esc(l.text)}</span>
      </div>`;
    })
    .join('');
  return `<div class="card"><h2>What happened</h2>${lines || '<p class="muted">Nothing yet.</p>'}</div>`;
}

// -------------------------------------------------------------- local clock

function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function tickUI() {
  const timer = document.getElementById('timer');
  const active = S.promptDeadline ?? S.phaseDeadline;
  if (timer) {
    if (active) {
      const left = active - Date.now();
      timer.textContent = fmt(left);
      timer.hidden = false;
      timer.classList.toggle('urgent', left < 10_000);
    } else {
      timer.hidden = true;
    }
  }

  const pc = document.getElementById('promptCountdown');
  if (pc && S.promptDeadline) pc.textContent = fmt(S.promptDeadline - Date.now());

  const phc = document.getElementById('phaseCountdown');
  if (phc && S.phaseDeadline) phc.textContent = fmt(S.phaseDeadline - Date.now());
}

setInterval(tickUI, 250);

// Keep the screen on while the phone is being read, but never fight the OS.
let wakeLock = null;
async function refreshWakeLock() {
  try {
    if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
    const wants = S.view && ['day', 'nominations', 'speech', 'voting', 'dawn'].includes(S.view.phase);
    if (wants && !wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    else if (!wants && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}
setInterval(refreshWakeLock, 3000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refreshWakeLock();
    if (!S.connected) connect();
  }
});

// ---------------------------------------------------------------- bootstrap

async function boot() {
  render();
  try {
    S.config = await (await fetch('/api/config')).json();
    for (const c of S.config.characters) S.chars[c.id] = c;
  } catch {
    toast('Could not load game data.');
  }
  await registerServiceWorker();

  const hash = (location.hash || '').replace('#', '').toUpperCase();
  if (S.session && (!hash || hash === S.session.code)) connect();
  else render();
}

setInterval(() => {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify({ t: 'ping' }));
}, 25_000);

boot();
