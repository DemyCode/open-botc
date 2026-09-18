// A tiny fake browser, just enough to run the real public/app.js inside Node: elements that
// remember their children/listeners, storage, a WebSocket that records what the app sends, and
// fetch for the character list. Lets tests render real game views and click every button.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { allCharactersSummary } from '../game/characters.js';

type Listener = (e: unknown) => void;

export class FakeText {
  parent: FakeNode | null = null;
  constructor(public text: string) {}
}

export class FakeNode {
  parent: FakeNode | null = null;
  children: (FakeNode | FakeText)[] = [];
  attrs: Record<string, string> = {};
  listeners: Record<string, Listener[]> = {};
  style: Record<string, string> = {};
  className = '';
  private classes = new Set<string>();
  disabled = false;
  value = '';
  constructor(public tag: string) {}

  get classList() {
    const self = this;
    return {
      add: (...c: string[]) => c.forEach((x) => self.classes.add(x)),
      remove: (...c: string[]) => c.forEach((x) => self.classes.delete(x)),
      toggle: (c: string, force?: boolean) => {
        const on = force ?? !self.classes.has(c);
        if (on) self.classes.add(c); else self.classes.delete(c);
        return on;
      },
      contains: (c: string) => self.classes.has(c),
    };
  }
  /** Every class, from className and from classList. */
  allClasses(): string[] {
    return [...new Set([...this.className.split(/\s+/).filter(Boolean), ...this.classes])];
  }
  hasClass(c: string): boolean { return this.allClasses().includes(c); }

  private adopt<T extends FakeNode | FakeText>(c: T): T {
    if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c);
    c.parent = this;
    return c;
  }
  appendChild<T extends FakeNode | FakeText>(c: T): T { this.children.push(this.adopt(c)); return c; }
  append(...cs: (FakeNode | FakeText | string)[]): void {
    for (const c of cs) this.appendChild(typeof c === 'string' ? new FakeText(c) : c);
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
    this.parent = null;
  }
  setAttribute(k: string, v: unknown): void {
    this.attrs[k] = String(v);
    if (k === 'class') this.className = String(v);
    if (k === 'disabled') this.disabled = true;
  }
  getAttribute(k: string): string | null { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(type: string, fn: Listener): void { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(): void {}
  focus(): void {}
  set innerHTML(v: string) { this.children.forEach((c) => (c.parent = null)); this.children = []; this.rawHtml = v; }
  get innerHTML(): string { return this.rawHtml; }
  rawHtml = '';
  set textContent(v: string) { this.innerHTML = ''; this.appendChild(new FakeText(String(v))); }
  get textContent(): string { return this.text(); }
  get childNodes(): (FakeNode | FakeText)[] { return this.children; }
  querySelectorAll(): FakeNode[] { return []; }
  querySelector(): FakeNode | null { return null; }

  /** All visible text under this node, in order. */
  text(): string {
    return this.children.map((c) => (c instanceof FakeText ? c.text : c.text())).join('');
  }
  /** Every element under (and including) this one that matches. */
  find(pred: (n: FakeNode) => boolean): FakeNode[] {
    const out: FakeNode[] = [];
    const walk = (n: FakeNode) => {
      if (pred(n)) out.push(n);
      n.children.forEach((c) => c instanceof FakeNode && walk(c));
    };
    walk(this);
    return out;
  }
  buttons(): FakeNode[] { return this.find((n) => n.tag === 'button'); }
  /** A tap: this element's click handlers, then each parent's (bubbling) unless one stops it. */
  click(): void {
    const e = { target: this as FakeNode, currentTarget: this as FakeNode, stopped: false, key: 'Enter', preventDefault() {}, stopPropagation() { e.stopped = true; } };
    for (let n: FakeNode | null = this; n && !e.stopped; n = n.parent) {
      e.currentTarget = n;
      for (const fn of n.listeners.click ?? []) fn(e);
    }
  }
}

export interface FakeClient {
  ctx: vm.Context;
  root: FakeNode;
  body: FakeNode;
  /** Every JSON message the app sent over its WebSocket. */
  sent: Record<string, unknown>[];
  vibrations: number[][];
  confirms: string[];
  errors: string[];
  /** Every note the app started: its frequency and wave. */
  tones: { freq: number; wave: string }[];
  /** How many times the (fake) audio context was woken up. */
  audioResumed: () => number;
  /** Fires a window-level event (like the first tap that unlocks audio). */
  fireWindow(type: string): void;
  run<T = unknown>(code: string): T;
  /** Shows a view as if the server had just sent it (and this player were signed in). */
  show(view: unknown, opts?: { seen?: boolean; lang?: 'en' | 'fr' }): string;
  text(): string;
}

/** Loads the real app.js into a fresh fake browser. */
export async function loadApp(lang: 'en' | 'fr' = 'en', preset: Record<string, string> = {}, opts: { audio?: boolean } = {}): Promise<FakeClient> {
  const root = new FakeNode('div');
  const body = new FakeNode('body');
  const sent: Record<string, unknown>[] = [];
  const vibrations: number[][] = [];
  const confirms: string[] = [];
  const errors: string[] = [];
  const store = (init: Record<string, string>) => {
    const m = new Map(Object.entries(init));
    return {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
    };
  };
  const tones: { freq: number; wave: string }[] = [];
  let resumed = 0;
  const windowListeners: Record<string, (() => void)[]> = {};
  class FakeAudioContext {
    state = 'suspended';
    currentTime = 0;
    destination = {};
    resume(): Promise<void> { this.state = 'running'; resumed++; return Promise.resolve(); }
    createOscillator() {
      const o = {
        type: 'sine',
        frequency: { value: 0 },
        connect() {},
        start() { tones.push({ freq: o.frequency.value, wave: o.type }); },
        stop() {},
      };
      return o;
    }
    createGain() {
      return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
  }
  class FakeWebSocket {
    static OPEN = 1;
    readyState = 1;
    addEventListener(): void {}
    send(data: string): void { sent.push(JSON.parse(data)); }
    close(): void {}
  }
  const document = {
    body,
    createElement: (tag: string) => new FakeNode(tag),
    createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
    createTextNode: (t: string) => new FakeText(t),
    getElementById: () => root,
    // Only what the app uses: a single class selector like ".term-overlay".
    querySelectorAll: (sel: string) => {
      const cls = sel.startsWith('.') ? sel.slice(1) : null;
      return cls ? [...body.find((n) => n.hasClass(cls)), ...root.find((n) => n.hasClass(cls))] : [];
    },
  };
  const sandbox = {
    document, window: { addEventListener: (type: string, fn: () => void) => { (windowListeners[type] ??= []).push(fn); } },
    ...(opts.audio === false ? {} : { AudioContext: FakeAudioContext }), sessionStorage: store({ 'botc.lang': lang, ...preset }), localStorage: store({}),
    navigator: { language: lang, vibrate: (p: number[]) => { vibrations.push(Array.from(p)); return true; } },
    location: { protocol: 'http:', host: 'test' },
    WebSocket: FakeWebSocket,
    fetch: async () => ({ ok: true, json: async () => allCharactersSummary() }),
    confirm: (m: string) => { confirms.push(m); return true; },
    setTimeout: () => 0, setInterval: () => 0, clearTimeout: () => {}, clearInterval: () => {},
    console: { log() {}, warn() {}, error: (...a: unknown[]) => errors.push(a.join(' ')) },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.resolve('public/glossary.js'), 'utf8'), ctx, { filename: 'glossary.js' });
  vm.runInContext(fs.readFileSync(path.resolve('public/tips.js'), 'utf8'), ctx, { filename: 'tips.js' });
  vm.runInContext(fs.readFileSync(path.resolve('public/app.js'), 'utf8'), ctx, { filename: 'app.js' });
  await new Promise((r) => setImmediate(r)); // let loadCharacters() finish
  const client: FakeClient = {
    ctx, root, body, sent, vibrations, confirms, errors, tones,
    audioResumed: () => resumed,
    fireWindow: (type: string) => (windowListeners[type] ?? []).forEach((fn) => fn()),
    run: <T>(code: string) => vm.runInContext(code, ctx) as T,
    text: () => root.text(),
    show(view, opts = {}) {
      if (opts.lang) vm.runInContext(`setLang(${JSON.stringify(opts.lang)})`, ctx);
      const v = view as { selfId: string; day: number; night: number };
      vm.runInContext(
        `state.code = 'ROOM'; state.token = 'tok'; state.playerId = ${JSON.stringify(v.selfId)}; state.view = ${JSON.stringify(view)};
         state.ws = { readyState: 1, send: (d) => __send(d) };
         state.dawnSeenForDay = ${opts.seen ? v.day : 'null'}; state.duskSeenForNight = ${opts.seen ? v.night : 'null'};
         state.nightResultSeenForNight = ${opts.seen ? v.night : 'null'}; state.roleHidden = false; render();`,
        ctx,
      );
      return root.text();
    },
  };
  (sandbox as Record<string, unknown>).__send = (d: string) => { sent.push(JSON.parse(d)); };
  return client;
}

/** Text that means a screen was filled in wrongly. */
export function brokenText(text: string): string | null {
  for (const bad of ['undefined', '[object', 'NaN', '${', 'null']) if (text.includes(bad)) return `contains "${bad}"`;
  return text.trim() ? null : 'the screen is empty';
}
