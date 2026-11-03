import {planFor, selectChoice, SAVES} from './plans.js';
import {autoRecognize, setupRecognition, renderRecognition, requestRecognition, recognitionV1, automaticObserver, seesCaster, manageRecognitionDC} from './recognition-foundry.js';

const ID = 'pf2e-hidden-enemy-spells';
const TITLE = 'Unidentified Spell';
const pending = new WeakMap();
const casting = new Set();
const acting = new Set();
const followupSyncs = new WeakMap();
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
function anonymousSpell(spell, saves, name = TITLE) {
  const traits = [...new Set([...spell.system.traits.value, ...saves.flatMap(s => s.traits ?? [])])];
  return {
    _id: foundry.utils.randomID(), name, type: 'spell', img: 'icons/svg/mystery-man.svg',
    system: {
      level: {value: spell.rank}, slug: 'unidentified-spell', description: {value: ''},
      traits: {value: traits, traditions: [...spell.traditions]},
      location: {value: spell.system.location.value, heightenedLevel: spell.rank},
      defense: saves[0] ? {save: {statistic: saves[0].type, basic: saves[0].basic}} : null,
    },
  };
}

function saveCardContent({rank, actorId, saves, name = TITLE, followup = false, targetChoice = false,
  visible = game.settings.get('pf2e', 'metagame_showDC')}) {
  const buttons = saves.map(save => {
    const saveDC = save.dc;
    const label = `Roll ${saveLabel(save.type)} Save`;
    return `<button type="button" data-action="spell-save" data-save="${save.type}" data-dc="${saveDC}"><span data-visibility="${visible ? 'all' : 'gm'}">DC ${saveDC} </span>${esc(label)}</button>`;
  }).join('');
  return `<div class="pf2e chat-card item-card pf2e-hidden-spell" data-cast-rank="${rank}" data-actor-id="${esc(actorId)}">
      <header class="hidden-spell-header"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i><h3>${esc(name)}${followup ? ' — Follow-up' : ''}</h3></header>
      ${targetChoice && saves.length > 1 ? '<p>Choose one saving throw.</p>' : ''}
      <section class="card-buttons">${buttons}</section></div>`;
}

function publicSource(spell, plan, {link, speaker, followup = false, whisper = [], blind = false, name} = {}) {
  const dc = spell.spellcasting?.statistic?.withRollOptions({item: spell}).dc.value ?? null;
  const saves = plan.initial.map(save => ({...save, dc: save.dc ?? dc}));
  if (saves.some(save => !SAVES.includes(save.type) || !Number.isInteger(save.dc) || save.dc < 1)) {
    throw new Error('Every save needs a valid spellcasting DC or an explicit positive DC.');
  }
  const anon = anonymousSpell(spell, saves, name);
  return {
    speaker, whisper, blind, style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    content: saveCardContent({rank: spell.rank, actorId: spell.actor.id, saves, name, followup, targetChoice: plan.targetChoice}),
    flags: {
      [ID]: {cast: {role: 'public', link, revealed: !!name, followup, ...(name ? {revealedName: name} : {})}},
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
  const roots = game.messages.filter(m => trustedPublic(m) && flag(m).link === cast?.link && !flag(m).followup && sameCaster(m, message));
  return roots.length === 1 ? roots[0] : null;
}

function currentMessage(message) { return !!message && game.messages.get(message.id) === message; }
function trustedPublic(message) {
  const cast = flag(message);
  return currentMessage(message) && message.author?.isGM && cast?.role === 'public'
    && typeof cast.link === 'string' && cast.link.length > 0 && cast.link.length <= 64 && !/[^A-Za-z0-9_-]/.test(cast.link);
}
function sameCaster(a, b) {
  return !!a.speaker?.actor && ['actor', 'token', 'scene'].every(key => (a.speaker?.[key] ?? '') === (b.speaker?.[key] ?? ''));
}
function writable(message) {
  return game.user.isGM && game.socket.connected && currentMessage(message) && message.canUserModify(game.user, 'update');
}
function reconciliationWriter() {
  return game.user.isGM && game.socket.connected && (!game.users.activeGM || game.users.activeGM.id === game.user.id);
}
function revealedName(root) {
  if (!trustedPublic(root) || flag(root).followup || !flag(root).revealed) return null;
  const name = flag(root).revealedName ?? root.item?.name;
  return typeof name === 'string' && name.length > 0 && name.length <= 200 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
}
function audienceWithin(child, root) {
  const gms = gmIds();
  const readers = message => message.blind ? gms : message.whisper.length ? [...new Set([...gms, ...message.whisper])] : null;
  const allowed = readers(root), actual = readers(child);
  return allowed === null || actual !== null && actual.every(id => allowed.includes(id));
}

// Read only the mechanics already present in a module's single-save follow-up.
// Unknown legacy HTML is left alone; never infer a replacement DC from its caster.
function followupPrompt(message) {
  const embedded = message.flags.pf2e?.casting?.embeddedSpell;
  if (message.isRoll || message.rolls?.length || typeof message.content !== 'string' || message.content.length > 65536 || embedded?.type !== 'spell'
      || embedded.system?.slug !== 'unidentified-spell') return null;
  const rank = embedded.system.level?.value, save = embedded.system.defense?.save;
  if (!Number.isInteger(rank) || rank < 1 || rank > 10 || !SAVES.includes(save?.statistic) || typeof save.basic !== 'boolean') return null;
  const template = document.createElement('template'); template.innerHTML = message.content;
  const cards = template.content.querySelectorAll('.pf2e-hidden-spell');
  if (cards.length !== 1 || Number(cards[0].dataset.castRank) !== rank || cards[0].dataset.actorId !== message.speaker.actor) return null;
  const buttons = cards[0].querySelectorAll('button[data-action="spell-save"]');
  if (buttons.length !== 1 || buttons[0].dataset.save !== save.statistic || !/^\d{1,16}$/.test(buttons[0].dataset.dc ?? '')) return null;
  const dc = Number(buttons[0].dataset.dc);
  if (!Number.isSafeInteger(dc) || dc < 1) return null;
  const prompt = {rank, actorId: message.speaker.actor, saves: [{type: save.statistic, basic: save.basic, dc}], followup: true};
  // Do not discard a GM's extra notes, custom mechanics or an unknown legacy format.
  const normalized = content => content.replace(/\s+/g, ' ').trim();
  if (![false, true].some(visible => normalized(saveCardContent({...prompt, name: embedded.name, visible})) === normalized(message.content))) return null;
  return prompt;
}

async function reconcileFollowupNow(message) {
  if (!reconciliationWriter() || !trustedPublic(message) || !flag(message).followup || !writable(message)) return;
  const root = partner(message);
  if (!root) return;
  const name = audienceWithin(message, root) ? revealedName(root) : null;
  const desired = name ?? TITLE, cast = flag(message), embedded = message.flags.pf2e?.casting?.embeddedSpell;
  const prompt = followupPrompt(message);
  if (!prompt) return;
  const content = saveCardContent({...prompt, name: desired});
  if (cast.revealed === !!name && (cast.revealedName ?? null) === name && embedded?.name === desired && message.content === content) return;
  // No await between these fresh identity/role/audience checks and the native write.
  const update = {content, [`flags.${ID}.cast.revealed`]: !!name,
    'flags.pf2e.casting.embeddedSpell.name': desired};
  if (name) update[`flags.${ID}.cast.revealedName`] = name;
  else update[`flags.${ID}.cast.-=revealedName`] = null;
  await message.update(update);
}

function reconcileFollowup(message) {
  if (!message) return Promise.resolve();
  const pending = followupSyncs.get(message);
  if (pending) { pending.dirty = true; return pending.task; }
  const entry = {dirty: false};
  entry.task = (async () => {
    do { entry.dirty = false; await reconcileFollowupNow(message); } while (entry.dirty);
  })().finally(() => followupSyncs.delete(message));
  followupSyncs.set(message, entry);
  return entry.task;
}

async function reconcileFollowups(root) {
  if (!reconciliationWriter() || !trustedPublic(root) || flag(root).followup) return;
  for (const message of game.messages.filter(m => flag(m)?.followup && flag(m).link === flag(root).link)) await reconcileFollowup(message);
}

async function reveal(message, {recognition} = {}) {
  if (!writable(message) || !message.author?.isGM || flag(message)?.role !== 'gm') return;
  const target = partner(message);
  if (!target) return ui.notifications.warn('The anonymous spell card has been deleted.');
  if (!writable(target)) return;
  if (!flag(target).revealed) {
    const attribution = recognition ? `<aside class="hidden-spell-recognition" role="note"><strong>Automatically recognized by ${esc(recognition.name)}</strong><br>${esc(recognition.reason)}.</aside>` : '';
    const update = {content: attribution + message.content, 'flags.pf2e': clone(message.flags.pf2e), [`flags.${ID}.cast.revealed`]: true,
      [`flags.${ID}.cast.revealedName`]: message.item.name};
    if (recognition) update[`flags.${ID}.cast.recognition`] = clone(recognition);
    if (!message.flags.pf2e.casting?.embeddedSpell) update['flags.pf2e.casting.-=embeddedSpell'] = null;
    await target.update(update);
    message.render(true);
  }
  // Retrying an already-revealed root must still repair a failed child update.
  await reconcileFollowups(target);
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
  if (!save || !writable(message) || !message.author?.isGM) return;
  const currentRoot = partner(message);
  if (!currentRoot || !writable(currentRoot)) return;
  const created = await ChatMessage.create(publicSource(message.item, {initial: [save]}, {
    link: flag(message).link, speaker: message.speaker, followup: true, whisper: [...currentRoot.whisper], blind: currentRoot.blind,
    name: revealedName(currentRoot) ?? undefined,
  }), {renderSheet:false});
  await reconcileFollowup(created);
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
  if (cast?.role === 'public' && (!cast.revealed || cast.followup)) {
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
    <button type="button" data-hidden-action="reveal">${revealed ? 'Refresh follow-up names' : 'Reveal spell to players'}</button>
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
    finally {
      acting.delete(message.id); button.disabled = false;
      if (button.dataset.hiddenAction === 'reveal' && flag(partner(message))?.revealed) button.textContent = 'Refresh follow-up names';
    }
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
  game.settings.register(ID, 'revealOnRecognition', {
    name: 'Reveal spell after successful recognition',
    hint: 'Default off. A successful or critically successful recognition check reveals the spell card to its existing audience and names the recognizing character. Failed checks leave it hidden.',
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
  game.modules.get(ID).api = Object.freeze({planFor, reveal, postFollowup, manage, requestRecognition, recognitionV1, automaticObserver, seesCaster});
});

Hooks.on('renderChatMessageHTML', renderControls);
for (const hook of ['createSetting', 'updateSetting', 'deleteSetting']) Hooks.on(hook, setting => {
  if (setting.key !== 'pf2e.metagame_showDC' || !game.ready) return;
  for (const message of game.messages) {
    if (flag(message)?.role === 'public') {
      void Promise.resolve(ui.chat.updateMessage(message)).catch(error => console.error(ID, error));
    }
  }
});
Hooks.on('createChatMessage', message => {
  if (flag(message)?.followup) void reconcileFollowup(message).catch(error => console.error(ID, error));
});
Hooks.on('updateChatMessage', message => {
  if (flag(message)?.role !== 'public') return;
  const task = flag(message).followup ? reconcileFollowup(message) : reconcileFollowups(message);
  void task.catch(error => console.error(ID, error));
});
Hooks.on('updateChatMessage', (message, changes, _options, userId) => {
  if (!game.user.isGM || userId !== game.user.id || flag(message)?.role !== 'gm' || !('content' in changes)) return;
  void (async () => {
    const plan = await resolvePlan(message.item);
    if (plan) {await message.update({[`flags.${ID}.cast.plan`]: plan}); await syncPublic(message, plan);}
  })().catch(error => {console.error(ID, error); ui.notifications.error(error.message);});
});
