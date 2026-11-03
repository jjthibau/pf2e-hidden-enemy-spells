import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ID = 'pf2e-hidden-enemy-spells';
const source = fs.readFileSync(new URL('../scripts/main.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
class Element {
  constructor(kind = '', id) {
    this.kind = kind; this.dataset = id ? {messageId: id} : {}; this.isConnected = true;
    this.children = []; this.children.item = i => this.children[i]; this.parentElement = null;
  }
  add(child) { this.children.push(child); child.parentElement = this; return child; }
  matches(selector) {
    return (selector === '.message[data-message-id]' && this.kind === 'message') ||
      (selector === 'button[data-action="spell-save"]' && this.kind === 'save');
  }
  contains(node) { for (let p = node; p; p = p.parentElement) if (p === this) return true; return false; }
  querySelector(selector) {
    for (const child of this.children) {
      if ((selector === '.chat-log' && child.kind === 'log') || child.matches(selector)) return child;
      const found = child.querySelector(selector); if (found) return found;
    }
    return null;
  }
}
function fixture() {
  const hooks = new Map(), messages = new Map(), instances = new Map(), frames = [], errors = [];
  let showDC = true, scans = 0;
  const calls = {update: 0, render: 0, writes: 0};
  class Popout { render() { calls.render++; } }
  const host = () => ({rendered: true, element: new Element('host'), updateMessage() { calls.update++; }});
  const chat = host(); const log = chat.element.add(new Element('log'));
  const sandbox = {
    console: {error: (...args) => errors.push(args)}, HTMLElement: Element, Map, NodeFilter: {SHOW_ELEMENT: 1},
    requestAnimationFrame: fn => frames.push(fn),
    Hooks: {once() {}, on(name, fn) { const handlers = hooks.get(name) ?? []; handlers.push(fn); hooks.set(name, handlers); }},
    game: {ready: true, user: {id: 'pc', isGM: false}, socket: {connected: true}, messages,
      settings: {get: () => showDC}, i18n: {localize: key => key}},
    ui: {chat}, foundry: {applications: {instances}}, CONFIG: {ChatMessage: {popoutClass: Popout}, PF2E: {saves: {will: 'Will'}}},
    document: {createTreeWalker(root) {
      const iterator = (function* walk(parent) { for (const child of parent.children) { yield child; yield* walk(child); } })(root);
      return {nextNode() { scans++; return iterator.next().value ?? null; }};
    }}
  };
  vm.runInNewContext(source, sandbox);
  function card(id, {role = 'public', revealed = false, followup = false, mount = log, padding = 0} = {}) {
    const message = {id, apps: {}, visible: true, isContentVisible: true,
      getFlag: () => ({role, revealed, followup}), update() { calls.writes++; }};
    messages.set(id, message);
    const root = new Element('message', id);
    for (let i = 0; i < padding; i++) root.add(new Element());
    const button = root.add(new Element('save')); button.dataset = {save: 'will', dc: '31'};
    button.textContent = 'DC 31 Roll Will Save'; button.listener = () => 'native-handler';
    if (mount) mount.add(root);
    return {message, root, button};
  }
  function popout(c) {
    const app = new Popout(); app.id = 'window' + instances.size; app.message = c.message;
    app.rendered = true; app.element = new Element('app'); app.element.add(c.root);
    app.position = {left: 10, top: 20}; app.minimized = true;
    instances.set(app.id, app); c.message.apps[app.id] = app; return app;
  }
  const fire = (event = 'updateSetting', key = 'pf2e.metagame_showDC') => {
    for (const fn of hooks.get(event) ?? []) fn({key});
  };
  async function frame() { const fn = frames.shift(); assert.ok(fn, 'scheduled continuation'); fn(); await Promise.resolve(); }
  async function drain() { let budget = 1000; while (frames.length && --budget) await frame(); assert.ok(budget, 'finite work'); }
  return {sandbox, messages, instances, chat, log, calls, errors, frames, card, popout, host, fire, frame, drain,
    setDC: value => showDC = value, scans: () => scans};
}

for (const event of ['createSetting', 'updateSetting', 'deleteSetting']) test(`${event} refreshes exact mounted labels without native rerender or writes`, async () => {
  const f = fixture(), c = f.card('root'), old = f.card('unmounted', {mount: null}), p = f.card('private', {role: 'gm'});
  const handler = c.button.listener, data = {...c.button.dataset}; f.setDC(false); f.fire(event); await f.drain();
  assert.equal(c.button.textContent, 'Roll Will Save'); assert.equal(old.button.textContent, 'DC 31 Roll Will Save');
  assert.equal(p.button.textContent, 'DC 31 Roll Will Save'); assert.equal(c.button.listener, handler);
  assert.deepEqual(c.button.dataset, data); assert.deepEqual(f.calls, {update: 0, render: 0, writes: 0}); assert.equal(f.errors.length, 0);
  f.setDC(true); f.fire(event); await f.drain(); assert.equal(c.button.textContent, 'DC 31 Roll Will Save');
});

test('separate sidebar host can have asymmetric history without posting into either host', async () => {
  const f = fixture(); f.chat.popout = f.host(); const log = f.chat.popout.element.add(new Element('log'));
  const a = f.card('main'), b = f.card('sidebar', {mount: log});
  f.setDC(false); f.fire(); await f.drain(); assert.equal(a.button.textContent, 'Roll Will Save');
  assert.equal(b.button.textContent, 'Roll Will Save'); assert.equal(f.calls.update, 0);
});

test('owned registered single-message popout labels change without render/focus/minimized changes', async () => {
  const f = fixture(), c = f.card('window', {mount: null}), app = f.popout(c), position = app.position;
  f.setDC(false); f.fire(); await f.drain(); assert.equal(c.button.textContent, 'Roll Will Save');
  assert.equal(app.position, position); assert.equal(app.minimized, true); assert.equal(f.calls.render, 0);
});

test('forged, closed, disconnected, unregistered and message-unowned popouts refuse', async () => {
  for (const corrupt of [(f,a) => f.instances.set(a.id, {...a}), (f,a) => a.rendered = false,
    (f,a) => a.element.isConnected = false, (f,a) => f.instances.delete(a.id),
    (_f,a) => delete a.message.apps[a.id], (_f,a) => a.message = {...a.message}]) {
    const f = fixture(), c = f.card('window', {mount: null}), a = f.popout(c); corrupt(f,a);
    f.setDC(false); f.fire(); await f.drain(); assert.equal(c.button.textContent, 'DC 31 Roll Will Save');
  }
});

test('fresh visibility, content, identity and root ownership are required', async () => {
  for (const corrupt of [(f,c) => c.message.visible = false, (f,c) => c.message.isContentVisible = false,
    (f,c) => f.messages.set(c.message.id, {...c.message}), (f,c) => c.root.isConnected = false,
    (f,c) => c.root.parentElement = new Element(), (f) => f.chat.rendered = false]) {
    const f = fixture(), c = f.card('root', {padding: 70}); f.setDC(false); f.fire(); await f.frame(); corrupt(f,c); await f.drain();
    assert.equal(c.button.textContent, 'DC 31 Roll Will Save');
  }
});

test('bursts coalesce, unrelated settings enumerate nothing, GM and revealed followup policy stays native', async () => {
  const f = fixture(), c = f.card('root'), followup = f.card('followup', {revealed: true, followup: true}), revealed = f.card('revealed', {revealed: true});
  f.fire('updateSetting', 'other.setting'); assert.equal(f.frames.length, 0); assert.equal(f.scans(), 0);
  f.setDC(false); f.fire('createSetting'); f.fire('updateSetting'); f.fire('deleteSetting');
  assert.equal(f.frames.length, 1); await f.drain(); assert.equal(c.button.textContent, 'Roll Will Save');
  assert.equal(followup.button.textContent, 'Roll Will Save'); assert.equal(revealed.button.textContent, 'DC 31 Roll Will Save');
  f.sandbox.game.user.isGM = true; f.fire(); await f.drain(); assert.equal(c.button.textContent, 'DC 31 Roll Will Save');
});

test('large cards continue with bounded per-frame traversal and fresh permission checks', async () => {
  const f = fixture(), c = f.card('long', {padding: 100}); f.setDC(false); f.fire(); await f.frame();
  assert.ok(f.scans() <= 32); assert.equal(c.button.textContent, 'DC 31 Roll Will Save');
  c.message.isContentVisible = false; await f.drain(); assert.equal(c.button.textContent, 'DC 31 Roll Will Save');
  c.message.isContentVisible = true; f.fire(); await f.drain(); assert.equal(c.button.textContent, 'Roll Will Save');
});

test('session/disconnect and replacement generation cancel remaining work; explicit later change works', async () => {
  for (const drift of [f => f.sandbox.game.socket.connected = false, f => f.sandbox.game.user = {id: 'other'}]) {
    const f = fixture(), c = f.card('long', {padding: 70}); f.setDC(false); f.fire(); await f.frame(); drift(f); await f.drain();
    assert.equal(c.button.textContent, 'DC 31 Roll Will Save');
  }
  const f = fixture(), c = f.card('long', {padding: 70}); f.setDC(false); f.fire(); await f.frame();
  f.setDC(true); f.fire(); await f.drain(); assert.equal(c.button.textContent, 'DC 31 Roll Will Save');
  f.setDC(false); f.fire(); await f.drain(); assert.equal(c.button.textContent, 'Roll Will Save');
});

test('no source/history iteration, app render, updateMessage or document mutation is used', async () => {
  const f = fixture(), c = f.card('root');
  f.messages[Symbol.iterator] = () => { throw Error('history scan'); };
  Object.defineProperty(f.messages, 'contents', {get() { throw Error('history snapshot'); }});
  f.chat.updateMessage = () => { throw Error('native posting'); };
  f.setDC(false); f.fire(); await f.drain(); assert.equal(c.button.textContent, 'Roll Will Save'); assert.equal(f.errors.length, 0);
});
