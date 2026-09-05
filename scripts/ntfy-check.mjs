#!/usr/bin/env node
/**
 * Verifies the ntfy chain end to end: join a room, read the server-assigned
 * secret topic, fire a test buzz, and read the message back off the ntfy
 * server. Run with the server already listening.
 *
 *   node scripts/ntfy-check.mjs [--url http://localhost:8080]
 */

import { WebSocket } from 'ws';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith('--') ? [[a.slice(2), arr[i + 1]]] : [],
  ),
);
const BASE = args.url || 'http://localhost:8080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for the server to accept connections, so a fresh restart isn't a race. */
async function waitForServer(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${BASE}/api/config`);
      if (res.ok) return res.json();
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  console.error(`✖ ${BASE} never came up`);
  process.exit(1);
}

const config = await waitForServer();
console.log(`ntfy server : ${config.ntfyBase}  (host ${config.ntfyHost})`);

const { code } = await (await fetch(`${BASE}/api/rooms`, { method: 'POST' })).json();
const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');

let view = null;
let testResult = null;
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.t === 'view') view = m.view;
  if (m.t === 'testBuzzResult') testResult = m;
});
ws.on('error', (err) => {
  console.error(`✖ websocket failed: ${err.message}`);
  process.exit(1);
});
await new Promise((r) => ws.on('open', r));

ws.send(JSON.stringify({ t: 'join', code, name: 'Robin' }));
await sleep(400);

const topic = view?.self?.ntfyTopic;
if (!topic) {
  console.error('✖ server did not assign an ntfy topic on join');
  process.exit(1);
}
console.log(`assigned    : ${topic}`);
console.log(`deep link   : ntfy://${config.ntfyHost}/${topic}?display=Clocktower`);
console.log(`web fallback: ${config.ntfyBase}/${topic}`);

const since = Math.floor(Date.now() / 1000) - 5;
ws.send(JSON.stringify({ t: 'testBuzz' }));
await sleep(2500);

console.log(`server says : delivered=${testResult?.delivered}`);

// Read the message back off ntfy to prove it really landed.
const res = await fetch(`${config.ntfyBase}/${topic}/json?poll=1&since=${since}`);
const text = await res.text();
const messages = text
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((m) => m.event === 'message');

if (messages.length === 0) {
  console.error('✖ nothing arrived on the ntfy topic');
  ws.close();
  process.exit(1);
}

const m = messages[messages.length - 1];
console.log(`received    : title="${m.title}" priority=${m.priority} body="${m.message}"`);

let bad = 0;
if (m.priority !== 5) {
  console.error(`✖ expected max priority (5) so the phone rings, got ${m.priority}`);
  bad++;
}
if (!m.title?.includes('Clocktower')) {
  console.error('✖ title did not survive the header round-trip');
  bad++;
}

ws.close();
if (bad === 0) {
  console.log('\n✅ ntfy delivery confirmed end to end');
  process.exit(0);
}
process.exit(1);
