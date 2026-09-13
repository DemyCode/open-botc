const state = {
  ws: null,
  code: sessionStorage.getItem('botc.code'),
  token: sessionStorage.getItem('botc.token'),
  playerId: sessionStorage.getItem('botc.playerId'),
  view: null,
  selected: [],
};

let pendingJoin = null;
let lastTurnKey = null;

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
    state.view = msg.view;
    maybeVibrate(msg.view);
    state.selected = [];
  } else if (msg.t === 'error') {
    showError(msg.message);
  }
  render();
}

function maybeVibrate(view) {
  const key = view.nightTurn ? `${view.phase}-${view.night}-${view.nightTurn.kind}-${view.nightTurn.body}` : null;
  if (key && key !== lastTurnKey && navigator.vibrate) navigator.vibrate([180, 80, 180]);
  lastTurnKey = key;
}

function showError(message) {
  const bar = el('div', {}, message);
  bar.style.cssText =
    'position:fixed;top:0;left:0;right:0;background:#f87171;color:#111;padding:10px;text-align:center;z-index:999;font-weight:600;';
  document.body.appendChild(bar);
  setTimeout(() => bar.remove(), 3000);
}

function renderScreen(children) {
  return el('div', { class: 'screen' }, children);
}

function roleBanner(v) {
  if (!v.myCharacter) return null;
  return el('div', { class: 'role-banner' }, [
    el('div', { class: 'align' }, v.myCharacter.alignment),
    el('div', { class: 'name' }, v.myCharacter.name),
  ]);
}

function playerRow(p) {
  return el('div', { class: 'player-row' + (p.alive === false ? ' dead' : '') }, [
    el('div', { class: 'seat' }, String(p.seat + 1)),
    el('div', {}, p.name + (p.isSelf ? ' (you)' : '')),
    el('div', { class: 'dot ' + (p.connected ? 'on' : 'off') }),
  ]);
}

function renderLog(v) {
  return el(
    'div',
    { class: 'card log' },
    v.publicLog
      .slice(-12)
      .reverse()
      .map((line) => el('div', { class: 'log-entry' }, line))
  );
}

function renderLanding() {
  const nameInput = el('input', { placeholder: 'Your name', value: localStorage.getItem('botc.name') || '' });
  const codeInput = el('input', { placeholder: 'Room code' });
  codeInput.style.textTransform = 'uppercase';

  const joinBtn = el(
    'button',
    {
      class: 'block',
      onclick: () => {
        const name = nameInput.value.trim();
        const code = codeInput.value.trim().toUpperCase();
        if (!name || !code) return showError('Enter your name and a room code');
        localStorage.setItem('botc.name', name);
        doJoin(code, name);
      },
    },
    'Join Game'
  );

  const createBtn = el(
    'button',
    {
      class: 'block secondary',
      onclick: async () => {
        const name = nameInput.value.trim();
        if (!name) return showError('Enter your name first');
        localStorage.setItem('botc.name', name);
        const res = await fetch('/api/rooms', { method: 'POST' });
        const data = await res.json();
        doJoin(data.code, name);
      },
    },
    'Create New Game'
  );

  return renderScreen([
    el('h1', {}, 'Blood on the Clocktower'),
    el('p', { class: 'muted' }, 'Fully automatic storyteller. Play in person, on your phones.'),
    el('div', { class: 'card', style: 'display:flex;flex-direction:column;gap:10px;' }, [nameInput, codeInput, joinBtn]),
    el('div', { class: 'center muted' }, 'or'),
    createBtn,
  ]);
}

function renderLobby(v) {
  const isHost = v.hostId === v.selfId;
  const count = v.players.length;
  const canStart = count >= 5 && count <= 15;
  return renderScreen([
    el('h1', {}, 'Lobby'),
    el('div', { class: 'code-badge' }, v.code),
    el('p', { class: 'muted center' }, 'Share this code with everyone at the table.'),
    el('div', { class: 'card player-list' }, v.players.map(playerRow)),
    isHost
      ? el(
          'button',
          { class: 'block', disabled: !canStart ? 'true' : null, onclick: () => send({ t: 'start' }) },
          canStart ? `Start Game (${count} players)` : `Need 5-15 players (${count})`
        )
      : el('p', { class: 'muted center' }, 'Waiting for the host to start…'),
  ]);
}

function toggleChoice(id, max) {
  const i = state.selected.indexOf(id);
  if (i >= 0) {
    state.selected.splice(i, 1);
    return;
  }
  if (max <= 1) state.selected = [];
  else if (state.selected.length >= max) state.selected.shift();
  state.selected.push(id);
}

function submitTurn(t) {
  if (t.kind === 'decoy') send({ t: 'nightDecoy', targetId: state.selected[0] });
  else if (t.shape === 'choose') send({ t: 'nightReal', targetIds: state.selected.slice() });
  else send({ t: 'nightReal', targetIds: [] });
  state.selected = [];
}

function renderNight(v) {
  const banner = el('div', { class: 'moon' }, '🌙');

  if (v.nightTurn) {
    const t = v.nightTurn;
    const children = [
      banner,
      el('h1', { class: 'center' }, `Night ${v.night}`),
      el('div', { class: 'card' }, [
        el('h2', {}, t.kind === 'real' && t.shape === 'info' ? 'Your Information' : 'Your Turn'),
        el('p', { class: 'muted' }, t.body),
      ]),
    ];

    if (t.shape === 'choose') {
      const grid = el(
        'div',
        { class: 'choice-grid' },
        t.choices.map((c) =>
          el(
            'button',
            {
              class: 'choice' + (state.selected.includes(c.id) ? ' selected' : ''),
              onclick: () => {
                toggleChoice(c.id, t.max);
                render();
              },
            },
            `${c.seat + 1}. ${c.name}`
          )
        )
      );
      children.push(grid);
      children.push(
        el(
          'button',
          { class: 'block', disabled: state.selected.length < t.min ? 'true' : null, onclick: () => submitTurn(t) },
          'Confirm'
        )
      );
    } else {
      children.push(el('button', { class: 'block', onclick: () => submitTurn(t) }, 'Got it'));
    }
    return renderScreen(children);
  }

  return renderScreen([
    banner,
    el('h1', { class: 'center pulse' }, `Night ${v.night}`),
    el(
      'p',
      { class: 'muted center' },
      v.amIAlive
        ? "The night is still. Keep your phone face down — it will buzz when it's your turn."
        : 'You are dead and rest peacefully.'
    ),
  ]);
}

function renderDay(v) {
  const self = v.players.find((p) => p.id === v.selfId);
  const isHost = v.hostId === v.selfId;
  const children = [el('h1', {}, `Day ${v.day}`), roleBanner(v)];

  if (v.onBlockId) {
    const onBlock = v.players.find((p) => p.id === v.onBlockId);
    children.push(el('div', { class: 'card center' }, `On the block: ${onBlock ? onBlock.name : '?'}`));
  }

  if (v.nomination) {
    const n = v.nomination;
    const myVote = n.votes[v.selfId];
    children.push(
      el('div', { class: 'card' }, [
        el('h2', {}, `${n.nominatorName} nominates ${n.nomineeName}`),
        el('p', { class: 'muted' }, `${Object.keys(n.votes).length} vote(s) cast so far`),
        el('div', { class: 'footer-actions' }, [
          el(
            'button',
            { class: myVote === true ? '' : 'secondary', onclick: () => send({ t: 'vote', yes: true }) },
            'Vote Yes'
          ),
          el(
            'button',
            { class: myVote === false ? '' : 'secondary', onclick: () => send({ t: 'vote', yes: false }) },
            'Vote No'
          ),
        ]),
        isHost ? el('button', { class: 'block secondary', onclick: () => send({ t: 'closeVote' }) }, 'Tally Votes') : null,
      ])
    );
  } else {
    children.push(
      el(
        'div',
        { class: 'card player-list' },
        v.players.map((p) => {
          const row = playerRow(p);
          if (self && self.alive && p.alive && p.id !== v.selfId) {
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => send({ t: 'nominate', nomineeId: p.id }));
          }
          return row;
        })
      )
    );
    if (isHost) children.push(el('button', { class: 'block secondary', onclick: () => send({ t: 'endDay' }) }, 'End Day'));
  }

  if (v.myCharacter && v.myCharacter.id === 'slayer' && !v.mySlayerUsed && v.amIAlive) {
    children.push(
      el('div', { class: 'card' }, [
        el('h2', {}, 'Slayer Shot'),
        el('p', { class: 'muted' }, 'Once per game: publicly choose a player. If they are the Demon, they die.'),
        el(
          'div',
          { class: 'choice-grid' },
          v.players
            .filter((p) => p.alive)
            .map((p) =>
              el(
                'button',
                {
                  class: 'choice',
                  onclick: () => {
                    if (confirm(`Publicly accuse ${p.name} as the Demon?`)) send({ t: 'slayer', targetId: p.id });
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
        el('h2', {}, 'Your Information'),
        el(
          'div',
          { class: 'log' },
          v.myLog.map((e) => el('div', { class: 'log-entry' }, `Night ${e.night}: ${e.text}`))
        ),
      ])
    );
  }

  children.push(renderLog(v));
  return renderScreen(children);
}

function renderEnded(v) {
  const winnerLabel = v.winner === 'good' ? 'Good Wins!' : 'Evil Wins!';
  const children = [
    el('h1', { class: 'center' }, winnerLabel),
    el(
      'div',
      { class: 'card player-list' },
      v.players.map((p) =>
        el('div', { class: 'player-row' + (p.alive ? '' : ' dead') }, [
          el('div', { class: 'seat' }, String(p.seat + 1)),
          el('div', {}, `${p.name} — ${p.characterName || '?'}`),
        ])
      )
    ),
  ];

  if (v.superlatives && v.superlatives.length) {
    children.push(el('h2', {}, 'Superlatives'));
    v.superlatives.forEach((s) => {
      const entries = Object.entries(s.tally).sort((a, b) => b[1] - a[1]);
      const top = entries[0];
      const name = top ? v.players.find((p) => p.id === top[0])?.name ?? '?' : '—';
      children.push(el('div', { class: 'card' }, `${s.question} → ${name} (${top ? top[1] : 0} votes)`));
    });
  }

  children.push(renderLog(v));
  return renderScreen(children);
}

function render() {
  app.innerHTML = '';
  if (!state.code || !state.playerId) {
    app.appendChild(renderLanding());
    return;
  }
  if (!state.view) {
    app.appendChild(renderScreen([el('p', { class: 'muted center' }, 'Connecting…')]));
    return;
  }
  const v = state.view;
  if (v.phase === 'lobby') app.appendChild(renderLobby(v));
  else if (v.phase === 'night') app.appendChild(renderNight(v));
  else if (v.phase === 'day') app.appendChild(renderDay(v));
  else if (v.phase === 'ended') app.appendChild(renderEnded(v));
}

connect();
render();
