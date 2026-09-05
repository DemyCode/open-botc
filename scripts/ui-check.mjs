#!/usr/bin/env node
/**
 * Renders the real client in headless Chromium and walks a whole game,
 * screenshotting each phase and failing on any console error.
 *
 *   node scripts/ui-check.mjs [--url http://localhost:8080] [--out ./shots]
 *
 * Talks to Chromium over the DevTools protocol directly, so there is no
 * puppeteer/playwright dependency.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith('--') ? [[a.slice(2), arr[i + 1]]] : [],
  ),
);
const OUT = args.out || path.resolve('shots');
const CHROME =
  args.chrome ||
  process.env.CHROME_BIN ||
  '/nix/store/b3zmxxdfbv1q13fy1vkgxaszmnkwkf0z-chromium-151.0.7922.137/bin/chromium';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------- server
//
// Start a private server unless one was named with --url. Notifications are
// switched off: this walkthrough marks every bot as "buzz confirmed" to
// screenshot the ready state, which would otherwise fire a burst of real
// pushes at a public ntfy server on every phase change.

let ownServer = null;
let serverDir = null;
let BASE = args.url;

if (!BASE) {
  const port = 8300 + Math.floor(Math.random() * 400);
  BASE = `http://127.0.0.1:${port}`;
  serverDir = fs.mkdtempSync('/tmp/botc-uidata-');
  ownServer = spawn(process.execPath, ['dist/index.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      BOTC_NTFY_URL: 'off',
      BOTC_DATA_DIR: serverDir,
    },
    stdio: 'ignore',
  });
}

let stopped = false;
function stopServer() {
  if (stopped) return;
  stopped = true;
  ownServer?.kill();
  if (serverDir) {
    try {
      fs.rmSync(serverDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* the OS will reap /tmp */
    }
  }
}

// Never orphan the server or the browser, however this script ends.
process.on('exit', () => {
  stopServer();
  globalThis.__botcChrome?.kill();
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => process.exit(1));
}
process.on('uncaughtException', (err) => {
  console.error(err);
  process.exit(1);
});

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/config`)).ok) return;
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  console.error(`✖ ${BASE} never came up`);
  stopServer();
  process.exit(1);
}
await waitForServer();

// ------------------------------------------------------------ chrome driver

const PORT = 9500 + Math.floor(Math.random() * 400);
const profile = fs.mkdtempSync('/tmp/botc-ui-');
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--window-size=414,896',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
globalThis.__botcChrome = chrome;

async function devtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('Chromium did not expose a devtools endpoint');
}

class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.pageErrors = [];

    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.pageErrors.push(d.exception?.description || d.text);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
    }
    return r.result.value;
  }

  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  }
}

// -------------------------------------------------------------- bot players

class Bot {
  constructor(name) {
    this.name = name;
    this.view = null;
  }
  async connect(code) {
    this.ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
    await new Promise((r) => this.ws.on('open', r));
    this.ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.t === 'view') this.view = m.view;
    });
    this.send({ t: 'join', code, name: this.name });
    await sleep(150);
  }
  send(m) {
    this.ws.send(JSON.stringify(m));
  }
  close() {
    this.ws?.close();
  }
}

// -------------------------------------------------------------------- drive

let failures = 0;
const seen = new Set();
function note(msg) {
  console.log(`  ${msg}`);
}
function fail(msg) {
  failures++;
  console.error(`  ✖ ${msg}`);
}

const wsUrl = await devtools();
const page = new Page(new WebSocket(wsUrl));
await new Promise((r) => page.ws.on('open', r));
await page.send('Page.enable');
await page.send('Runtime.enable');
await page.send('Emulation.setDeviceMetricsOverride', {
  width: 414,
  height: 896,
  deviceScaleFactor: 2,
  mobile: true,
});

const { code } = await (await fetch(`${BASE}/api/rooms`, { method: 'POST' })).json();
console.log(`\nroom ${code}\n`);

// The human player is the browser; everyone else is a bot.
const bots = [];
for (let i = 0; i < 7; i++) {
  const b = new Bot(`Bot${i + 1}`);
  await b.connect(code);
  bots.push(b);
}

await page.send('Page.navigate', { url: `${BASE}/#${code}` });
await sleep(1200);

async function capture(name) {
  if (seen.has(name)) return;
  seen.add(name);
  await page.shot(name);
  note(`📸 ${name}`);
}

async function uiPhase() {
  return page.evaluate('document.body.dataset.phase || "home"');
}

async function click(selectorText) {
  return page.evaluate(`(() => {
    const els = [...document.querySelectorAll('button,a.btn')];
    const el = els.find(e => e.textContent.trim().toLowerCase().includes(${JSON.stringify(
      selectorText.toLowerCase(),
    )}));
    if (!el) return false;
    el.click();
    return true;
  })()`);
}

async function clickAttr(attr) {
  return page.evaluate(`(() => {
    const el = document.querySelector('[data-act="${attr}"]:not([disabled])');
    if (!el) return false; el.click(); return true;
  })()`);
}

// ---- home
await capture('01-home');
await page.evaluate(`document.getElementById('name').value = 'Robin'`);
await clickAttr('join');
await sleep(900);

if ((await uiPhase()) !== 'lobby') fail(`expected lobby, got ${await uiPhase()}`);
await capture('02-lobby');

// ---- the whole notification set-up flow, card by card
await page.evaluate(`document.querySelector('details')?.setAttribute('open','')`);
await sleep(200);
await capture('03a-notify-subscribe');
await page.evaluate(`document.querySelector('details')?.removeAttribute('open')`);

if (!(await clickAttr('testBuzz'))) fail('no way to send a test buzz');
await sleep(500);
await capture('03b-notify-did-it-buzz');

// Say it did not buzz: the fix-it card must lead with the permission cause.
if (!(await clickAttr('retryBuzz'))) fail('no "No" button on the test prompt');
await sleep(400);
await capture('03c-notify-fix-it');
const fixText = await page.evaluate(`document.querySelector('main')?.innerText || ''`);
if (!/allow(ed)? .*notification/i.test(fixText)) {
  fail('the fix-it card does not mention allowing notifications');
}

// Now say it worked.
await clickAttr('testBuzz');
await sleep(400);
if (!(await clickAttr('confirmBuzz'))) fail('no way to confirm the buzz worked');
await sleep(500);
await capture('03d-notify-confirmed');

// Bots confirm too, so the lobby shows the all-ready state.
for (const b of bots) b.send({ t: 'pushConfirmed', ok: true });
await sleep(400);
await capture('04-lobby-ready');
const lobbyText = await page.evaluate(`document.querySelector('main')?.innerText || ''`);
if (/have not set up phone buzzing/i.test(lobbyText)) {
  fail('lobby still reports players without buzzing after all confirmed');
}

// ---- start
// Long enough that a phase never auto-advances before it is screenshotted,
// short enough that a slow game cannot run past the wall clock below.
const host = bots[0];
host.send({
  t: 'setOptions',
  options: {
    revealSeconds: 25,
    dawnSeconds: 8,
    speechSeconds: 10,
    voteSeconds: 10,
    nightPromptSeconds: 20,
  },
});
await sleep(200);
host.send({ t: 'start' });
await sleep(700);
if ((await uiPhase()) !== 'reveal') fail(`expected reveal, got ${await uiPhase()}`);
await capture('05-reveal');

const myRole = await page.evaluate(`document.querySelector('.role .rname')?.textContent`);
note(`browser player is the ${myRole}`);

await clickAttr('ready');
for (const b of bots) b.send({ t: 'ready' });
await sleep(900);

// ---- walk the game, screenshotting each phase the browser lands in
const deadline = Date.now() + 200_000;
let guard = 0;
while (guard++ < 900) {
  if (Date.now() > deadline) {
    // Distinguish "the server stalled" from "the browser stopped updating".
    const browser = await uiPhase();
    const connected = await page.evaluate(
      `document.querySelector('.topbar .dot')?.classList.contains('off') === false`,
    );
    const v = bots[0].view;
    fail(
      `game did not finish in time — browser shows ${browser} (socket ` +
        `${connected ? 'up' : 'DOWN'}), server says ${v?.phase} ` +
        `night=${v?.night} day=${v?.day} ` +
        `phaseSecondsLeft=${JSON.stringify(v?.phaseSecondsLeft)} ` +
        `winner=${JSON.stringify(v?.winner)} ` +
        `nomination=${v?.nomination ? v.nomination.stage : 'null'} ` +
        `alive=${v?.players.filter((p) => p.alive).length}`,
    );
    console.error('  last log:', JSON.stringify(v?.log.slice(-6).map((l) => l.text)));
    break;
  }
  const phase = await uiPhase();

  if (phase === 'night') {
    const hasPrompt = await page.evaluate(`!!document.querySelector('[data-act="confirmPrompt"]')`);
    if (hasPrompt) {
      await capture('06-night-prompt');
      // Pick enough players, then confirm.
      await page.evaluate(`(() => {
        const n = document.querySelectorAll('.player.selectable');
        const need = document.querySelector('[data-act="confirmPrompt"]').textContent.match(/Choose (\\d+)/);
        const count = need ? Number(need[1]) : 1;
        for (let i = 0; i < count && i < n.length; i++) n[i].click();
      })()`);
      await sleep(250);
      await capture('07-night-picked');
      await clickAttr('confirmPrompt');
      await sleep(300);
    } else {
      await capture('08-night-waiting');
      // Let a bot answer.
      for (const b of bots) {
        if (b.view?.prompt) {
          // Pick at random. Always taking the first choice means the Imp
          // targets the same seat every night, and if that seat happens to be
          // the Soldier nobody ever dies.
          const pool = b.view.prompt.choices.filter((c) => !c.disabled);
          for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
          }
          const t = pool.slice(0, b.view.prompt.count);
          b.send({ t: 'choose', promptId: b.view.prompt.id, targets: t.map((c) => c.playerId) });
          break;
        }
      }
      await sleep(220);
    }
    continue;
  }

  if (phase === 'dawn') {
    await capture('09-dawn');
    await sleep(300);
    continue;
  }

  if (phase === 'day') {
    await capture('10-day');
    if (await clickAttr('openNominations')) await sleep(400);
    else {
      bots.find((b) => b.view?.self?.alive)?.send({ t: 'openNominations' });
      await sleep(400);
    }
    continue;
  }

  if (phase === 'nominations') {
    await capture('11-nominations');
    const canNominate = await page.evaluate(`!!document.querySelector('[data-act="nominate"]')`);
    if (canNominate) {
      await page.evaluate(`document.querySelector('.player.selectable')?.click()`);
      await sleep(250);
      await capture('12-nomination-picked');
      await clickAttr('nominate');
      await sleep(400);
    } else {
      const nom = bots.find((b) => b.view?.self?.canNominate);
      const cand = nom?.view.players.find((x) => x.alive && !x.wasNominated);
      if (nom && cand) nom.send({ t: 'nominate', targetId: cand.id });
      else {
        for (const b of bots.filter((x) => x.view?.self?.alive && !x.view.self.hasRequestedEndDay)) {
          b.send({ t: 'endDay' });
          await sleep(40);
        }
        await clickAttr('endDay');
      }
      await sleep(400);
    }
    continue;
  }

  if (phase === 'speech') {
    await capture('13-speech');
    await clickAttr('endSpeech');
    const n = bots[0].view?.nomination;
    if (n) {
      const speaker = n.stage === 'accuser' ? n.nominatorId : n.nomineeId;
      bots.find((b) => b.view?.youId === speaker)?.send({ t: 'endSpeech' });
    }
    await sleep(400);
    continue;
  }

  if (phase === 'voting') {
    await capture('14-voting');
    await clickAttr('voteYes');
    // Guarantee exactly one execution per day so the game converges. Voting
    // yes on *every* nomination would tie each one at the same count, and a
    // tie correctly executes nobody — that is how the real rules work, and it
    // produces endless quiet games. Exploring varied voting is e2e.mjs's job.
    for (const b of bots) {
      if (b.view?.self?.canVote) {
        b.send({ t: 'vote', vote: b.view.onTheBlock == null });
        await sleep(30);
      }
    }
    await sleep(500);
    await capture('15-vote-result');
    continue;
  }

  if (phase === 'dusk') {
    await capture('16-dusk');
    await sleep(300);
    continue;
  }

  if (phase === 'over') {
    await capture('17-gameover');
    break;
  }

  await sleep(250);
}

// ---- the other tabs
await page.evaluate(`document.querySelector('[data-act="tab"][data-arg="me"]').click()`);
await sleep(400);
await capture('18-you-tab');
await page.evaluate(`document.querySelector('[data-act="tab"][data-arg="log"]').click()`);
await sleep(400);
await capture('19-history-tab');

if ((await uiPhase()) !== 'over') fail(`game never finished in the UI (phase=${await uiPhase()})`);

// ---- console health
const realErrors = page.consoleErrors.filter((e) => !/favicon|manifest|Failed to load resource/i.test(e));
if (realErrors.length) fail(`console errors: ${JSON.stringify(realErrors.slice(0, 4))}`);
if (page.pageErrors.length) fail(`uncaught exceptions: ${JSON.stringify(page.pageErrors.slice(0, 4))}`);

// ---- layout: nothing may scroll sideways on a phone
const overflow = await page.evaluate(
  `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
);
if (overflow > 1) fail(`page scrolls horizontally by ${overflow}px on a 414px screen`);

for (const b of bots) b.close();
page.ws.close();
chrome.kill();
stopServer();
// Chromium may still be flushing its profile; cleanup is best-effort.
await sleep(300);
try {
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch {
  /* the OS will reap /tmp */
}

console.log(`\nscreenshots → ${OUT}`);
if (failures === 0) {
  console.log(`✅ UI check passed (${seen.size} screens)`);
  process.exit(0);
}
console.error(`❌ UI check: ${failures} failure(s)`);
process.exit(1);
