import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {planFor, selectChoice, SAVES} from '../scripts/plans.js';
const ID = 'pf2e-hidden-enemy-spells';
const source = fs.readFileSync(new URL('../scripts/main.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
const plain = x => JSON.parse(JSON.stringify(x));
class Collection extends Map {
  [Symbol.iterator]() { return this.values(); }
  find(fn) { return [...this.values()].find(fn); }
  filter(fn) { return [...this.values()].filter(fn); }
}
// A small DOM port for the browser's inert template parser. It supplies only the
// saved module card datasets used by this source, not spell/DC inference.
function templatePort() {
  let html = '';
  return {set innerHTML(value) { html = value; }, content: {querySelectorAll(selector) {
    assert.equal(selector, '.pf2e-hidden-spell');
    const cards = [...html.matchAll(/<div class="[^"]*\bpf2e-hidden-spell\b[^"]*" data-cast-rank="([^"]*)" data-actor-id="([^"]*)">/g)];
    return cards.map(card => ({dataset: {castRank: card[1], actorId: card[2]}, querySelectorAll(selector) {
      assert.equal(selector, 'button[data-action="spell-save"]');
      return [...html.matchAll(/<button type="button" data-action="spell-save" data-save="([^"]*)" data-dc="([^"]*)">/g)]
        .map(button => ({dataset: {save: button[1], dc: button[2]}}));
    }}));
  }}};
}
function fixture() {
  const gm = {id: 'gm', isGM: true}, pc = {id: 'pc', isGM: false}, other = {id: 'other', isGM: false};
  const users = {activeGM: gm, filter: fn => [gm, pc, other].filter(fn)}, messages = new Collection(), hooks = new Map();
  const calls = {created: [], updates: [], rendered: [], warnings: []}; let next = 0, showDC = false;
  const spell = {name: 'Identified <spell>', rank: 4, traditions: new Set(['arcane']), actor: {id: 'caster'},
    system: {traits: {value: ['mental']}, location: {value: 'entry'}}, spellcasting: {id: 'entry', tradition: 'arcane', statistic: {withRollOptions: () => ({dc: {value: 28}})}}};
  function setPath(doc, path, value) {
    const parts = path.split('.'), leaf = parts.pop(); let at = doc;
    for (const key of parts) at = at[key] ??= {};
    if (leaf.startsWith('-=')) delete at[leaf.slice(2)]; else at[leaf] = plain(value);
  }
  const doc = (data, id = 'message' + ++next) => {
    const d = {...plain(data), id, uuid: 'ChatMessage.' + id, author: gm, allowed: true,
      getFlag: (id, key) => d.flags?.[id]?.[key], canUserModify: () => d.allowed,
      render() {}, async update(update) {
        calls.updates.push({id: d.id, update: plain(update)});
        if (d.failOnce) { d.failOnce = false; throw Error('Synthetic rejected child update'); }
        await d.beforeCommit?.();
        for (const [key, value] of Object.entries(update)) setPath(d, key, value);
        if (d.emit) for (const handler of hooks.get('updateChatMessage') ?? []) handler(d, update, {}, gm.id);
        return d;
      }};
    messages.set(id, d); return d;
  };
  const sandbox = {console, requestAnimationFrame: fn => setImmediate(fn), HTMLElement: class {}, planFor, selectChoice, SAVES, recognitionV1: {apiVersion: 1}, renderRecognition() {},
    setupRecognition() {}, autoRecognize() {}, requestRecognition() {}, automaticObserver() {}, seesCaster() {}, manageRecognitionDC() {},
    Hooks: {once() {}, on: (name, fn) => { const list = hooks.get(name) ?? []; list.push(fn); hooks.set(name, list); }},
    game: {ready: true, user: gm, users, messages, socket: {connected: true}, i18n: {localize: value => value},
      settings: {get: (_id, key) => key === 'metagame_showDC' ? showDC : false}},
    CONFIG: {PF2E: {saves: {will: 'Will', fortitude: 'Fortitude', reflex: 'Reflex'}}},
    foundry: {utils: {deepClone: structuredClone, randomID: () => 'anonymous' + ++next}}, CONST: {CHAT_MESSAGE_STYLES: {OTHER: 0}},
    document: {createElement: tag => { assert.equal(tag, 'template'); return templatePort(); }},
    ui: {chat: {updateMessage: async m => calls.rendered.push(m.id)}, notifications: {warn: text => calls.warnings.push(text)}},
    ChatMessage: {create: async data => { const created = doc(data); calls.created.push(created); await sandbox.afterCreate?.(created); return created; }}};
  vm.runInNewContext(source + '\nglobalThis.probe={publicSource,reveal,postFollowup,reconcileFollowups,reconcileFollowup,renderControls};', sandbox);
  const api = sandbox.probe, speaker = {actor: 'caster', scene: 'scene', token: 'token'};
  const privateCard = doc({speaker, whisper: [gm.id], blind: false, content: '<h3>Identified &lt;spell&gt;</h3>',
    flags: {[ID]: {cast: {role: 'gm', link: 'link', plan: {followups: [{type: 'fortitude', basic: false, traits: ['incapacitation'], dc: 31}]}}},
      pf2e: {origin: {uuid: 'Actor.caster.Item.PRIVATE_UUID'}}}}, 'private'); privateCard.item = spell;
  const root = doc(api.publicSource(spell, {initial: [{type: 'will', basic: true}]}, {link: 'link', speaker}), 'root');
  function child(overrides = {}) { return doc({...api.publicSource(spell, {initial: [{type: 'fortitude', basic: false, traits: ['incapacitation'], dc: 31}]},
    {link: 'link', speaker, followup: true}), ...overrides}); }
  return {sandbox, api, calls, doc, gm, pc, users, messages, spell, privateCard, root, child, hooks, setDC: x => showDC = x};
}
test('root reveal updates existing native followups using their public mechanics and stable embedded identity', async () => {
  const f = fixture(), c = f.child(), before = plain(c.flags.pf2e), audience = {whisper: [...c.whisper], blind: c.blind};
  await f.api.reveal(f.privateCard);
  assert.equal(c.flags[ID].cast.revealedName, f.spell.name); assert.match(c.content, /Identified &lt;spell&gt;.*Follow-up/);
  assert.match(c.content, /data-save="fortitude" data-dc="31"/);
  assert.deepEqual(plain(c.flags.pf2e), {...before, casting: {...before.casting, embeddedSpell: {...before.casting.embeddedSpell, name: f.spell.name}}});
  assert.deepEqual({whisper: [...c.whisper], blind: c.blind}, audience);
  assert.equal(JSON.stringify(c.flags).includes('PRIVATE_UUID'), false); assert.equal(f.calls.created.length, 0);
  assert.equal(c.flags.pf2e.casting.embeddedSpell.system.traits.value.includes('incapacitation'), true);
});
test('new followups after reveal use same native renderer and minimal item without private UUID', async () => {
  const f = fixture(); await f.api.reveal(f.privateCard); await f.api.postFollowup(f.privateCard, 0);
  const c = f.calls.created[0]; assert.equal(c.flags[ID].cast.revealedName, f.spell.name);
  assert.match(c.content, /data-dc="31"/); assert.equal(c.flags.pf2e.casting.embeddedSpell.name, f.spell.name);
  assert.equal(JSON.stringify(c.flags).includes('PRIVATE_UUID'), false);
});
test('a child update failure remains retryable through already-revealed root without re-revealing/reposting', async () => {
  const f = fixture(), c = f.child(); c.failOnce = true;
  await assert.rejects(f.api.reveal(f.privateCard), /rejected child/); assert.equal(f.root.flags[ID].cast.revealed, true);
  await f.api.reveal(f.privateCard); assert.equal(c.flags[ID].cast.revealed, true);
  assert.equal(f.calls.updates.filter(u => u.id === 'root').length, 1); assert.equal(f.calls.created.length, 0);
});
test('native create completion rereads root revealed while followup creation was pending', async () => {
  const f = fixture(); f.sandbox.afterCreate = async () => { await f.api.reveal(f.privateCard); };
  await f.api.postFollowup(f.privateCard, 0);
  assert.equal(f.calls.created.length, 1); assert.equal(f.calls.created[0].flags[ID].cast.revealedName, f.spell.name);
});
test('old revealed public roots without a name flag use already-public name, never private source', async () => {
  const f = fixture(), c = f.child(); f.root.flags[ID].cast.revealed = true; f.root.item = {name: 'Already public name'};
  f.privateCard.item = {get name() { throw Error('Must not read private source'); }};
  await f.api.reconcileFollowups(f.root); assert.equal(c.flags[ID].cast.revealedName, 'Already public name');
});
test('unreconstructable legacy cards remain unchanged rather than receiving invented mechanics', async () => {
  for (const corrupt of [c => delete c.flags.pf2e.casting.embeddedSpell.system.defense.save.basic,
    c => c.rolls = [{total: 10}],
    c => c.content = c.content.replace('data-dc="31"', 'data-dc="unknown"'), c => c.content = '<p>Unrecognized legacy card</p>',
    c => c.content += '<p>GM custom reminder: additional save timing</p>',
    c => c.flags.pf2e.casting.embeddedSpell.system.level.value = 99]) {
    const f = fixture(), c = f.child(); corrupt(c); const original = plain({content: c.content, flags: c.flags});
    await f.api.reveal(f.privateCard); assert.deepEqual(plain({content: c.content, flags: c.flags}), original);
  }
});
test('private/blind/implicit-GM audience relationships never broaden a revealed name', async () => {
  for (const scenario of [
    {root: {whisper: ['pc']}, child: {whisper: []}, identified: false},
    {root: {whisper: ['pc', 'other']}, child: {whisper: ['pc']}, identified: true},
    {root: {whisper: ['pc']}, child: {whisper: ['other']}, identified: false},
    {root: {blind: true}, child: {blind: false}, identified: false},
    {root: {blind: true}, child: {whisper: ['gm'], blind: false}, identified: true},
    {root: {whisper: ['pc']}, child: {blind: true}, identified: true}]) {
    const f = fixture(); Object.assign(f.root, scenario.root); const c = f.child(scenario.child), audience = plain({whisper: c.whisper, blind: c.blind});
    await f.api.reveal(f.privateCard); assert.equal(c.flags[ID].cast.revealed, scenario.identified);
    assert.deepEqual(plain({whisper: c.whisper, blind: c.blind}), audience);
    if (!scenario.identified) assert.equal(c.content.includes('Identified &lt;spell&gt;'), false);
  }
});
test('tightened root audience anonymizes an already-named followup without changing any save', async () => {
  const f = fixture(), c = f.child(); await f.api.reveal(f.privateCard);
  f.root.whisper = ['pc']; await f.api.reconcileFollowups(f.root);
  assert.equal(c.flags[ID].cast.revealed, false); assert.equal(c.flags[ID].cast.revealedName, undefined);
  assert.equal(c.flags.pf2e.casting.embeddedSpell.name, 'Unidentified Spell'); assert.match(c.content, /data-dc="31"/);
});
test('forged/unrelated/ambiguous native links cannot inherit a root name', async () => {
  for (const corrupt of [(f,c) => c.author = f.pc, (f,c) => c.speaker.actor = 'other-caster',
    (f,c) => c.flags[ID].cast.link = 'unrelated', (f,c) => f.doc({...plain(f.root), author: undefined}, 'duplicate')]) {
    const f = fixture(), c = f.child(); corrupt(f, c);
    await f.api.reveal(f.privateCard); assert.equal(c.flags[ID].cast.revealed, false);
    assert.equal(c.content.includes('Identified &lt;spell&gt;'), false);
  }
});
test('current ownership, connection, primary GM and document membership gate every child write', async () => {
  for (const drift of [(f,c) => c.allowed = false, (f,c) => f.messages.delete(c.id),
    (f,c) => f.users.activeGM = {id: 'another-gm'}, (f,c) => f.sandbox.game.socket.connected = false]) {
    const f = fixture(), c = f.child(); f.root.flags[ID].cast.revealed = true; f.root.flags[ID].cast.revealedName = 'Already public';
    drift(f, c); await f.api.reconcileFollowups(f.root); assert.equal(c.flags[ID].cast.revealed, false);
  }
});
test('a context change while first child awaits prevents a later child write', async () => {
  const f = fixture(), a = f.child(), b = f.child();
  a.beforeCommit = () => { b.allowed = false; };
  await f.api.reveal(f.privateCard); assert.equal(a.flags[ID].cast.revealed, true); assert.equal(b.flags[ID].cast.revealed, false);
});
test('reconciliation is idempotent and native update hooks do not generate a write loop', async () => {
  const f = fixture(), c = f.child(); c.emit = true;
  await f.api.reveal(f.privateCard); await f.api.reconcileFollowups(f.root);
  assert.equal(f.calls.updates.filter(u => u.id === c.id).length, 1); assert.equal(f.calls.created.length, 0);
});
test('DC settings never rerender unmounted history or private cards', async () => {
  const f = fixture(); f.child();
  for (const event of ['createSetting', 'updateSetting', 'deleteSetting']) {
    for (const callback of f.hooks.get(event)) callback({key: 'pf2e.metagame_showDC'});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.rendered.length, 0);
  }
});

test('identified followup native button labels obey current DC visibility without changing mechanical DC', async () => {
  const f = fixture(), c = f.child(); await f.api.reveal(f.privateCard); f.sandbox.game.user = f.pc;
  const button = {dataset: {dc: '31', save: 'fortitude'}}, element = {querySelectorAll: () => [button]};
  f.api.renderControls(c, element); assert.equal(button.textContent, 'Roll Fortitude Save');
  f.setDC(true); f.api.renderControls(c, element); assert.equal(button.textContent, 'DC 31 Roll Fortitude Save');
  assert.equal(button.dataset.dc, '31');
});
