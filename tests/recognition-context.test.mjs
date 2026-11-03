import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {knownSpellReason, recognitionPlan, canObserveCasting} from '../scripts/recognition.js';
const ID = 'pf2e-hidden-enemy-spells';
const source = fs.readFileSync(new URL('../scripts/recognition-foundry.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/, '').replace(/^export /gm, '');
class Collection extends Map {
  find(fn) { return [...this.values()].find(fn); }
  filter(fn) { return [...this.values()].filter(fn); }
  some(fn) { return [...this.values()].some(fn); }
}
function fixture() {
  const gm = {id: 'gm', isGM: true, active: true}, pc = {id: 'pc', isGM: false, active: true};
  const actors = new Collection(), messages = new Collection(), users = new Collection([[gm.id, gm], [pc.id, pc]]), uuids = new Map();
  users.activeGM = gm;
  const calls = {created: [], warnings: [], revealed: [], rolls: [], resolved: [], writes: 0};
  const actor = (uuid = 'Actor.hero') => {
    const a = {uuid, id: uuid.split('.').at(-1), documentName: 'Actor', name: 'Synthetic hero', owned: true,
      isOfType: t => t === 'character', testUserPermission: user => user.isGM || a.owned,
      itemTypes: {feat: [], action: [], spell: []}, items: new Map(), skills: {arcana: {rank: 1, mod: 7}, nature: {rank: 1, mod: 8}},
      getContextualClone() { return {getStatistic: skill => ({roll: async options => { calls.rolls.push({actor: a, skill, options}); return {degreeOfSuccess: 2}; }})}; }};
    uuids.set(uuid, a); if (uuid.startsWith('Actor.')) actors.set(a.id, a); return a;
  };
  const hero = actor();
  const target = {id: 'public', author: gm, visible: true, isContentVisible: true, whisper: [], blind: false,
    flags: {[ID]: {cast: {role: 'public', link: 'cast'}}, pf2e: {casting: {tradition: 'primal'}, origin: {traits: []}}},
    getFlag: (id, key) => target.flags[id]?.[key]};
  const spell = {name: 'Private spell', rank: 3, system: {slug: 'native-spell', traits: {rarity: 'rare', value: []}},
    spellcasting: {tradition: 'primal'}, actor: {itemTypes: {feat: [], action: []}}};
  const privateCard = {id: 'private', author: gm, item: spell, flags: {[ID]: {cast: {role: 'gm', link: 'cast'}}},
    getFlag: (id, key) => privateCard.flags[id]?.[key]};
  messages.set(target.id, target); messages.set(privateCard.id, privateCard);
  const sandbox = {knownSpellReason, recognitionPlan, canObserveCasting, console: {error() {}, warn() {}},
    game: {user: pc, users, actors, messages, socket: {connected: true}, settings: {get: (_id, key) => key === 'messageMode' ? 'public' : false},
      pf2e: {settings: {metagame: {secretChecks: true}}}, i18n: {localize: x => x}},
    CONFIG: {PF2E: {skills: {arcana: {label: 'Arcana'}, nature: {label: 'Nature'}}}},
    fromUuidSync: uuid => { calls.resolved.push(uuid); return uuids.get(uuid); },
    ChatMessage: {getSpeaker: ({actor}) => ({actor: actor.id}), create: async data => { calls.created.push(data); }},
    ui: {notifications: {warn: text => { calls.warnings.push(text); return 99; }, error: () => {}}},
    Hooks: {on() {}}, foundry: {utils: {randomID: () => 'effect'}},
    canvas: {tokens: {get controlled() { throw Error('Explicit API must not consult/control native selection'); }}}};
  vm.runInNewContext(source + '\nglobalThis.probe={recognitionV1,requestRecognition,resolveRequest,setupRecognition};', sandbox);
  sandbox.probe.setupRecognition(async (card, metadata) => calls.revealed.push({card, metadata}));
  function request(data = {actor: hero.id, actorUuid: hero.uuid, message: target.id, mode: 'public'}) {
    const r = {id: 'request', author: pc, whisper: [pc.id, gm.id], handled: false,
      getFlag: (_id, key) => key === 'recognitionRequest' ? data : r.handled,
      setFlag: async () => { calls.writes++; r.handled = true; await r.afterMark?.(); }};
    messages.set(r.id, r); return r;
  }
  return {sandbox, api: sandbox.probe, calls, actor, hero, gm, pc, target, privateCard, spell, uuids, messages, users, request};
}
test('explicit native V1 request preserves UUID, original ID and void submission semantics', async () => {
  const f = fixture();
  assert.equal(await f.api.recognitionV1.request(f.target, f.hero), undefined);
  assert.equal(f.calls.created.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.created[0].flags[ID].recognitionRequest)),
    {actor: f.hero.id, actorUuid: f.hero.uuid, message: f.target.id, mode: 'public'});
  assert.equal(JSON.stringify(f.calls.created).includes('Private spell'), false);
  f.hero.owned = false;
  assert.equal(await f.api.recognitionV1.request(f.target, f.hero), undefined);
  assert.equal(f.calls.created.length, 1); assert.equal(f.calls.warnings.length, 1);
});
test('legacy API retains its notification return without inventing V1 completion', async () => {
  const f = fixture(); f.hero.owned = false;
  assert.equal(await f.api.requestRecognition(f.target, f.hero), 99);
  assert.equal(await f.api.recognitionV1.request(f.target, f.hero), undefined);
});
test('real synthetic identity drives native contextual skill rather than same-ID world Actor', async () => {
  const f = fixture(), tokenActor = f.actor('Scene.scene.Token.token.Actor.hero');
  f.sandbox.game.user = f.gm;
  const r = f.request({actor: 'hero', actorUuid: tokenActor.uuid, message: 'public', mode: 'public'});
  await f.api.resolveRequest(r);
  assert.equal(f.calls.rolls.length, 1); assert.equal(f.calls.rolls[0].actor, tokenActor);
  assert.equal(f.calls.rolls[0].skill, 'nature'); assert.equal(f.calls.rolls[0].options.dc.value, 25);
  await f.api.resolveRequest(r); assert.equal(f.calls.rolls.length, 1);
});
test('legacy requests without UUID still resolve a current owned world Actor', async () => {
  const f = fixture(); f.sandbox.game.user = f.gm;
  await f.api.resolveRequest(f.request({actor: f.hero.id, message: 'public', mode: 'public'}));
  assert.equal(f.calls.rolls[0].actor, f.hero);
});
test('present invalid/unresolved UUID never falls back to the valid legacy ID or queries packs', async () => {
  for (const uuid of [null, '', 'Actor.missing', 'Actor.hero\n', 'Compendium.private.Actor.hero', 'Actor.' + 'x'.repeat(1000)]) {
    const f = fixture(); f.sandbox.game.user = f.gm;
    await f.api.resolveRequest(f.request({actor: 'hero', actorUuid: uuid, message: 'public'}));
    assert.equal(f.calls.rolls.length, 0); assert.equal(f.calls.writes, 0);
    if (uuid !== 'Actor.missing') assert.equal(f.calls.resolved.length, 0);
  }
});
test('UUID/ID mismatch and replaced native Actor identity refuse before handled write', async () => {
  const f = fixture(); f.sandbox.game.user = f.gm;
  await f.api.resolveRequest(f.request({actor: 'different', actorUuid: f.hero.uuid, message: 'public'}));
  assert.equal(f.calls.writes, 0);
  f.uuids.set(f.hero.uuid, {...f.hero, testUserPermission: () => false});
  await f.api.resolveRequest(f.request()); assert.equal(f.calls.writes, 0);
});
test('ownership/request/source/audience loss during native handled await cannot roll or reveal', async () => {
  for (const drift of [f => f.hero.owned = false, f => f.messages.delete('request'), f => f.messages.delete('private'),
    f => f.target.whisper = ['other'], f => f.target.blind = true, f => f.users.delete('pc'), f => f.sandbox.game.socket.connected = false]) {
    const f = fixture(); f.sandbox.game.user = f.gm;
    const r = f.request(); r.afterMark = () => drift(f);
    await f.api.resolveRequest(r); assert.equal(f.calls.writes, 1);
    assert.equal(f.calls.rolls.length, 0); assert.equal(f.calls.revealed.length, 0);
  }
});
test('prepared/repertoire match on actual synthetic Actor skips skill and preserves its name', async () => {
  const f = fixture(), a = f.actor('Scene.scene.Token.token.Actor.hero'); f.sandbox.game.user = f.gm;
  a.name = 'Token-specific character'; a.itemTypes.spell.push({id: 'known', system: {slug: f.spell.system.slug, location: {value: 'entry'}}});
  a.items.set('entry', {system: {prepared: {value: 'spontaneous'}}});
  await f.api.resolveRequest(f.request({actor: a.id, actorUuid: a.uuid, message: 'public'}));
  assert.equal(f.calls.rolls.length, 0); assert.equal(f.calls.revealed[0].metadata.recognition.name, a.name);
});
test('native explicit label refresh uses owned Actor policy without selection or document writes', () => {
  const f = fixture(); f.hero.itemTypes.feat.push({slug: 'unified-theory'}); f.hero.skills.arcana.rank = 2;
  const button = {isConnected: true, closest: () => ({dataset: {messageId: f.target.id}})};
  const root = {querySelectorAll: () => [button], contains: () => true};
  f.api.recognitionV1.refreshControls(f.hero, root);
  assert.equal(button.textContent, 'Recognize Spell (Arcana)'); assert.equal(button.title, '');
  assert.equal(f.calls.created.length, 0); assert.equal(f.calls.writes, 0);
  f.hero.skills.arcana.rank = 0; f.hero.skills.nature.rank = 0;
  f.api.recognitionV1.refreshControls(f.hero, root); assert.match(button.title, /untrained/);
});
test('native label refresh rejects stale/revoked/private/revealed/detached controls', () => {
  for (const drift of [(f,b) => f.hero.owned = false, (f,b) => f.messages.delete('public'),
    (f,b) => f.target.whisper = ['other'], (f,b) => f.target.flags[ID].cast.revealed = true, (f,b) => b.isConnected = false]) {
    const f = fixture(), button = {textContent: 'unchanged', isConnected: true, closest: () => ({dataset: {messageId: 'public'}})};
    drift(f, button); f.api.recognitionV1.refreshControls(f.hero, {querySelectorAll: () => [button], contains: () => true});
    assert.equal(button.textContent, 'unchanged'); assert.equal(f.calls.created.length, 0);
  }
});
test('offline/unreadable/removed native prompts cannot submit an ordinary request', async () => {
  for (const drift of [f => f.sandbox.game.socket.connected = false, f => f.target.isContentVisible = false,
    f => f.target.blind = true, f => f.messages.delete('public')]) {
    const f = fixture(); drift(f); await f.api.recognitionV1.request(f.target, f.hero);
    assert.equal(f.calls.created.length, 0);
  }
});
test('same UUID replacement during handled await cannot redirect the pending request to another document', async () => {
  const f = fixture(); f.sandbox.game.user = f.gm;
  const r = f.request(); r.afterMark = () => f.uuids.set(f.hero.uuid, {...f.hero});
  await f.api.resolveRequest(r); assert.equal(f.calls.rolls.length, 0); assert.equal(f.calls.created.length, 0);
});
test('ownership/authority loss during native roll stops later result/reveal writes', async () => {
  for (const drift of [f => f.hero.owned = false, f => f.users.activeGM = {id: 'another'}, f => f.target.whisper = ['other']]) {
    const f = fixture(); f.sandbox.game.user = f.gm;
    f.hero.getContextualClone = () => ({getStatistic: () => ({roll: async () => { drift(f); return {degreeOfSuccess: 2}; }})});
    await f.api.resolveRequest(f.request()); assert.equal(f.calls.revealed.length, 0); assert.equal(f.calls.created.length, 0);
  }
});
test('native failures do not echo private spell identifiers into requester error documents', async () => {
  const f = fixture(); f.sandbox.game.user = f.gm;
  f.hero.getContextualClone = () => { throw Error('Private spell secret UUID'); };
  await f.api.resolveRequest(f.request()); assert.equal(f.calls.created.length, 1);
  assert.equal(JSON.stringify(f.calls.created).includes('Private spell'), false);
});
