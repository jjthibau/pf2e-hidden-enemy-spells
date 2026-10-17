export const SAVES = ['fortitude', 'reflex', 'will'];
const save = (type, basic = false, extra = {}) => ({type, basic, ...extra});

// These profiles express sequencing that PF2e's single defense field cannot store.
// Match slugs, never names or spell rank (legacy Phantasmal Killer differs from Vision of Death).
const profiles = {
  'phantasmal-killer': {
    initial: [save('will')],
    followups: [save('fortitude', false, {traits: ['incapacitation'], condition: 'After a critical failure on the initial Will save.'})],
  },
  'phantasmal-calamity': {
    initial: [save('will', true)],
    followups: [save('reflex', false, {condition: 'After a critical failure on the initial Will save.'}),
      save('will', false, {condition: 'At the end of an affected creature’s turn, to disbelieve and recover.'})],
  },
  'shadow-raid': {initial: [save('reflex', true), save('will', true)], targetChoice: true, followups: []},
  'cinder-swarm': {
    choices: [
      {label: 'Fire Ants — basic Reflex', overlayId: 'OsMweS7nFHnNhCy1', initial: [save('reflex', true)]},
      {label: 'Fireflies — Fortitude (incapacitation)', overlayId: 'Dn2urqase1klSlXN', initial: [save('fortitude', false, {traits: ['incapacitation']})]},
    ], followups: [], repeat: true,
  },
  'wrathful-storm': {
    choices: [
      {label: 'Blizzard — no save', initial: []},
      {label: 'Hail — basic Fortitude', initial: [save('fortitude', true)]},
      {label: 'Lightning — basic Reflex', initial: [save('reflex', true)]},
      {label: 'Tornado — no save', initial: []},
    ], followups: [], repeat: true,
  },
};

export function planFor(spell) {
  const slug = spell.slug ?? spell.system.slug;
  if (profiles[slug]) {
    const plan = structuredClone({...profiles[slug], reviewed: true});
    const applied = spell.appliedOverlays?.get('override');
    const index = applied ? plan.choices?.findIndex(choice => choice.overlayId === applied) ?? -1 : -1;
    return index >= 0 ? {...selectChoice(plan, index), choices: undefined} : plan;
  }
  const defense = spell.system.defense?.save;
  const initial = SAVES.includes(defense?.statistic) ? [save(defense.statistic, !!defense.basic)] : [];
  const description = spell.system.description?.value ?? '';
  // Only explicit inline checks are candidates; mentions of save bonuses are not checks.
  const checks = [...description.matchAll(/@Check\[(fortitude|reflex|will)([^\]]*)\]/g)];
  const additional = [...new Set(checks.map(m => m[1]))].filter(type => type !== defense?.statistic);
  const ambiguous = additional.length > 0 || (!initial.length && checks.length > 0);
  return {initial, followups: additional.map(type => {
    const params = checks.find(match => match[1] === type)?.[2] ?? '';
    const traits = params.match(/\|traits:([^|]+)/)?.[1]?.split(',').filter(Boolean) ?? [];
    const dc = params.match(/\|dc:(\d+)(?:\||$)/)?.[1];
    return save(type, /\|basic(?:\||$)/.test(params), {traits, ...(dc ? {dc: Number(dc)} : {}), condition: 'Review the spell text before posting this additional save.'});
  }),
    review: ambiguous, reviewed: false};
}

export function selectChoice(plan, index) {
  const choice = plan.choices?.[index];
  if (!choice) throw new Error('Invalid caster choice');
  return {...structuredClone(plan), initial: structuredClone(choice.initial), selected: index, overlayId: choice.overlayId};
}
