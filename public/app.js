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
    handleTurnChange(msg.view);
  } else if (msg.t === 'error') {
    showError(msg.message);
  }
  render();
}

function turnKey(view) {
  if (view.nightTurn) return `turn-${view.phase}-${view.night}-${view.nightTurn.body}`;
  if (view.nightResult) return `result-${view.phase}-${view.night}-${view.nightResult}`;
  return null;
}

// The server can push a fresh view for reasons that have nothing to do with your own turn
// (another player's connection status changes, someone else answers their turn, a periodic
// timeout check, ...). Only wipe the in-progress selection when the turn itself actually
// changed — otherwise a routine broadcast mid-click would silently clear what you just picked.
function handleTurnChange(view) {
  const key = turnKey(view);
  if (key === lastTurnKey) return;
  if (key && navigator.vibrate) navigator.vibrate([180, 80, 180]);
  state.selected = [];
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
    el('div', { class: 'ability' }, v.myCharacter.ability),
    el(
      'div',
      { class: 'neighbors' },
      `${v.leftNeighborName || '?'}  ⟵ you ⟶  ${v.rightNeighborName || '?'}`
    ),
  ]);
}

function secondsLeft(ts) {
  return Math.max(0, Math.ceil((ts - Date.now()) / 1000));
}

function playerRow(p, opts = {}) {
  const children = [
    el('div', { class: 'seat' }, String(p.seat + 1)),
    el('div', {}, p.name + (p.isSelf ? ' (you)' : '')),
  ];
  if (opts.showSeating) {
    children.push(
      el('div', { class: 'vote-status ' + (p.hasDeclaredSeating ? 'yes' : 'muted') }, p.hasDeclaredSeating ? '✓ seated' : '… seating')
    );
  }
  children.push(el('div', { class: 'dot ' + (p.connected ? 'on' : 'off') }));
  return el('div', { class: 'player-row' + (p.alive === false ? ' dead' : '') }, children);
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

function rightNeighborSelect(v) {
  // Anyone but yourself — no other restriction here. Whether the picks actually form one
  // consistent circle is checked all at once by seatingConfirmed, not per-answer.
  const others = v.players.filter((p) => p.id !== v.selfId);
  const current = v.mySeatRightId;
  return el(
    'select',
    { onchange: (e) => send({ t: 'declareNeighbor', side: 'right', neighborId: e.target.value }) },
    [
      el('option', { value: '', disabled: 'true', selected: current ? null : 'true' }, '— choose —'),
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
    label.textContent = p.name + (p.id === v.selfId ? ' (you)' : '');
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
    status = el('p', { class: 'muted center' }, 'Need at least 3 players before seating can be set.');
  } else if (v.seatingConfirmed) {
    status = el('p', { class: 'muted center' }, '✓ Seating confirmed — order is locked in.');
  } else if (pending.length) {
    status = el('p', { class: 'muted center' }, `Waiting on seating from: ${pending.join(', ')}`);
  } else {
    status = el('p', { class: 'muted center' }, "⚠️ Not a full circle yet — someone's answer doesn't line up. Check the diagram below.");
  }

  return el('div', { class: 'card' }, [
    el('h2', {}, 'Seating'),
    el('p', { class: 'muted' }, 'Go around the table — everyone just answers who is sitting to their right.'),
    el('label', { class: 'muted', style: 'display:block;margin-top:10px;font-size:0.85rem;' }, [
      'Who is sitting to your RIGHT?',
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
  let startLabel = `Start Game (${count} players)`;
  if (!countOk) startLabel = `Need 5-15 players (${count})`;
  else if (!v.seatingConfirmed) startLabel = 'Waiting on seating to be confirmed';

  return renderScreen([
    el('h1', {}, 'Lobby'),
    el('div', { class: 'code-badge' }, v.code),
    el('p', { class: 'muted center' }, 'Share this code with everyone at the table.'),
    el('div', { class: 'card player-list' }, v.players.map((p) => playerRow(p, { showSeating: true }))),
    renderSeatingSetup(v),
    isHost
      ? el('button', { class: 'block', disabled: !canStart ? 'true' : null, onclick: () => send({ t: 'start' }) }, startLabel)
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
  if (t.shape === 'choose') send({ t: 'nightReal', targetIds: state.selected.slice() });
  else send({ t: 'nightReal', targetIds: [] });
  state.selected = [];
}

function renderNight(v) {
  const banner = el('div', { class: 'moon' }, '🌙');

  if (v.nightTurn) {
    const t = v.nightTurn;
    const children = [
      roleBanner(v),
      banner,
      el('h1', { class: 'center' }, `Night ${v.night}`),
      el('div', { class: 'card' }, [
        el('h2', {}, t.shape === 'info' ? 'Your Information' : 'Your Turn'),
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

  if (v.nightResult) {
    return renderScreen([
      roleBanner(v),
      banner,
      el('h1', { class: 'center' }, `Night ${v.night}`),
      el('div', { class: 'card' }, [el('h2', {}, 'Your Result'), el('p', { class: 'muted' }, v.nightResult)]),
    ]);
  }

  return renderScreen([
    roleBanner(v),
    banner,
    el('h1', { class: 'center pulse' }, `Night ${v.night}`),
    v.amIAlive
      ? dotsEnabled()
        ? renderWaitingDots()
        : el('p', { class: 'muted center' }, 'Practice dots are hidden. Keep your eyes on your screen anyway.')
      : el('p', { class: 'muted center' }, 'You are dead and rest peacefully.'),
    v.amIAlive ? dotsToggle() : null,
  ]);
}

// Purely cosmetic: gives someone who has already answered this round something to keep
// tapping, so the moment they finish never visibly differs from someone still deliberating a
// real choice — nobody can tell "done" from "still thinking" just by watching the table.
// There is no penalty for missing a dot; this exists only to keep eyes on the phone.
let waitingDotsTimer = null;

function stopWaitingDots() {
  if (waitingDotsTimer) {
    clearTimeout(waitingDotsTimer);
    waitingDotsTimer = null;
  }
}

function dotsEnabled() {
  return localStorage.getItem('botc.dotsDisabled') !== '1';
}

function dotsToggle() {
  const enabled = dotsEnabled();
  return el(
    'button',
    {
      class: 'secondary dots-toggle',
      onclick: () => {
        localStorage.setItem('botc.dotsDisabled', enabled ? '1' : '0');
        stopWaitingDots();
        render();
      },
    },
    enabled ? 'Hide practice dots (testing)' : 'Show practice dots'
  );
}

function renderWaitingDots() {
  const box = el('div', { class: 'dot-box' });

  function spawnDot() {
    box.innerHTML = '';
    const x = 12 + Math.random() * 76;
    const y = 12 + Math.random() * 76;
    const dot = el('button', {
      class: 'tap-dot',
      style: `left:${x}%; top:${y}%;`,
      onclick: (e) => {
        e.currentTarget.classList.add('tapped');
        e.currentTarget.disabled = true;
      },
    });
    box.appendChild(dot);
    waitingDotsTimer = setTimeout(spawnDot, 1800 + Math.random() * 2200);
  }
  spawnDot();

  return el('div', { class: 'card dot-card' }, [
    el('p', { class: 'muted center' }, "The night is still. Tap the dot when it appears — keep your eyes on your screen."),
    box,
  ]);
}

function renderVoteList(v, n) {
  return el(
    'div',
    { class: 'vote-list' },
    n.voteOrder.map(({ id, name }) => {
      const voted = id in n.votes;
      const isCurrent = id === n.currentVoterId;
      let status = '· waiting';
      let statusClass = 'muted';
      if (voted) {
        status = n.votes[id] ? '✓ Yes' : '✗ No';
        statusClass = n.votes[id] ? 'yes' : 'no';
      } else if (isCurrent) {
        status = 'voting…';
        statusClass = 'current';
      }
      return el('div', { class: 'vote-row' + (isCurrent ? ' current' : '') }, [
        el('div', {}, name + (id === v.selfId ? ' (you)' : '')),
        el('div', { class: 'vote-status ' + statusClass }, status),
      ]);
    })
  );
}

function renderNomination(v) {
  const n = v.nomination;
  const card = [el('h2', {}, `${n.nominatorName} accuses ${n.nomineeName}`)];

  if (n.state === 'accusing') {
    card.push(el('p', { class: 'muted center' }, `${n.nominatorName} is making their case… (${secondsLeft(n.phaseEndsAt)}s)`));
    if (v.selfId === n.nominatorId) {
      card.push(el('button', { class: 'block secondary', onclick: () => send({ t: 'skipSpeech' }) }, 'Done — move to defense'));
    }
  } else if (n.state === 'defending') {
    card.push(el('p', { class: 'muted center' }, `${n.nomineeName} is responding… (${secondsLeft(n.phaseEndsAt)}s)`));
    if (v.selfId === n.nomineeId) {
      card.push(el('button', { class: 'block secondary', onclick: () => send({ t: 'skipSpeech' }) }, 'Done — start the vote'));
    }
  } else if (n.state === 'voting') {
    if (v.selfId === n.currentVoterId) {
      card.push(el('p', { class: 'center' }, "It's your vote — everyone can see it."));
      card.push(
        el('div', { class: 'footer-actions' }, [
          el('button', { onclick: () => send({ t: 'vote', yes: true }) }, 'Yes'),
          el('button', { class: 'secondary', onclick: () => send({ t: 'vote', yes: false }) }, 'No'),
        ])
      );
    } else {
      card.push(el('p', { class: 'muted center pulse' }, `Waiting on ${n.currentVoterName || '…'} to vote…`));
    }
    card.push(renderVoteList(v, n));
  }

  return el('div', { class: 'card' }, card);
}

function renderEndDayConsensus(v) {
  if (!v.amIAlive) return null;
  const names = v.endDayReadyNames.length ? ` (${v.endDayReadyNames.join(', ')})` : '';
  return el('div', { class: 'card' }, [
    el('h2', {}, 'End the Day'),
    el('p', { class: 'muted' }, `${v.endDayReadyCount}/${v.endDayAliveCount} players ready to move on${names}`),
    el(
      'button',
      { class: 'block' + (v.myEndDayReady ? ' secondary' : ''), onclick: () => send({ t: 'endDay' }) },
      v.myEndDayReady ? "Changed my mind — keep talking" : "I'm ready to end the day"
    ),
  ]);
}

function renderDay(v) {
  const self = v.players.find((p) => p.id === v.selfId);
  const children = [el('h1', {}, `Day ${v.day}`), roleBanner(v)];

  if (v.onBlockId) {
    const onBlock = v.players.find((p) => p.id === v.onBlockId);
    children.push(el('div', { class: 'card center' }, `On the block: ${onBlock ? onBlock.name : '?'}`));
  }

  if (v.nomination) {
    children.push(renderNomination(v));
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
    children.push(renderEndDayConsensus(v));
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

  children.push(renderLog(v));
  return renderScreen(children);
}

function render() {
  stopWaitingDots(); // avoid piling up timers across re-renders; re-armed below if still waiting
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

// The server only pushes a new view when something actually changes, so an active countdown
// (a speech timer, a per-voter timeout) needs its own local tick purely to refresh the display.
setInterval(() => {
  const n = state.view && state.view.nomination;
  if (n && (n.state === 'accusing' || n.state === 'defending')) render();
}, 1000);

// Lets toggling the practice-dots setting in one tab take effect in every other tab open on
// this browser (localStorage writes don't fire this event in the tab that made them).
window.addEventListener('storage', (e) => {
  if (e.key === 'botc.dotsDisabled') render();
});

connect();
render();
