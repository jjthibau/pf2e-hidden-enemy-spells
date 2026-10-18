import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sameSpell, knownSpellReason, recognitionPlan, canObserveCasting} from '../scripts/recognition.js';

const spell = {system: {slug: 'fireball'}};
const actor = (type, prepared = []) => ({itemTypes: {spell: [{id: 'spell1', system: {slug: 'fireball', location: {value: 'entry'}}}]},
  items: new Map([['entry', {system: {prepared: {value: type}, slots: {slot3: {prepared}}}}]])});

test('spell identity uses canonical sources; fallback slug never name only', () => {
  assert(sameSpell(spell, {slug: 'fireball'}));
  assert(!sameSpell({sourceId: 'A', slug: 'fireball'}, {sourceId: 'B', slug: 'fireball'}));
  assert(!sameSpell({name: 'Fireball'}, {name: 'Fireball'}));
});
test('repertoire recognises regardless of tradition or heightened rank', () => {
  assert.match(knownSpellReason(actor('spontaneous'), spell), /repertoire/);
});
test('prepared and expended slots recognise; spellbook alone does not', () => {
  for (const expended of [true, false]) assert.match(knownSpellReason(actor('prepared', [{id: 'spell1', expended}]), spell), /prepared today/);
  assert.equal(knownSpellReason(actor('prepared'), spell), null);
  assert.equal(knownSpellReason(actor('innate'), spell), null);
});
test('legacy object-shaped preparation slots also work', () => {
  assert(knownSpellReason(actor('prepared', {0: {id: 'spell1', expended: true}}), spell));
});
test('flexible spell collection qualifies only for selected collection spells', () => {
  const pc=actor('prepared');pc.items.get('entry').system.prepared.flexible=true;
  assert.equal(knownSpellReason(pc,spell),null);
  pc.itemTypes.spell[0].system.location.signature=true;
  assert.match(knownSpellReason(pc,spell),/flexible spell collection/);
});
test('all four casting traditions select their skill', () => {
  for (const [tradition, skill] of Object.entries({arcane:'arcana', divine:'religion', occult:'occultism', primal:'nature'})) {
    assert.equal(recognitionPlan({tradition, rank:3, skills:{}}).skill, skill);
  }
});
test('rank DC, rarity, caster feat and GM override combine correctly', () => {
  const base={tradition:'arcane', rank:3, skills:{}};
  assert.equal(recognitionPlan(base).dc,20);
  assert.equal(recognitionPlan({...base, rarity:'uncommon', bizarre:true}).dc,27);
  assert.equal(recognitionPlan({...base, rarity:'rare'}).dc,25);
  assert.equal(recognitionPlan({...base, dcOverride:42}).dc,42);
  assert.equal(recognitionPlan({...base, tradition:null}),null);
});
test('Unified Theory can replace the casting tradition skill', () => {
  assert.equal(recognitionPlan({tradition:'primal',rank:3,skills:{arcana:{rank:4}},feats:['unified-theory']}).skill,'arcana');
});
test('Oddity Identification substitutes for qualifying Recall Knowledge, not Recognize Spell', () => {
  const base={tradition:'arcane',rank:3,skills:{arcana:{rank:1,mod:5},occultism:{rank:2,mod:8}},feats:['oddity-identification'],traits:['mental']};
  assert.equal(recognitionPlan(base).skill,'occultism');
  assert.equal(recognitionPlan({...base,traits:['fire']}).skill,'arcana');
  assert.equal(recognitionPlan({...base,feats:[...base.feats,'recognize-spell']}).skill,'arcana');
});
test('feat proficiency floors require common spell, feat and sufficient rank', () => {
  for (const [rank,max] of [[1,2],[2,4],[3,6],[4,10]]) {
    const base={tradition:'arcane',rank:max,skills:{arcana:{rank}},feats:['recognize-spell']};
    assert.equal(recognitionPlan(base).automatic,true);
    if(max<10) assert.equal(recognitionPlan({...base,rank:max+1}).automatic,false);
    assert.equal(recognitionPlan({...base,rarity:'uncommon'}).automatic,false);
    assert.equal(recognitionPlan({...base,feats:[]}).automatic,false);
  }
});
test('no feat uses Recall Knowledge; untrained recognition cannot auto succeed', () => {
  assert.equal(recognitionPlan({tradition:'arcane',rank:1,skills:{}}).action,'recall-knowledge');
  assert.equal(recognitionPlan({tradition:'arcane',rank:1,skills:{},feats:['recognize-spell']}).automatic,false);
});
test('training gate applies with and without the feat and respects substitutions', () => {
  for (const feats of [[], ['recognize-spell']]) {
    for (const tradition of ['arcane', 'divine', 'occult', 'primal']) {
      const base = {tradition, rank:3, skills:{}, feats};
      assert.equal(recognitionPlan(base).untrained, true);
      const skill = recognitionPlan(base).skill;
      assert.equal(recognitionPlan({...base, skills:{[skill]:{rank:1}}}).untrained, false);
    }
  }
  assert.equal(recognitionPlan({tradition:'primal',rank:3,skills:{arcana:{rank:4}},feats:['unified-theory']}).untrained,false);
  assert.equal(recognitionPlan({tradition:'arcane',rank:3,skills:{occultism:{rank:2,mod:10}},feats:['oddity-identification'],traits:['mental']}).untrained,false);
});
test('presence excludes ambiguity and impairments but not deafness, paralysis, stun or offline owner', () => {
  const yes={party:true,sameScene:true,visible:true};
  assert(canObserveCasting({...yes,deafened:true,paralyzed:true,stunned:true,ownerOnline:false}));
  for(const key of ['dead','unconscious','blinded','casterHidden','observerHidden','subtle']) assert(!canObserveCasting({...yes,[key]:true}),key);
  for(const key of ['party','sameScene','visible']) assert(!canObserveCasting({...yes,[key]:false}),key);
});
