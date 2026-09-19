import type { Msg } from './types.js';

/**
 * A game-narration descriptor: a key the client turns into a sentence, plus its variables. Every
 * module that produces narration builds it here so the {key, vars} shape stays in one place.
 */
export function msg(key: string, vars?: Record<string, string | number | string[]>): Msg {
  return vars ? { key, vars } : { key };
}
