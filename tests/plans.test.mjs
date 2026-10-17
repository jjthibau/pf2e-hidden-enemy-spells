import assert from 'node:assert/strict';
import {test} from 'node:test';
import {planFor, selectChoice} from '../scripts/plans.js';

// Synthetic metadata only. No licensed compendium or spell descriptions required.
const spell = (slug, type, {basic = false, text = ''} = {}) => ({system: {
  slug, defense: type ? {save: {statistic: type, basic}} : null, description: {value: text},
}});
const plan = slug => planFor(spell(slug));

test('ordinary native primary save and basic flag are retained', () => {
  assert.deepEqual(planFor(spell('synthetic-basic-save', 'reflex', {basic:true})).initial, [{type:'reflex',basic:true}]);
});
test('no-save spell does not invent a save', () => {
  assert.deepEqual(plan('synthetic-no-save').initial, []);
});
test('a save bonus mentioned in prose does not become a check', () => {
  assert.deepEqual(planFor(spell('synthetic-bonus', 'reflex', {text:'A bonus to Fortitude saves.'})).followups, []);
});
test('unknown additional checks require GM review rather than simultaneous posting', () => {
  const p=planFor(spell('synthetic-branch', 'will', {text:'@Check[will] @Check[fortitude|traits:incapacitation|dc:19]'}));
  assert.equal(p.review, true);
  assert.deepEqual(p.initial.map(s=>s.type), ['will']);
  assert.equal(p.followups[0].type, 'fortitude');
  assert.deepEqual(p.followups[0].traits, ['incapacitation']);
  assert.equal(p.followups[0].dc, 19);
});
test('inline checks without a primary defense require review', () => {
  const p=planFor(spell('synthetic-inline', null, {text:'@Check[reflex|basic]'}));
  assert.equal(p.review, true);
  assert.deepEqual(p.initial, []);
  assert.equal(p.followups[0].basic, true);
});
test('duplicate inline checks produce one candidate per additional save type', () => {
  const p=planFor(spell('synthetic-duplicate', 'will', {text:'@Check[fortitude] @Check[fortitude]'}));
  assert.equal(p.followups.length, 1);
});
test('legacy Phantasmal Killer initially requests Will only', () => {
  assert.deepEqual(plan('phantasmal-killer').initial.map(s=>s.type), ['will']);
});
test('legacy Phantasmal Killer defers incapacitation Fortitude', () => {
  const p=plan('phantasmal-killer');
  assert.equal(p.followups[0].type, 'fortitude');
  assert.deepEqual(p.followups[0].traits, ['incapacitation']);
});
test('Vision of Death never inherits the legacy Fortitude follow-up', () => {
  const p=planFor(spell('vision-of-death','will'));
  assert.deepEqual(p.initial.map(s=>s.type), ['will']);
  assert.deepEqual(p.followups, []);
});
test('Phantasmal Calamity defers Reflex and repeat Will', () => {
  const p=plan('phantasmal-calamity');
  assert.deepEqual(p.initial, [{type:'will',basic:true}]);
  assert.deepEqual(p.followups.map(s=>s.type), ['reflex','will']);
});
test('Shadow Raid exposes target choice with both saves', () => {
  const p=plan('shadow-raid');
  assert.equal(p.targetChoice, true);
  assert.deepEqual(p.initial.map(s=>s.type), ['reflex','will']);
});
test('Cinder Swarm fire ants select the matching Reflex variant', () => {
  const p=selectChoice(plan('cinder-swarm'),0);
  assert.deepEqual(p.initial, [{type:'reflex',basic:true}]);
  assert.equal(p.overlayId,'OsMweS7nFHnNhCy1');
});
test('Cinder Swarm fireflies select Fortitude and incapacitation', () => {
  const p=selectChoice(plan('cinder-swarm'),1);
  assert.equal(p.initial[0].type,'fortitude');
  assert.deepEqual(p.initial[0].traits,['incapacitation']);
  assert.equal(p.overlayId,'Dn2urqase1klSlXN');
});
test('an already applied Cinder Swarm overlay does not prompt again', () => {
  const s=spell('cinder-swarm');s.appliedOverlays=new Map([['override','Dn2urqase1klSlXN']]);
  const p=planFor(s);
  assert.equal(p.choices,undefined);
  assert.equal(p.initial[0].type,'fortitude');
});
test('Wrathful Storm retains its caster choices without an applied overlay', () => {
  assert.equal(plan('wrathful-storm').choices.length,4);
});
test('Wrathful Storm includes no-save effects', () => {
  assert.deepEqual(selectChoice(plan('wrathful-storm'),0).initial,[]);
  assert.deepEqual(selectChoice(plan('wrathful-storm'),3).initial,[]);
});
test('Wrathful Storm hail and lightning use different saves', () => {
  assert.equal(selectChoice(plan('wrathful-storm'),1).initial[0].type,'fortitude');
  assert.equal(selectChoice(plan('wrathful-storm'),2).initial[0].type,'reflex');
});
test('invalid caster choices are rejected', () => {
  assert.throws(()=>selectChoice(plan('cinder-swarm'),99),/Invalid caster choice/);
});
test('profile results are independent and cannot mutate later casts', () => {
  const p=plan('phantasmal-killer');p.initial[0].type='reflex';
  assert.equal(plan('phantasmal-killer').initial[0].type,'will');
});
test('selecting a choice does not mutate the base plan', () => {
  const base=plan('cinder-swarm');const original=structuredClone(base);
  selectChoice(base,0).initial[0].type='will';
  assert.deepEqual(base,original);
});
