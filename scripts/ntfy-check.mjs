#!/usr/bin/env node
/**
 * Verifies what we actually send to ntfy.
 *
 * By default this is self-contained: it starts a mock ntfy server and a game
 * server pointed at it, then asserts the topic, priority and headers of both a
 * test buzz and a real in-game notification. No external network needed.
 *
 *   node scripts/ntfy-check.mjs            # offline, deterministic
 *   node scripts/ntfy-check.mjs --live     # additionally publish to the real
 *                                          # ntfy server and read it back
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { WebSocket } from 'ws';

const args = new Set(process.argv.slice(2));
const LIVE = args.has('--live');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(cond, msg) {
  if (cond) console.log(`  ✔ ${msg}`);
  else {
    failures++;
    console.error(`  ✖ ${msg}`);
  }
}

// ------------------------------------------------------------- mock ntfy

/** Records every publish so we can assert on the headers we send. */
const received = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    received.push({
      topic: decodeURIComponent(req.url.slice(1)),
      headers: req.headers,
      body,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"id":"mock"}');
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const mockPort = mock.address().port;
const MOCK_URL = `http://127.0.0.1:${mockPort}`;

// ------------------------------------------------------------- game server

const port = 8700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync('/tmp/botc-ntfy-');
const server = spawn(process.execPath, ['dist/index.js'], {
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    BOTC_NTFY_URL: MOCK_URL,
    BOTC_PUBLIC_URL: 'http://clocktower.example',
    BOTC_DATA_DIR: dataDir,
  },
  stdio: 'ignore',
});

function cleanup() {
  server.kill();
  mock.close();
  try {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* the OS will reap /tmp */
  }
}
process.on('exit', cleanup);
process.on('uncaughtException', (e) => {
  console.error(e);
  process.exit(1);
});

for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/api/config`)).ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 80) {
    console.error('✖ game server never came up');
    process.exit(1);
  }
  await sleep(250);
}

const config = await (await fetch(`${BASE}/api/config`)).json();
console.log(`\nmock ntfy   : ${MOCK_URL}`);
console.log(`ntfy host   : ${config.ntfyHost}\n`);

// ------------------------------------------------------------------ players

class Player {
  constructor(name) {
    this.name = name;
    this.view = null;
  }
  async connect(code) {
    this.ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
    this.ws.on('error', (e) => {
      console.error(`✖ websocket: ${e.message}`);
      process.exit(1);
    });
    await new Promise((r) => this.ws.on('open', r));
    this.ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.t === 'view') this.view = m.view;
      if (m.t === 'testBuzzResult') this.testResult = m;
    });
    this.send({ t: 'join', code, name: this.name });
    await sleep(150);
  }
  send(m) {
    this.ws.send(JSON.stringify(m));
  }
}

const { code } = await (await fetch(`${BASE}/api/rooms`, { method: 'POST' })).json();
const players = [];
for (let i = 0; i < 5; i++) {
  const p = new Player(`P${i + 1}`);
  await p.connect(code);
  players.push(p);
}
await sleep(300);

// ---- topic assignment
const topic = players[0].view?.self?.ntfyTopic;
check(!!topic, 'server assigns an ntfy topic on join, with no typing');
check(
  new Set(players.map((p) => p.view.self.ntfyTopic)).size === players.length,
  'every player gets a different topic',
);
check((topic || '').length >= 20, `topic is long enough to be unguessable (${topic})`);
console.log(`  deep link : ntfy://${config.ntfyHost}/${topic}?display=Clocktower`);

// ---- test buzz
players[0].send({ t: 'testBuzz' });
await sleep(500);

check(players[0].testResult?.delivered === true, 'test buzz reports delivered');
check(received.length === 1, `exactly one publish so far (got ${received.length})`);

const test = received[0];
check(test?.topic === topic, "test buzz goes to that player's own topic");
check(test?.headers.priority === 'max', `test buzz is priority max (got ${test?.headers.priority})`);
check(!!test?.headers.title, 'test buzz carries a title header');
check(
  /^[\x20-\x7e]*$/.test(test?.headers.title || ''),
  'title is ASCII-safe for an HTTP header',
);
check(
  test?.headers.click === `http://clocktower.example/#${code}`,
  'tapping the notification opens this room',
);

// ---- unconfirmed players must not be published to
received.length = 0;
players[0].send({ t: 'pushConfirmed', ok: true });
await sleep(200);

for (const p of players) p.send({ t: 'setOptions', options: { revealSeconds: 1 } });
players[0].send({ t: 'start' });
await sleep(800);

check(
  received.every((r) => r.topic === topic),
  'only the player who confirmed a test buzz is published to',
);
check(received.length > 0, 'the confirmed player is notified when the game starts');
check(
  received.every((r) => r.headers.priority === 'max'),
  'every in-game notification is priority max, so the phone vibrates',
);
console.log(`  in-game notifications sent: ${received.length}`);

// ---- live round-trip, if asked
if (LIVE) {
  console.log('\nlive check against the real ntfy server…');
  const liveTopic = `botc-live-${Math.random().toString(36).slice(2, 12)}`;
  const since = Math.floor(Date.now() / 1000) - 5;
  try {
    const pub = await fetch(`${config.ntfyBase}/${liveTopic}`, {
      method: 'POST',
      headers: { Title: 'Clocktower test', Priority: 'max', Tags: 'bell' },
      body: 'live round-trip',
      signal: AbortSignal.timeout(10_000),
    });
    check(pub.ok, `published to ${config.ntfyBase}`);
    const res = await fetch(`${config.ntfyBase}/${liveTopic}/json?poll=1&since=${since}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const msgs = (await res.text())
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((m) => m.event === 'message');
    check(msgs.length > 0, 'message read back off the live server');
    check(msgs.at(-1)?.priority === 5, `live message is priority 5 (got ${msgs.at(-1)?.priority})`);
  } catch (err) {
    console.error(`  ! live check skipped — ${err.message}`);
  }
}

console.log('');
if (failures === 0) {
  console.log('✅ ntfy contract verified');
  process.exit(0);
}
console.error(`❌ ${failures} failure(s)`);
process.exit(1);
