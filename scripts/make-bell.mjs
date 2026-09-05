#!/usr/bin/env node
/**
 * Synthesises public/bell.wav — a clocktower bell, for players to set as the
 * notification sound of their ntfy subscription.
 *
 * The point is recognisability: a bell is instantly distinguishable from every
 * stock Android notification blip, so nobody mistakes "it is your turn" for a
 * WhatsApp message. Android accepts .wav for notification sounds.
 *
 *   node scripts/make-bell.mjs
 */

import fs from 'node:fs';

const RATE = 44100;
const SECONDS = 3.4;
const frames = Math.floor(RATE * SECONDS);

/**
 * A real bell is inharmonic. These ratios are the classic strike partials —
 * hum, prime, tierce, quint, nominal and two upper partials. The minor-third
 * tierce at 1.2 is what makes a bell sound like a bell rather than a chime.
 */
const FUNDAMENTAL = 262; // C4-ish: deep enough to read as a tower bell
const PARTIALS = [
  { ratio: 0.5, gain: 1.0, decay: 1.2 }, // hum — the long tail
  { ratio: 1.0, gain: 0.9, decay: 1.6 }, // prime
  { ratio: 1.2, gain: 0.7, decay: 2.2 }, // tierce (minor third)
  { ratio: 1.5, gain: 0.5, decay: 2.8 }, // quint
  { ratio: 2.0, gain: 0.6, decay: 3.2 }, // nominal
  { ratio: 2.5, gain: 0.28, decay: 5.0 },
  { ratio: 3.0, gain: 0.2, decay: 6.5 },
  { ratio: 4.2, gain: 0.12, decay: 9.0 },
];

/** Two strikes, like a clock marking the hour. */
const STRIKES = [0, 1.15];

const samples = new Float32Array(frames);

for (const strikeAt of STRIKES) {
  const start = Math.floor(strikeAt * RATE);
  for (let i = start; i < frames; i++) {
    const t = (i - start) / RATE;
    let v = 0;
    for (const p of PARTIALS) {
      // Slight detune per partial keeps it from sounding synthetic.
      const f = FUNDAMENTAL * p.ratio * (1 + 0.0008 * p.ratio);
      v += p.gain * Math.exp(-t * p.decay) * Math.sin(2 * Math.PI * f * t);
    }
    // Strike transient: a short burst of noise-like attack on the leading edge.
    if (t < 0.012) v += (Math.random() * 2 - 1) * 0.35 * (1 - t / 0.012);
    // Fade the second strike slightly so it reads as a decaying pair.
    samples[i] += v * (strikeAt === 0 ? 1 : 0.78);
  }
}

// Normalise with headroom, then a short fade-out so it never clicks.
let peak = 0;
for (const s of samples) peak = Math.max(peak, Math.abs(s));
const scale = peak > 0 ? 0.89 / peak : 1;
const fade = Math.floor(0.08 * RATE);

const buf = Buffer.alloc(44 + frames * 2);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + frames * 2, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); // PCM chunk size
buf.writeUInt16LE(1, 20); // PCM
buf.writeUInt16LE(1, 22); // mono
buf.writeUInt32LE(RATE, 24);
buf.writeUInt32LE(RATE * 2, 28); // byte rate
buf.writeUInt16LE(2, 32); // block align
buf.writeUInt16LE(16, 34); // bits
buf.write('data', 36);
buf.writeUInt32LE(frames * 2, 40);

for (let i = 0; i < frames; i++) {
  let v = samples[i] * scale;
  if (i > frames - fade) v *= (frames - i) / fade;
  const clamped = Math.max(-1, Math.min(1, v));
  buf.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
}

fs.writeFileSync('public/bell.wav', buf);
console.log(
  `wrote public/bell.wav — ${(buf.length / 1024).toFixed(0)} KB, ${SECONDS}s, ${RATE} Hz mono`,
);
