import {planFor, selectChoice, SAVES} from './plans.js';
import {autoRecognize, setupRecognition, renderRecognition, requestRecognition, automaticObserver, seesCaster, manageRecognitionDC} from './recognition-foundry.js';

const ID = 'pf2e-hidden-enemy-spells';
const TITLE = 'Unidentified Spell';
const pending = new WeakMap();
const casting = new Set();
const acting = new Set();
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = value => foundry.utils.deepClone(value);
const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);
const flag = message => message?.getFlag?.(ID, 'cast');
const saveLabel = type => game.i18n.localize(CONFIG.PF2E.saves[type]);

function eligible(spell) {
  return game.user.isGM && game.settings.get(ID, 'enabled') && spell.actor?.isOfType('npc') &&
    !spell.actor.hasPlayerOwner && spell.actor.alliance !== 'party' && !spell.isRitual;
}

async function resolvePlan(spell, existing) {
  let plan = existing ?? planFor(spell);
  if (plan.review) plan = await editPlan(spell, plan);
  if (!plan) return null;
  if (plan.choices) {
    const index = await foundry.applications.api.DialogV2.wait({
      window: {title: `${spell.name}: choose the effect`},
      content: '<p>The caster chooses. Only the selected save is posted to players.</p>',
      buttons: plan.choices.map((choice, i) => ({action: `choice-${i}`, label: choice.label, callback: () => i})),
      close: () => null, rejectClose: false,
    });
    if (index === null || index === undefined) return null;
    plan = selectChoice(plan, index);
  }
  return plan;
}

async function editPlan(spell, plan) {
  const rows = SAVES.map(type => {
    const initial = plan.initial.find(s => s.type === type), later = plan.followups.find(s => s.type === type);
    return `<div class="form-group"><label>${esc(saveLabel(type))}</label><div class="form-fields">
      <select name="phase-${type}"><option value="none">Not requested</option>
      <option value="initial" ${initial ? 'selected' : ''}>Initial save</option>
      <option value="later" ${!initial && later ? 'selected' : ''}>GM posts later</option></select>
      <label><input type="checkbox" name="basic-${type}" ${initial?.basic || later?.basic ? 'checked' : ''}> Basic</label>
      <label>DC <input type="number" name="dc-${type}" min="1" step="1" placeholder="Spell DC" value="${initial?.dc ?? later?.dc ?? ''}"></label></div></div>`;
  }).join('');
  return foundry.applications.api.DialogV2.wait({
    window: {title: `${spell.name}: review saving throws`}, position: {width: 650},
    content: `<p>Review the spell’s instructions. Extra checks can depend on results, timing, or a choice; only initial saves appear now.</p>
      <details><summary>Spell text (GM only)</summary>${spell.system.description.value}</details>${rows}
      <div class="form-group"><label>Multiple initial saves</label><select name="relationship">
      <option value="all">Each is required</option><option value="choice" ${plan.targetChoice ? 'selected' : ''}>Target chooses one</option>
      <option value="caster">Caster chooses one (prompt GM)</option></select></div>`,
    buttons: [{action: 'post', label: 'Use these saves', default: true, callback: (_event, button) => {
      const form = button.form;
      const result = {...clone(plan), initial: [], followups: [], review: false, targetChoice: form.elements.relationship.value === 'choice'};
      delete result.choices;
      delete result.overlayId;
      for (const type of SAVES) {
        const phase = form.elements[`phase-${type}`].value;
        const previous = plan.initial.find(s => s.type === type) ?? plan.followups.find(s => s.type === type);
        const dc = Number(form.elements[`dc-${type}`].value);
        const save = {...clone(previous ?? {}), type, basic: form.elements[`basic-${type}`].checked};
        if (dc > 0 && Number.isInteger(dc)) save.dc = dc; else delete save.dc;
        if (phase === 'initial') result.initial.push(save);
        if (phase === 'later') result.followups.push({...save, condition: 'Post when the spell’s instructions require this save.'});
      }
      if (form.elements.relationship.value === 'caster' && result.initial.length > 1) {
        result.choices = result.initial.map(save => ({label: saveLabel(save.type), initial: [save]}));
        result.initial = [];
      }
      return result;
    }}], close: () => null, rejectClose: false,
  });
}

// Minimal anonymous embedded spell: PF2e's spell-save handler retains the
// caster, traits, heightened rank, incapacitation and native roll dialogs.
function anonymousSpell(spell, saves) {
  const traits = [...new Set([...spell.system.traits.value, ...saves.flatMap(s => s.traits ?? [])])];
  return {
    _id: foundry.utils.randomID(), name: TITLE, type: 'spell', img: 'icons/svg/mystery-man.svg',
    system: {
      level: {value: spell.rank}, slug: 'unidentified-spell', description: {value: ''},
      traits: {value: traits, traditions: [...spell.traditions]},
      location: {value: spell.system.location.value, heightenedLevel: spell.rank},
      defense: saves[0] ? {save: {statistic: saves[0].type, basic: saves[0].basic}} : null,
    },
  };
}

function publicSource(spell, plan, {link, speaker, followup = false, whisper = [], blind = false} = {}) {
  const dc = spell.spellcasting?.statistic?.withRollOptions({item: spell}).dc.value ?? null;
  if (plan.initial.some(save => !SAVES.includes(save.type) || !Number.isInteger(save.dc ?? dc) || (save.dc ?? dc) < 1)) {
    throw new Error('Every save needs a valid spellcasting DC or an explicit positive DC.');
  }
  const anon = anonymousSpell(spell, plan.initial);
  const visible = game.settings.get('pf2e', 'metagame_showDC');
  const buttons = plan.initial.map(save => {
    const saveDC = save.dc ?? dc;
    const label = `Roll ${saveLabel(save.type)} Save`;
    return `<button type="button" data-action="spell-save" data-save="${save.type}" data-dc="${saveDC}"><span data-visibility="${visible ? 'all' : 'gm'}">DC ${saveDC} </span>${esc(label)}</button>`;
  }).join('');
  return {
    speaker, whisper, blind, style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    content: `<div class="pf2e chat-card item-card pf2e-hidden-spell" data-cast-rank="${spell.rank}" data-actor-id="${esc(spell.actor.id)}">
      <header class="hidden-spell-header"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i><h3>${TITLE}${followup ? ' — Follow-up' : ''}</h3></header>
      ${plan.targetChoice && plan.initial.length > 1 ? '<p>Choose one saving throw.</p>' : ''}
      <section class="card-buttons">${buttons}</section></div>`,
    flags: {
      [ID]: {cast: {role: 'public', link, revealed: false, followup}},
      pf2e: {origin: {castRank: spell.rank, traits: anon.system.traits.value},
        casting: {id: spell.spellcasting?.id, tradition: spell.spellcasting?.tradition ?? 'arcane', embeddedSpell: anon}},
    },
  };
}

async function hideCast(spell, original, event, options) {
  const plan = pending.get(spell) ?? await resolvePlan(spell);
  if (!plan) return;
  const selected = plan.overlayId ? spell.loadVariant({castRank: Number(options.data?.castRank) || spell.rank, overlayIds: [plan.overlayId]}) ?? spell : spell;
  const draft = await original.call(selected, event, {...options, create: false});
  if (!draft) return draft;
  const source = draft.toObject(), link = foundry.utils.randomID();
  // Explicit private/blind roll modes never become a public announcement.
  const publicData = publicSource(draft.item ?? spell, plan, {link, speaker: source.speaker, whisper: source.whisper, blind: source.blind});
  source.whisper = gmIds(); source.blind = false;
  source.flags[ID] = {cast: {role: 'gm', link, plan}};
  const privateCard = await ChatMessage.create(source, {renderSheet: false});
  try { await ChatMessage.create(publicData, {renderSheet: false}); }
  catch (error) {ui.notifications.error('The spell remains GM-only: the anonymous card could not be posted.'); throw error;}
  try {await autoRecognize(privateCard);}
  catch (error) {console.error(ID, error); ui.notifications.warn('Automatic recognition could not be confirmed; use the recognition or GM Reveal button.');}
  return privateCard;
}

function partner(message) {
  const cast = flag(message);
  return game.messages.find(m => flag(m)?.link === cast?.link && flag(m)?.role === 'public' && !flag(m)?.followup);
}

async function reveal(message, {recognition} = {}) {
  if (!game.user.isGM || flag(message)?.role !== 'gm') return;
  const target = partner(message);
  if (!target) return ui.notifications.warn('The anonymous spell card has been deleted.');
  if (flag(target).revealed) return;
  const attribution = recognition ? `<aside class="hidden-spell-recognition" role="note"><strong>Automatically recognized by ${esc(recognition.name)}</strong><br>${esc(recognition.reason)}.</aside>` : '';
  const update = {content: attribution + message.content, 'flags.pf2e': clone(message.flags.pf2e), [`flags.${ID}.cast.revealed`]: true};
  if (recognition) update[`flags.${ID}.cast.recognition`] = clone(recognition);
  if (!message.flags.pf2e.casting?.embeddedSpell) update['flags.pf2e.casting.-=embeddedSpell'] = null;
  await target.update(update);
  message.render(true);
}

async function postFollowup(message, index) {
  if (!game.user.isGM || flag(message)?.role !== 'gm') return;
  const root = partner(message);
  if (!root) return ui.notifications.warn('The anonymous spell card has been deleted.');
  let save = flag(message).plan.followups[index];
  if (!save) save = await foundry.applications.api.DialogV2.wait({
    window: {title: 'Post another saving throw'},
    content: `<p>Only request this save when the spell requires it. Players select the affected token before rolling.</p>
      <div class="form-group"><label>Saving throw</label><select name="save">${SAVES.map(type => `<option value="${type}">${esc(saveLabel(type))}</option>`).join('')}</select></div>
      <div class="form-group"><label>DC</label><input type="number" name="dc" min="1" step="1" value="${message.item.spellcasting?.statistic?.withRollOptions({item:message.item}).dc.value ?? ''}" required></div>
      <label><input type="checkbox" name="basic"> Basic save</label>
      <label><input type="checkbox" name="incapacitation"> This save has incapacitation</label>`,
    buttons: [{action:'post', label:'Post save', default:true, callback:(_event, button) => ({type:button.form.elements.save.value, basic:button.form.elements.basic.checked,
      dc:Number(button.form.elements.dc.value), traits:button.form.elements.incapacitation.checked?['incapacitation']:[]})}],
    close: () => null, rejectClose: false,
  });
  if (!save) return;
  await ChatMessage.create(publicSource(message.item, {initial: [save]}, {
    link: flag(message).link, speaker: message.speaker, followup: true, whisper: root.whisper, blind: root.blind,
  }), {renderSheet:false});
}

async function syncPublic(message, plan) {
  const target = partner(message);
  if (!target || flag(target)?.revealed) return;
  const source = publicSource(message.item, plan, {link: flag(message).link, speaker: message.speaker});
  await target.update({content: source.content, 'flags.pf2e': source.flags.pf2e});
}

async function manage(message) {
  if (!game.user.isGM || flag(message)?.role !== 'gm') return;
  const edited = await editPlan(message.item, flag(message).plan);
  if (!edited) return;
  const plan = await resolvePlan(message.item, edited);
  if (!plan) return;
  await message.update({[`flags.${ID}.cast.plan`]: plan});
  await syncPublic(message, plan);
}

function renderControls(message, element) {
  renderRecognition(message, element);
  const cast = flag(message);
  if (cast?.role === 'public' && !cast.revealed) {
    for (const button of element.querySelectorAll('button[data-action="spell-save"]')) {
      const showDC = game.user.isGM || game.settings.get('pf2e', 'metagame_showDC');
      button.textContent = `${showDC ? `DC ${button.dataset.dc} ` : ''}Roll ${saveLabel(button.dataset.save)} Save`;
    }
  }
  if (!game.user.isGM || cast?.role !== 'gm' || !message.isContentVisible) return;
  const container = element.querySelector('.message-content');
  if (!container || container.querySelector('.hidden-spell-gm-controls')) return;
  const controls = document.createElement('section');
  controls.className = 'hidden-spell-gm-controls gm-controls';
  const revealed = !!flag(partner(message))?.revealed;
  controls.innerHTML = `<p><strong>Hidden spell — GM controls</strong></p>
    <button type="button" data-hidden-action="reveal" ${revealed ? 'disabled' : ''}>${revealed ? 'Spell revealed' : 'Reveal spell to players'}</button>
    <button type="button" data-hidden-action="manage">Manage saving throws</button>
    <button type="button" data-hidden-action="recognition-dc">Recognition DC override</button>
    ${(cast.plan?.followups ?? []).map((save, i) => `<p>${esc(save.condition)}<button type="button" data-hidden-action="followup" data-index="${i}">Post ${esc(saveLabel(save.type))} follow-up</button></p>`).join('')}
    <button type="button" data-hidden-action="followup" data-index="-1">Post another save…</button>`;
  controls.addEventListener('click', async event => {
    const button = event.target.closest('button[data-hidden-action]');
    if (!button || acting.has(message.id)) return;
    event.preventDefault(); event.stopPropagation(); acting.add(message.id); button.disabled = true;
    try {
      if (button.dataset.hiddenAction === 'reveal') await reveal(message);
      if (button.dataset.hiddenAction === 'manage') await manage(message);
      if (button.dataset.hiddenAction === 'recognition-dc') await manageRecognitionDC(message);
      if (button.dataset.hiddenAction === 'followup') await postFollowup(message, Number(button.dataset.index));
    } catch (error) {console.error(ID, error); ui.notifications.error(error.message);}
    finally {acting.delete(message.id); button.disabled = button.dataset.hiddenAction === 'reveal' && !!flag(partner(message))?.revealed;}
  });
  container.prepend(controls);
}

function anonymousRollCopy(spell) {
  const oldName = spell.name;
  const scrub = value => typeof value === 'string' ? value.split(oldName).join(TITLE) :
    Array.isArray(value) ? value.map(scrub) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k,scrub(v)])) : value;
  const data = scrub(spell.toObject());
  data._id = foundry.utils.randomID(); data.name = TITLE; data.img = 'icons/svg/mystery-man.svg';
  data.system.slug = 'unidentified-spell'; data.system.description = {value: ''}; data.flags = {};
  const copy = new spell.constructor(data, {parent: spell.actor});
  return copy.loadVariant({castRank: spell.rank}) ?? copy;
}

Hooks.once('init', () => {
  game.settings.register(ID, 'enabled', {
    name: 'Hide enemy spell cards', hint: 'Unowned NPCs outside the party post anonymous spell cards. The GM can reveal each cast.',
    scope: 'world', config: true, type: Boolean, default: true,
  });
  game.settings.register(ID, 'autoRecognize', {
    name: 'Automatically reveal spells recognized by the party',
    hint: 'Default off. Reveal when a conscious party character on this scene has the spell prepared or in their repertoire and can see an ordinary casting. Subtle, hidden and uncertain castings remain GM-controlled. Offline characters count.',
    scope: 'world', config: true, type: Boolean, default: false,
  });
});

Hooks.once('ready', () => {
  setupRecognition(reveal);
  const Spell = CONFIG.PF2E.Item.documentClasses.spell;
  const Entry = CONFIG.PF2E.Item.documentClasses.spellcastingEntry;
  const originalMessage = Spell.prototype.toMessage;
  Spell.prototype.toMessage = async function(event, options = {}) {
    if (options.create === false || !eligible(this)) return originalMessage.call(this, event, options);
    return hideCast(this, originalMessage, event, options);
  };
  const originalCast = Entry.prototype.cast;
  Entry.prototype.cast = async function(spell, options = {}) {
    if (!eligible(spell) || options.message === false) return originalCast.call(this, spell, options);
    if (casting.has(spell.uuid)) return;
    casting.add(spell.uuid);
    try {
      const effective = spell.loadVariant({castRank: options.rank ?? spell.rank}) ?? spell;
      const plan = await resolvePlan(effective);
      if (!plan) return;
      pending.set(spell, plan);
      return await originalCast.call(this, spell, options);
    } finally {pending.delete(spell); casting.delete(spell.uuid);}
  };
  for (const method of ['rollAttack', 'rollDamage', 'rollCounteract']) {
    const original = Spell.prototype[method];
    Spell.prototype[method] = function(event, ...args) {
      const messageId = event?.target?.closest?.('[data-message-id]')?.dataset.messageId;
      const message = game.messages.get(messageId);
      const hidden = game.user.isGM && flag(message)?.role === 'gm' && !flag(partner(message))?.revealed;
      return original.call(hidden ? anonymousRollCopy(this) : this, event, ...args);
    };
  }
  const originalTemplate = Spell.prototype.placeTemplate;
  Spell.prototype.placeTemplate = function(message, ...args) {
    const hidden = game.user.isGM && flag(message)?.role === 'gm' && !flag(partner(message))?.revealed;
    return originalTemplate.call(hidden ? anonymousRollCopy(this) : this, message, ...args);
  };
  game.modules.get(ID).api = Object.freeze({planFor, reveal, postFollowup, manage, requestRecognition, automaticObserver, seesCaster});
});

Hooks.on('renderChatMessageHTML', renderControls);
Hooks.on('updateSetting', setting => {
  if (setting.key !== 'pf2e.metagame_showDC' || !game.ready) return;
  for (const message of game.messages) {
    if (flag(message)?.role === 'public' && !flag(message).revealed) {
      void Promise.resolve(ui.chat.updateMessage(message)).catch(error => console.error(ID, error));
    }
  }
});
Hooks.on('updateChatMessage', (message, changes, _options, userId) => {
  if (!game.user.isGM || userId !== game.user.id || flag(message)?.role !== 'gm' || !('content' in changes)) return;
  void (async () => {
    const plan = await resolvePlan(message.item);
    if (plan) {await message.update({[`flags.${ID}.cast.plan`]: plan}); await syncPublic(message, plan);}
  })().catch(error => {console.error(ID, error); ui.notifications.error(error.message);});
});
