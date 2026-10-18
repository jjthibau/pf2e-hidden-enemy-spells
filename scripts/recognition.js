// Pure recognition policy: no Foundry globals, suitable for portable tests.
export const TRADITION_SKILLS = {arcane: 'arcana', divine: 'religion', occult: 'occultism', primal: 'nature'};
const DC = [0, 15, 18, 20, 23, 26, 28, 31, 34, 36, 39];

export function sameSpell(a, b) {
  const source = s => s.sourceId ?? s.flags?.core?.sourceId ?? s._stats?.compendiumSource;
  const left = source(a), right = source(b);
  if (left && right) return left === right;
  const slug = s => s.slug ?? s.system?.slug;
  return !!slug(a) && slug(a) === slug(b);
}

export function knownSpellReason(actor, spell) {
  for (const known of actor.itemTypes?.spell ?? []) {
    if (!sameSpell(known, spell)) continue;
    const entry = actor.items.get(known.system.location.value);
    const type = entry?.system.prepared?.value;
    if (type === 'spontaneous') return 'this spell is in their spell repertoire';
    if (type === 'prepared' && entry.system.prepared.flexible && known.system.location.signature) return 'this spell is in their prepared flexible spell collection';
    if (type === 'prepared' && Object.values(entry.system.slots ?? {}).some(slot =>
      Object.values(slot.prepared ?? {}).some(prepared => prepared.id === known.id))) {
      return 'this spell is prepared today (including expended preparations)';
    }
  }
  return null;
}

export function recognitionPlan({tradition, rank, rarity = 'common', skills, feats = [], traits = [], bizarre = false, dcOverride}) {
  let skill = TRADITION_SKILLS[tradition];
  if (!skill) return null;
  if (feats.includes('unified-theory') && (skills.arcana?.rank ?? 0) >= (skills[skill]?.rank ?? 0)) skill = 'arcana';
  const hasFeat = feats.includes('recognize-spell');
  const oddity = !hasFeat && feats.includes('oddity-identification') && traits.some(t =>
    ['mental', 'fortune', 'misfortune', 'detection', 'prediction', 'revelation', 'scrying'].includes(t));
  if (oddity && ((skills.occultism?.mod ?? 0) + 2 >= (skills[skill]?.mod ?? 0))) skill = 'occultism';
  const proficiency = skills[skill]?.rank ?? 0;
  const automatic = hasFeat && rarity === 'common' && proficiency > 0 && rank <= [0, 2, 4, 6, 10][proficiency];
  const dc = Number.isInteger(dcOverride) && dcOverride > 0 ? dcOverride :
    DC[Math.min(10, Math.max(1, rank))] + ({common: 0, uncommon: 2, rare: 5, unique: 10}[rarity] ?? 0) + (bizarre ? 5 : 0);
  return {skill, dc, automatic, hasFeat, proficiency, action: hasFeat ? 'recognize-spell' : 'recall-knowledge'};
}

export function canObserveCasting({party, sameScene, observerHidden, dead, unconscious, blinded, casterHidden, subtle, visible}) {
  return !!(party && sameScene && !observerHidden && !dead && !unconscious && !blinded && !casterHidden && !subtle && visible);
}
