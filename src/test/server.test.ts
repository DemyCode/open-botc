// The real server, started as its own process, talked to over real HTTP and WebSockets — the same
// way phones do. Covers the protocol, error handling, reconnection, saving, static files, and a
// complete game played by bots over the wire (with night timings shortened by environment).
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';

// ---------------------------------------------------------------- harness

interface Running { port: number; proc: ChildProcess; stop: () => Promise<void>; output: () => string }

const FAST = { BOTC_MIN_ANSWER_MS: '40', BOTC_DAWN_MIN_MS: '60', BOTC_DAWN_MAX_MS: '90', BOTC_MIN_NIGHT_MS: '150' };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function startServer(dataDir: string, env: Record<string, string> = FAST): Promise<Running> {
  const port = await freePort();
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    env: { ...process.env, PORT: String(port), BOTC_DATA_DIR: dataDir, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout!.on('data', (d) => (out += d));
  proc.stderr!.on('data', (d) => (out += d));
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start: ' + out)), 15000);
    const check = setInterval(() => {
      if (out.includes('listening')) { clearInterval(check); clearTimeout(t); resolve(); }
    }, 25);
    proc.on('exit', () => { clearInterval(check); clearTimeout(t); reject(new Error('server exited: ' + out)); });
  });
  return {
    port, proc, output: () => out,
    stop: () => new Promise<void>((resolve) => { proc.once('exit', () => resolve()); proc.kill(); }),
  };
}

function request(port: number, method: string, rawPath: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    // Node's http client sends the path exactly as given (no "../" normalisation).
    const req = http.request({ host: '127.0.0.1', port, method, path: rawPath }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(pred: () => boolean, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out waiting for: ' + what);
    await sleep(10);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = Record<string, any>;

class Client {
  msgs: Msg[] = [];
  closed = false;
  closeCode = 0;
  id = '';
  token = '';
  constructor(public ws: WebSocket, public name = '?') {
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      this.msgs.push(m);
      if (m.t === 'identity') { this.id = m.playerId; this.token = m.token; }
    });
    ws.on('close', (code) => { this.closed = true; this.closeCode = code; });
  }
  static async open(port: number, name = '?'): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });
    return new Client(ws, name);
  }
  send(m: Msg | string): void { this.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); }
  get view(): Msg | null { return [...this.msgs].reverse().find((m) => m.t === 'view')?.view ?? null; }
  errors(): string[] { return this.msgs.filter((m) => m.t === 'error').map((m) => m.message); }
  async waitFor(pred: (m: Msg) => boolean, what: string, ms = 5000): Promise<Msg> {
    let found: Msg | undefined;
    await waitUntil(() => (found = this.msgs.find(pred)) !== undefined, what, ms);
    return found!;
  }
  async waitForError(text: RegExp | string): Promise<void> {
    await waitUntil(() => this.errors().some((e) => (typeof text === 'string' ? e.includes(text) : text.test(e))), `error ${text}`);
  }
  close(): void { this.ws.close(); }
}

async function createRoom(port: number): Promise<string> {
  const res = await request(port, 'POST', '/api/rooms');
  return JSON.parse(res.body).code;
}
async function join(port: number, code: string, name: string): Promise<Client> {
  const c = await Client.open(port, name);
  c.send({ t: 'join', code, name });
  await c.waitFor((m) => m.t === 'identity', `${name} identity`);
  await waitUntil(() => c.view !== null, `${name} first view`);
  return c;
}
/** Everyone declares the person after them as their right-hand neighbour: one consistent circle. */
async function seat(clients: Client[]): Promise<void> {
  clients.forEach((c, i) => c.send({ t: 'declareNeighbor', neighborId: clients[(i + 1) % clients.length].id }));
  await waitUntil(() => clients.every((c) => c.view?.seatingConfirmed), 'seating confirmed');
}

let dataDir: string;
let server: Running;
before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botc-test-'));
  server = await startServer(dataDir);
});
after(async () => {
  await server.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- static files & HTTP API

test('GET / serves the app, never cached', async () => {
  const res = await request(server.port, 'GET', '/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type']!, /text\/html/);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.ok(res.body.includes('<div id="app">'));
});

test('the scripts and stylesheet are served with the right types', async () => {
  for (const [file, type] of [['/app.js', /javascript/], ['/glossary.js', /javascript/], ['/tips.js', /javascript/], ['/terms.js', /javascript/], ['/style.css', /css/]] as const) {
    const res = await request(server.port, 'GET', file);
    assert.equal(res.status, 200, file);
    assert.match(res.headers['content-type']!, type, file);
  }
});

test('an unknown file is a 404', async () => {
  assert.equal((await request(server.port, 'GET', '/nope.js')).status, 404);
  assert.equal((await request(server.port, 'GET', '/data/rooms.json')).status, 404, 'saved rooms are not served');
});

test('a query string is ignored when serving a file', async () => {
  assert.equal((await request(server.port, 'GET', '/app.js?v=123')).status, 200);
});

test('files outside the public folder are refused — including a sibling folder that shares its prefix', async () => {
  const sibling = path.resolve('public-sibling-test');
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, 'secret.txt'), 'top secret');
  try {
    for (const p of ['/../package.json', '/../../etc/passwd', '/../public-sibling-test/secret.txt', '/..%2fpackage.json']) {
      const res = await request(server.port, 'GET', p);
      assert.ok(res.status === 403 || res.status === 404, `${p} → ${res.status}`);
      assert.ok(!res.body.includes('top secret') && !res.body.includes('"name": "open-botc"'), `${p} leaked a file`);
    }
  } finally {
    fs.rmSync(sibling, { recursive: true, force: true });
  }
});

test('POST /api/rooms creates a room with a 4-letter code; each one is different', async () => {
  const codes = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const res = await request(server.port, 'POST', '/api/rooms');
    assert.equal(res.status, 200);
    const { code } = JSON.parse(res.body);
    assert.match(code, /^[A-Z]{4}$/);
    assert.ok(!/[IO]/.test(code), 'no look-alike letters');
    codes.add(code);
  }
  assert.equal(codes.size, 20);
});

test('GET /api/characters lists every character of every edition (22 Trouble Brewing among them)', async () => {
  const chars = JSON.parse((await request(server.port, 'GET', '/api/characters')).body);
  assert.equal(chars.filter((c: { edition: string }) => c.edition === 'tb').length, 22);
  for (const c of chars) assert.ok(c.id && c.name && c.team && c.ability);
});

// ---------------------------------------------------------------- joining

test('joining a room that does not exist is refused', async () => {
  const c = await Client.open(server.port);
  c.send({ t: 'join', code: 'ZZZZ', name: 'Ana' });
  await c.waitForError('Room not found');
  c.close();
});

test('the room code is case-insensitive', async () => {
  const code = await createRoom(server.port);
  const c = await Client.open(server.port);
  c.send({ t: 'join', code: code.toLowerCase(), name: 'Ana' });
  await c.waitFor((m) => m.t === 'identity', 'identity');
  c.close();
});

test('joining gives an identity (id + secret token) and a first view; the first player is the host', async () => {
  const code = await createRoom(server.port);
  const ana = await join(server.port, code, 'Ana');
  const bo = await join(server.port, code, 'Bo');
  assert.ok(ana.id && ana.token && ana.token.length >= 10);
  assert.notEqual(ana.token, bo.token);
  assert.equal(ana.view!.hostId, ana.id);
  assert.equal(bo.view!.hostId, ana.id);
  assert.equal(ana.view!.phase, 'lobby');
  await waitUntil(() => ana.view!.players.length === 2, 'Ana sees Bo');
  ana.close(); bo.close();
});

test('two players cannot use the same name; the refusal explains why', async () => {
  const code = await createRoom(server.port);
  const ana = await join(server.port, code, 'Ana');
  const other = await Client.open(server.port);
  other.send({ t: 'join', code, name: 'ana' });
  await other.waitForError('already taken');
  assert.ok(!other.msgs.some((m) => m.t === 'identity'));
  ana.close(); other.close();
});

test('a nameless join gets "Player N"', async () => {
  const code = await createRoom(server.port);
  const c = await Client.open(server.port);
  c.send({ t: 'join', code });
  await c.waitFor((m) => m.t === 'identity', 'identity');
  await waitUntil(() => c.view !== null, 'view');
  assert.match(c.view!.players[0].name, /^Player \d+$/);
  c.close();
});

test('a 16th player is refused', async () => {
  const code = await createRoom(server.port);
  const clients: Client[] = [];
  for (let i = 0; i < 15; i++) clients.push(await join(server.port, code, `P${i}`));
  const extra = await Client.open(server.port);
  extra.send({ t: 'join', code, name: 'P15' });
  await extra.waitForError(/full/);
  [...clients, extra].forEach((c) => c.close());
});

// ---------------------------------------------------------------- protocol errors (the server must survive all of them)

test('talking before joining is refused, and unknown message types are refused', async () => {
  const code = await createRoom(server.port);
  const c = await Client.open(server.port);
  c.send({ t: 'nominate', nomineeId: 'x' });
  await c.waitForError('Not joined');
  c.send({ t: 'join', code, name: 'Ana' });
  await c.waitFor((m) => m.t === 'identity', 'identity');
  c.send({ t: 'launchMissiles' });
  await c.waitForError('Unknown message type');
  c.close();
});

test('garbage never crashes the server: bad JSON, null, numbers, arrays, strings, wrong field types', async () => {
  const code = await createRoom(server.port);
  const c = await join(server.port, code, 'Ana');
  for (const junk of ['not json', 'null', '123', '[]', '"hello"', '{}', '{"t":null}', '{"t":{"a":1}}', '{"t":"join"}', '{"t":"vote","yes":{}}',
    '{"t":"nightReal","targetIds":"nope"}', '{"t":"declareNeighbor","neighborId":{"x":1}}', '{"t":"nominate"}', '{"t":"slayer"}']) c.send(junk);
  await sleep(150);
  // The same connection still works, and so does the whole server.
  c.send({ t: 'nominate', nomineeId: 'x' });
  await waitUntil(() => c.errors().length > 0, 'still answering');
  assert.equal((await request(server.port, 'GET', '/')).status, 200);
  assert.ok(!server.proc.killed && server.proc.exitCode === null, 'the server process is still alive');
  c.close();
});

test('a message far bigger than any real one closes that connection — and only that one', async () => {
  const code = await createRoom(server.port);
  const good = await join(server.port, code, 'Good');
  const bad = await join(server.port, code, 'Bad');
  bad.send(JSON.stringify({ t: 'join', code, name: 'x'.repeat(200_000) }));
  await waitUntil(() => bad.closed, 'the oversized sender is disconnected');
  assert.equal(bad.closeCode, 1009);
  assert.equal(good.closed, false);
  good.send({ t: 'launchMissiles' });
  await good.waitForError('Unknown message type');
  good.close();
});

test('only the host can start the game, and not before seating is confirmed', async () => {
  const code = await createRoom(server.port);
  const cs = [] as Client[];
  for (const n of ['A', 'B', 'C', 'D', 'E']) cs.push(await join(server.port, code, n));
  cs[0].send({ t: 'start' });
  await cs[0].waitForError(/[Ss]eating/);
  await seat(cs);
  cs[1].send({ t: 'start' });
  await cs[1].waitForError('Host only');
  assert.equal(cs[0].view!.phase, 'lobby');
  cs[0].send({ t: 'start' });
  await waitUntil(() => cs.every((c) => c.view!.phase === 'night'), 'game started for everyone');
  cs.forEach((c) => c.close());
});

test('once the game has started nobody new can join, and a second start is refused', async () => {
  const code = await createRoom(server.port);
  const cs = [] as Client[];
  for (const n of ['A', 'B', 'C', 'D', 'E']) cs.push(await join(server.port, code, n));
  await seat(cs);
  cs[0].send({ t: 'start' });
  await waitUntil(() => cs[0].view!.phase === 'night', 'started');
  const late = await Client.open(server.port);
  late.send({ t: 'join', code, name: 'Late' });
  await late.waitForError('already started');
  cs[0].send({ t: 'start' });
  await cs[0].waitForError('already started');
  [...cs, late].forEach((c) => c.close());
});

test('acting out of turn is refused with a clear error and changes nothing', async () => {
  const code = await createRoom(server.port);
  const cs = [] as Client[];
  for (const n of ['A', 'B', 'C', 'D', 'E']) cs.push(await join(server.port, code, n));
  await seat(cs);
  cs[0].send({ t: 'start' });
  await waitUntil(() => cs.every((c) => c.view!.phase === 'night'), 'night');
  cs[1].send({ t: 'nominate', nomineeId: cs[2].id });
  await cs[1].waitForError(/Not day/);
  cs[1].send({ t: 'vote', yes: true });
  await cs[1].waitForError(/No nomination/);
  cs[1].send({ t: 'slayer', targetId: cs[2].id });
  await cs[1].waitForError(/during the day/);
  cs[1].send({ t: 'endDay' });
  await cs[1].waitForError(/Not day/);
  cs.forEach((c) => c.close());
});

test('a phone cannot act as another player: the server uses the connection, never a claimed id', async () => {
  const code = await createRoom(server.port);
  const cs = [] as Client[];
  for (const n of ['A', 'B', 'C', 'D', 'E']) cs.push(await join(server.port, code, n));
  await seat(cs);
  cs[0].send({ t: 'start' });
  await waitUntil(() => cs.every((c) => c.view!.phase === 'night'), 'night');
  // B tries to answer as A by putting A's id on the message — there is no such field to honour.
  cs[1].send({ t: 'nightReal', playerId: cs[0].id, targetIds: [] });
  await sleep(150);
  for (const c of cs) assert.ok(!c.view!.players.some((p: Msg) => p.id !== c.id && p.character), 'no character leaked to anyone');
  cs.forEach((c) => c.close());
});

// ---------------------------------------------------------------- what each phone is sent

test('each phone only receives its own character during the game — checked on the raw messages', async () => {
  const code = await createRoom(server.port);
  const cs = [] as Client[];
  for (const n of ['A', 'B', 'C', 'D', 'E', 'F']) cs.push(await join(server.port, code, n));
  await seat(cs);
  cs[0].send({ t: 'start' });
  await waitUntil(() => cs.every((c) => c.view!.phase === 'night'), 'night');
  await sleep(200);
  for (const c of cs) {
    for (const m of c.msgs.filter((x) => x.t === 'view')) {
      for (const p of m.view.players) if (p.id !== c.id) assert.equal(p.character, undefined, `${c.name} was sent ${p.name}'s character`);
    }
    assert.ok(c.view!.myCharacter?.id, 'but each knows their own');
  }
  cs.forEach((c) => c.close());
});

// ---------------------------------------------------------------- reconnecting

test('a phone that reconnects with its token gets the same player back, and the others see it come and go', async () => {
  const code = await createRoom(server.port);
  const ana = await join(server.port, code, 'Ana');
  const bo = await join(server.port, code, 'Bo');
  ana.close();
  await waitUntil(() => bo.view!.players.find((p: Msg) => p.name === 'Ana')?.connected === false, 'Bo sees Ana drop');

  const back = await Client.open(server.port, 'Ana2');
  back.send({ t: 'auth', code, token: ana.token });
  const identity = await back.waitFor((m) => m.t === 'identity', 'identity');
  assert.equal(identity.playerId, ana.id, 'the same player');
  await waitUntil(() => back.view !== null, 'view');
  assert.equal(back.view!.selfId, ana.id);
  assert.equal(back.view!.hostId, ana.id, 'still the host');
  await waitUntil(() => bo.view!.players.find((p: Msg) => p.name === 'Ana')?.connected === true, 'Bo sees Ana return');
  back.close(); bo.close();
});

test('a wrong or missing token is refused', async () => {
  const code = await createRoom(server.port);
  await join(server.port, code, 'Ana').then((c) => c.close());
  for (const token of ['wrong', '', undefined]) {
    const c = await Client.open(server.port);
    c.send({ t: 'auth', code, token });
    await c.waitForError('Invalid session');
    assert.ok(!c.msgs.some((m) => m.t === 'identity'));
    c.close();
  }
});

test('one player on two devices: both stay in sync, and only when both are gone are they marked away', async () => {
  const code = await createRoom(server.port);
  const ana = await join(server.port, code, 'Ana');
  const bo = await join(server.port, code, 'Bo');
  const second = await Client.open(server.port, 'Ana-tab2');
  second.send({ t: 'auth', code, token: ana.token });
  await second.waitFor((m) => m.t === 'identity', 'second identity');
  ana.close();
  await sleep(200);
  assert.equal(bo.view!.players.find((p: Msg) => p.name === 'Ana')!.connected, true, 'one tab still open');
  second.close();
  await waitUntil(() => bo.view!.players.find((p: Msg) => p.name === 'Ana')!.connected === false, 'now away');
  bo.close();
});

test('leaving in the lobby removes you; you can then no longer act', async () => {
  const code = await createRoom(server.port);
  const ana = await join(server.port, code, 'Ana');
  const bo = await join(server.port, code, 'Bo');
  await waitUntil(() => bo.view!.players.length === 2, 'both in');
  bo.send({ t: 'leave' });
  await waitUntil(() => ana.view!.players.length === 1, 'Ana sees Bo gone');
  bo.send({ t: 'start' });
  await bo.waitForError('Not joined');
  ana.close(); bo.close();
});

// ---------------------------------------------------------------- saving

test('rooms survive a server restart: same room, same players, same tokens', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botc-persist-'));
  const first = await startServer(dir);
  try {
    const code = await createRoom(first.port);
    const ana = await join(first.port, code, 'Ana');
    await join(first.port, code, 'Bo').then((c) => c.close());
    await sleep(900); // the save is debounced by half a second
    const { token, id } = ana;
    ana.close();
    await first.stop();

    const second = await startServer(dir);
    try {
      const back = await Client.open(second.port);
      back.send({ t: 'auth', code, token });
      const identity = await back.waitFor((m) => m.t === 'identity', 'identity after restart');
      assert.equal(identity.playerId, id);
      await waitUntil(() => back.view !== null, 'view after restart');
      assert.equal(back.view!.players.length, 2);
      back.close();
    } finally {
      await second.stop();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rooms saved by an older version of the game are discarded, not loaded (they could crash every phone)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botc-old-'));
  fs.writeFileSync(path.join(dir, 'rooms.json'), JSON.stringify({ version: 1, rooms: { OLDR: { code: 'OLDR', players: [], phase: 'night' } } }));
  const srv = await startServer(dir);
  try {
    const c = await Client.open(srv.port);
    c.send({ t: 'join', code: 'OLDR', name: 'Ana' });
    await c.waitForError('Room not found');
    assert.match(srv.output(), /Discarding persisted rooms/);
    c.close();
  } finally {
    await srv.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt save file does not stop the server from starting', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botc-corrupt-'));
  fs.writeFileSync(path.join(dir, 'rooms.json'), '{ this is not json');
  const srv = await startServer(dir);
  try {
    assert.equal((await request(srv.port, 'GET', '/')).status, 200);
  } finally {
    await srv.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- a whole game, over the wire

/**
 * A bot that plays by looking only at its own view, like a phone: answers night steps (after the
 * server's wait), readies for speeches, speaks, votes yes, and agrees to end the day. The first
 * living player (by seat) nominates the next living one, once a day.
 */
/** Where every phone is right now — printed when a game fails to finish. */
function whereIsEveryone(cs: Client[]): string {
  return cs.map((c) => {
    const v = c.view;
    if (!v) return `${c.name}: no view`;
    const me = v.players.find((p: Msg) => p.isSelf);
    const t = v.nightTurn;
    const n = v.nomination;
    return `${c.name}(${v.myCharacter?.id}${me?.alive ? '' : ',dead'}): ${v.phase} n${v.night} d${v.day}` +
      (t ? ` step=${t.stepKey} ${t.decoy ? 'decoy' : 'REAL'} wait=${t.waitMs}` : '') +
      (n ? ` nom=${n.state} voter=${n.currentVoterName}` : '') + (v.phase === 'day' ? ` endReady=${v.endDayReadyCount}/${v.endDayAliveCount} block=${v.onBlockId}` : '') +
      (c.errors().length ? ` errors=${JSON.stringify(c.errors().slice(-2))}` : '') + ` sent=[${[...((c as Client & { sent?: Set<string> }).sent ?? [])].filter((k) => k.startsWith('endday') || k.startsWith('nominate')).join(' ')}] myEnd=${v.myEndDayReady}`;
  }).join('\n');
}

function attachBrain(c: Client, all: () => Client[]): void {
  const sent = new Set<string>();
  (c as Client & { sent?: Set<string> }).sent = sent;
  const once = (key: string, msg: Msg, delay = 0) => {
    if (sent.has(key) || c.closed) return;
    sent.add(key);
    setTimeout(() => { if (!c.closed) c.send(msg); }, delay);
  };
  c.ws.on('message', () => {
    const v = c.view;
    if (!v) return;
    const me = v.players.find((p: Msg) => p.isSelf);
    if (v.phase === 'night' && v.nightTurn) {
      const t = v.nightTurn;
      const picks = t.shape === 'choose' ? t.choices.filter((x: Msg) => x.id !== c.id || t.max > 1).slice(0, t.min).map((x: Msg) => x.id) : [];
      once(`night-${t.stepKey}`, { t: 'nightReal', targetIds: picks }, t.waitMs + 20);
    }
    if (v.phase === 'day') {
      const alive = v.players.filter((p: Msg) => p.alive).sort((a: Msg, b: Msg) => a.seat - b.seat);
      const n = v.nomination;
      if (!n) {
        if (alive[0]?.id === c.id && !me.hasNominatedToday) {
          const target = alive.find((p: Msg) => p.id !== c.id && !p.hasBeenNominatedToday);
          if (target) once(`nominate-${v.day}`, { t: 'nominate', nomineeId: target.id });
        } else if (me.alive && (me.hasNominatedToday || alive[0]?.id !== c.id) && (v.players.some((p: Msg) => p.hasNominatedToday) || v.onBlockId !== null)) {
          if (!v.myEndDayReady) once(`endday-${v.day}`, { t: 'endDay' });
        }
      } else if (n.state === 'readyForAccusation') {
        if (!n.readyBy.includes(c.id)) once(`ready-${v.day}`, { t: 'readySpeech' });
      } else if (n.state === 'accusing' && n.nominatorId === c.id) once(`skip-a-${v.day}`, { t: 'skipSpeech' });
      else if (n.state === 'defending' && n.nomineeId === c.id) once(`skip-d-${v.day}`, { t: 'skipSpeech' });
      else if (n.state === 'voting' && n.currentVoterId === c.id) once(`vote-${v.day}-${n.nomineeId}`, { t: 'vote', yes: true });
    }
  });
}

test('a complete game between 7 bots over real WebSockets ends with a winner and a full reveal', async () => {
  const code = await createRoom(server.port);
  const cs: Client[] = [];
  for (const n of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) cs.push(await join(server.port, code, n));
  cs.forEach((c) => attachBrain(c, () => cs));
  await seat(cs);
  cs[0].send({ t: 'start' });
  try {
    await waitUntil(() => cs.every((c) => c.view?.phase === 'ended'), 'the game to end', 60_000);
  } catch (e) {
    throw new Error((e as Error).message + '\n' + whereIsEveryone(cs));
  }
  const winner = cs[0].view!.winner;
  assert.ok(winner === 'good' || winner === 'evil');
  for (const c of cs) {
    assert.equal(c.view!.winner, winner, 'everyone agrees on the winner');
    assert.ok(c.view!.players.every((p: Msg) => p.character), 'all characters revealed at the end');
  }
  assert.ok(cs[0].view!.publicLog.length > 3, 'the village log recorded the game');
  // The replay: never sent while the game ran, complete once it ended, and the same for everybody.
  for (const c of cs) {
    for (const m of c.msgs.filter((x) => x.t === 'view')) {
      if (m.view.phase !== 'ended') assert.equal(m.view.replay, null, `${c.name} was sent the replay before the end`);
    }
    assert.ok(Array.isArray(c.view!.replay) && c.view!.replay.length > 10, 'the replay arrives with the end');
    assert.equal(c.view!.replay[0].type, 'roles');
    assert.equal(c.view!.replay.at(-1).type, 'win');
    assert.deepEqual(c.view!.replay, cs[0].view!.replay);
  }
  assert.ok(cs.every((c) => c.errors().every((e) => !/Internal error/.test(e))), 'no internal error at any point');
  cs.forEach((c) => c.close());
});

test('after the game ends, every action is refused politely and the server stays up', async () => {
  const code = await createRoom(server.port);
  const cs: Client[] = [];
  for (const n of ['A', 'B', 'C', 'D', 'E']) cs.push(await join(server.port, code, n));
  cs.forEach((c) => attachBrain(c, () => cs));
  await seat(cs);
  cs[0].send({ t: 'start' });
  await waitUntil(() => cs.every((c) => c.view?.phase === 'ended'), 'the game to end', 90_000);
  const before = cs[0].errors().length;
  cs[0].send({ t: 'nominate', nomineeId: cs[1].id });
  cs[0].send({ t: 'vote', yes: true });
  cs[0].send({ t: 'nightReal', targetIds: [] });
  cs[0].send({ t: 'slayer', targetId: cs[1].id });
  cs[0].send({ t: 'endDay' });
  await waitUntil(() => cs[0].errors().length >= before + 5, 'five refusals');
  assert.ok(cs[0].errors().slice(before).every((e) => !/Internal error/.test(e)));
  assert.equal(cs[0].view!.phase, 'ended');
  cs.forEach((c) => c.close());
});

// ---------------------------------------------------------------- abuse and isolation

test('one connection is one player: a second join on the same connection is refused', async () => {
  const code = await createRoom(server.port);
  const c = await join(server.port, code, 'Ana');
  c.send({ t: 'join', code, name: 'Ana2' });
  await c.waitForError('Already joined');
  const other = await join(server.port, code, 'Bo');
  await waitUntil(() => other.view!.players.length === 2, 'still just two players');
  c.close(); other.close();
});

test('hostile room codes and names never crash anything', async () => {
  const code = await createRoom(server.port);
  for (const bad of ['__proto__', 'constructor', 'toString', '', 'x'.repeat(4000), 'a b c', '\u0000\u0001', '../../etc', '{"a":1}']) {
    const c = await Client.open(server.port);
    c.send({ t: 'join', code: bad, name: 'Ana' });
    await c.waitForError('Room not found');
    c.close();
  }
  for (const name of ['__proto__', 'constructor', '<script>x</script>', '😀', '  ', 'a'.repeat(5000)]) {
    const c = await join(server.port, code, name).catch(() => null);
    c?.close();
  }
  assert.equal((await request(server.port, 'GET', '/')).status, 200);
});

test('two games run at the same time without touching each other, and a token only works in its own room', async () => {
  const codeA = await createRoom(server.port);
  const codeB = await createRoom(server.port);
  const a: Client[] = [];
  const b: Client[] = [];
  for (const n of ['A1', 'A2', 'A3', 'A4', 'A5']) a.push(await join(server.port, codeA, n));
  for (const n of ['B1', 'B2', 'B3', 'B4', 'B5']) b.push(await join(server.port, codeB, n));
  // A token from room A is worthless in room B.
  const intruder = await Client.open(server.port);
  intruder.send({ t: 'auth', code: codeB, token: a[0].token });
  await intruder.waitForError('Invalid session');
  intruder.close();
  [...a, ...b].forEach((c) => attachBrain(c, () => a));
  await seat(a);
  await seat(b);
  a[0].send({ t: 'start' });
  b[0].send({ t: 'start' });
  await waitUntil(() => [...a, ...b].every((c) => c.view?.phase === 'ended'), 'both games to end', 90_000);
  for (const c of a) assert.ok(c.view!.players.every((p: Msg) => p.name.startsWith('A')), 'room A only ever sees its own players');
  for (const c of b) assert.ok(c.view!.players.every((p: Msg) => p.name.startsWith('B')), 'room B only ever sees its own players');
  [...a, ...b].forEach((c) => c.close());
});

test('a chaos client firing illegal moves, junk and unjoined actions all game long cannot disturb a game', async () => {
  const code = await createRoom(server.port);
  const cs: Client[] = [];
  for (const n of ['A', 'B', 'C', 'D', 'E']) cs.push(await join(server.port, code, n));
  cs.forEach((c) => attachBrain(c, () => cs));
  // Someone connected but not in the game, throwing everything at the server.
  const chaos = await Client.open(server.port, 'chaos');
  const types = ['nominate', 'vote', 'nightReal', 'slayer', 'endDay', 'skipSpeech', 'readySpeech', 'declareNeighbor', 'start', 'leave', 'join', 'auth', 'x'];
  let n = 0;
  const timer = setInterval(() => {
    if (chaos.closed) return;
    const t = types[n++ % types.length];
    chaos.send(n % 3 === 0 ? 'garbage' + n : { t, code, nomineeId: cs[0].id, targetId: cs[1].id, targetIds: [cs[2].id], yes: true, token: 'nope', name: 'x' });
  }, 5);
  try {
    await seat(cs);
    cs[0].send({ t: 'start' });
    await waitUntil(() => cs.every((c) => c.view?.phase === 'ended'), 'the game to end', 90_000);
  } finally {
    clearInterval(timer);
  }
  assert.ok(chaos.errors().length > 20, 'the chaos client was refused over and over');
  assert.ok(cs.every((c) => c.errors().every((e) => !/Internal error/.test(e))));
  cs.forEach((c) => c.close());
  chaos.close();
});

test('a storm of connections opening, spamming and dropping does not hurt the server', async () => {
  const code = await createRoom(server.port);
  const sockets = await Promise.all(Array.from({ length: 60 }, () => Client.open(server.port)));
  sockets.forEach((c, i) => {
    c.send({ t: 'join', code, name: `Storm${i}` });
    c.send('junk');
    c.send({ t: 'nominate' });
    if (i % 2) c.ws.terminate();
  });
  await sleep(300);
  sockets.forEach((c) => c.ws.terminate());
  await sleep(100);
  assert.equal((await request(server.port, 'GET', '/')).status, 200);
  const fresh = await join(server.port, await createRoom(server.port), 'Fresh');
  assert.ok(fresh.view);
  fresh.close();
});

test('an idle room is not spammed: phones only get a new view when something actually changed for them', async () => {
  const code = await createRoom(server.port);
  const ana = await join(server.port, code, 'Ana');
  const bo = await join(server.port, code, 'Bo');
  await sleep(300);
  const before = ana.msgs.filter((m) => m.t === 'view').length;
  await sleep(2600); // several server ticks with nothing happening
  const after = ana.msgs.filter((m) => m.t === 'view').length;
  assert.equal(after, before, `Ana received ${after - before} identical views while idle`);
  bo.send({ t: 'declareNeighbor', neighborId: ana.id });
  await waitUntil(() => ana.msgs.filter((m) => m.t === 'view').length > after, 'a real change is still delivered');
  ana.close(); bo.close();
});

test('the server never logged an unexpected error during all of the above', () => {
  const noisy = server.output().split('\n').filter((l) => /Error|TypeError|Unhandled|at .*\(/.test(l));
  assert.deepEqual(noisy, [], 'the server printed errors:\n' + noisy.join('\n'));
});
