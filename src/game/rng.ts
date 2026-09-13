/** Mulberry32 PRNG — small, fast, deterministic from a numeric seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic float in [0,1) for a given (secret, ...parts) — same inputs always give the same output. */
export function stableFloat(secret: string, ...parts: (string | number)[]): number {
  const key = secret + '|' + parts.join('|');
  const seed = seedFromString(key);
  return mulberry32(seed)();
}

export function stablePick<T>(secret: string, items: T[], ...parts: (string | number)[]): T {
  const f = stableFloat(secret, ...parts);
  return items[Math.floor(f * items.length) % items.length];
}

export function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function shuffleWithSeed<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
