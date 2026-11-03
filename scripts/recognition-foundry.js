import {knownSpellReason, recognitionPlan, canObserveCasting} from './recognition.js';

const ID = 'pf2e-hidden-enemy-spells';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const busy = new Set();
const featsOf = actor => [...(actor.itemTypes.feat ?? []), ...(actor.itemTypes.action ?? [])].map(f => f.slug);
const castFlag = m => m?.getFlag(ID, 'cast');
let revealCast;
const skillLabel = skill => game.i18n.localize(CONFIG.PF2E.skills[skill]?.label ?? skill);
function selectedRecognizer() {
  const selected = canvas.tokens?.controlled.filter(t => t.actor?.isOfType('character') && t.actor.isOwner) ?? [];
  return selected.length === 1 ? selected[0].actor : selected.length ? null : game.user.character;
}

function validActorUuid(uuid) {
  return typeof uuid === 'string' && uuid.length <= 256 && !/[\u0000-\u001f\u007f]/.test(uuid)
    && /^(?:Actor\.[A-Za-z0-9_-]{1,64}|Scene\.[A-Za-z0-9_-]{1,64}\.Token\.[A-Za-z0-9_-]{1,64}\.Actor\.[A-Za-z0-9_-]{1,64})$/.test(uuid);
}
function currentOwnedActor(actor, user) {
  try {
    const uuid = actor?.uuid;
    if (!validActorUuid(uuid)) return null;
    return actor.documentName === 'Actor' && actor.isOfType('character') && fromUuidSync(uuid) === actor
      && actor.testUserPermission(user, 'OWNER') ? actor : null;
  } catch { return null; }
}

function publicRecognition(message, user, requireUnrevealed = true) {
  const cast = castFlag(message);
  return game.messages.get(message?.id) === message && cast?.role === 'public' && !cast.followup && (!requireUnrevealed || !cast.revealed)
    && message.author?.isGM && (user.isGM || !message.blind && (!message.whisper.length || message.whisper.includes(user.id)));
}

function updateRecognitionButton(message, button, actor = selectedRecognizer()) {
  const tradition = message.flags.pf2e?.casting?.tradition;
  const plan = recognitionPlan({tradition, rank: 1, skills: actor?.skills ?? {}, feats: actor ? featsOf(actor) : [],
    traits: message.flags.pf2e?.origin?.traits ?? []});
  button.textContent = plan ? `Recognize Spell (${skillLabel(plan.skill)})` : 'Recognize Spell';
  const untrained = actor && plan?.untrained;
  button.title = untrained ? `${actor.name} is untrained in ${skillLabel(plan.skill)}. This attempt automatically fails unless the spell is prepared or in their repertoire.` : '';
}

function refreshRecognitionButtons() {
  for (const button of document.querySelectorAll('[data-recognize-spell]')) {
    const message = game.messages.get(button.closest('[data-message-id]')?.dataset.messageId);
    if (message) updateRecognitionButton(message, button);
  }
}

/** Refresh native labels only: no selection changes, writes or recognition request. */
export function refreshRecognitionControls(actor, root = document) {
  if (!currentOwnedActor(actor, game.user)) return;
  for (const button of root.querySelectorAll('[data-recognize-spell]')) {
    if (!button.isConnected || !root.contains(button)) continue;
    const message = game.messages.get(button.closest('[data-message-id]')?.dataset.messageId);
    if (message?.visible && message.isContentVisible && publicRecognition(message, game.user) && !castFlag(message).revealed) {
      updateRecognitionButton(message, button, actor);
    }
  }
}

export async function manageRecognitionDC(message) {
  if (!game.user.isGM || castFlag(message)?.role !== 'gm') return;
  const value = await foundry.applications.api.DialogV2.wait({window: {title: 'Recognition DC override'},
    content: `<p>Leave blank to calculate the DC from cast rank, rarity and Bizarre Magic.</p><div class="form-group"><label>Identification DC</label><input name="dc" type="number" min="1" step="1" value="${castFlag(message).recognitionDC ?? ''}"></div>`,
    buttons: [{action:'save',label:'Save',default:true,callback:(_event,button)=>button.form.elements.dc.value}],
    close:()=>null,rejectClose:false});
  if (value === null) return;
  if (value === '') await message.unsetFlag(ID, 'cast.recognitionDC');
  else if (Number.isInteger(Number(value)) && Number(value) > 0) await message.setFlag(ID, 'cast.recognitionDC', Number(value));
  else ui.notifications.warn('Enter a positive whole-number DC, or leave it blank.');
}

// Use an unregistered, per-observer vision source: GM and shared vision are
// deliberately excluded. Never control a token or alter fog for this test.
export function seesCaster(observer, caster) {
  if (!canvas.ready || observer.document.parent !== canvas.scene || caster.document.parent !== canvas.scene || !observer.hasSight) return false;
  let source;
  try {
    source = new CONFIG.Canvas.visionSourceClass({sourceId: `${observer.sourceId}.recognition`, object: observer});
    Object.assign(source.blinded, observer._getVisionBlindedStates());
    source.initialize(observer._getVisionSourceData());
    const points = caster.document.getVisibilityTestPoints();
    const config = canvas.visibility._createVisibilityTestConfig(points, {object: caster, tolerance: 0});
    // Basic sight covers darkvision/ranged sight; normal vision in illuminated
    // areas is handled by Foundry's separate light-perception mode.
    return ['basicSight', 'lightPerception'].some(id => {
      const mode = observer.document.detectionModes[id];
      return mode && CONFIG.Canvas.detectionModes[id].testVisibility(source, mode, config) === true;
    });
  } catch (error) {
    console.warn(ID, 'Unable to confirm individual sight; automatic recognition skipped.', error);
    return false;
  } finally {source?.destroy();}
}

export function automaticObserver(message) {
  if (!game.settings.get(ID, 'autoRecognize') || !canvas.ready) return null;
  const spell = message.item;
  const caster = message.token?.object;
  // Ambiguous caster token, other scene, or no canvas: leave the decision to GM.
  if (!spell || !caster || caster.document.parent !== canvas.scene) return null;
  if (!spell.actor.isToken && spell.actor.getActiveTokens(true, true).length > 1) return null;
  const members = new Set(game.actors.party?.members.map(a => a.id) ?? []);
  const subtle = spell.system.traits.value.includes('subtle');
  const casterHidden = caster.document.hidden || spell.actor.hasCondition('hidden', 'undetected', 'unnoticed', 'invisible');
  for (const observer of canvas.tokens.placeables) {
    const actor = observer.actor;
    if (!actor?.isOfType('character')) continue;
    const party = members.size ? members.has(actor.id) : actor.alliance === 'party' && actor.hasPlayerOwner;
    const reason = knownSpellReason(actor, spell);
    if (!reason) continue;
    if (canObserveCasting({party, sameScene: observer.document.parent === caster.document.parent,
      observerHidden: observer.document.hidden, dead: actor.isDead, unconscious: actor.hasCondition('unconscious'),
      blinded: actor.hasCondition('blinded'), casterHidden, subtle, visible: seesCaster(observer, caster)})) return {actor, reason};
  }
  return null;
}

async function resultMessage(source, actor, text, {privateResult = false, mode = 'public', recipient = game.user.id} = {}) {
  const data = {speaker: ChatMessage.getSpeaker({actor}), content: `<p>${esc(actor.name)}: ${text}</p>`};
  // Never widen a deliberately private casting's audience.
  if (privateResult || source.blind || source.whisper.length || mode === 'gm' || mode === 'blind') {
    data.whisper = game.users.filter(u => u.isGM).map(u => u.id);
  } else if (mode === 'self') data.whisper = [recipient];
  return ChatMessage.create(data);
}

export async function autoRecognize(message) {
  const observed = automaticObserver(message);
  if (!observed) return;
  await revealCast(message, {recognition: {actor: observed.actor.id, name: observed.actor.name, reason: observed.reason}});
}

async function resolveRequest(request) {
  const data = request.getFlag(ID, 'recognitionRequest');
  if (!data || request.getFlag(ID, 'recognitionHandled') || busy.has(request.id)) return;
  let origin;
  const context = (allowRevealed = false) => {
    if (!game.user.isGM || game.users.activeGM?.id !== game.user.id || !game.socket.connected || game.messages.get(request.id) !== request) return null;
    const author = request.author;
    if (!author || game.users.get(author.id) !== author) return null;
    let actor;
    // A UUID that is present but invalid must never silently select the base Actor.
    if (Object.hasOwn(data, 'actorUuid')) {
      if (!validActorUuid(data.actorUuid)) return null;
      try { actor = fromUuidSync(data.actorUuid); } catch { return null; }
      if (actor?.uuid !== data.actorUuid) return null;
    } else actor = game.actors.get(data.actor);
    if (!currentOwnedActor(actor, author) || actor.id !== data.actor) return null;
    const target = game.messages.get(data.message);
    if (!publicRecognition(target, author, !allowRevealed)) return null;
    const source = game.messages.find(m => m.author?.isGM && m.author.id === target.author.id && castFlag(m)?.role === 'gm' && castFlag(m).link === castFlag(target).link);
    if (!source?.item) return null;
    const fresh = {author, actor, target, source};
    return !origin || Object.keys(fresh).every(key => fresh[key] === origin[key]) ? fresh : null;
  };
  origin = context();
  if (!origin) return;
  busy.add(request.id);
  try {
    // Persist before resolving so reconnects/other GM clients cannot duplicate it.
    await request.setFlag(ID, 'recognitionHandled', true);
    let fresh = context();
    if (!fresh) return;
    let {author, actor, target, source} = fresh;
    const spell = source.item;
    const reason = knownSpellReason(actor, spell);
    if (reason) {
      await revealCast(source, {recognition: {actor: actor.id, name: actor.name, reason}});
      return;
    }
    const plan = recognitionPlan({tradition: spell.spellcasting?.tradition ?? source.flags.pf2e?.casting?.tradition,
      rank: spell.rank, rarity: spell.system.traits.rarity, skills: actor.skills, feats: featsOf(actor), traits: spell.system.traits.value,
      bizarre: featsOf(spell.actor).includes('bizarre-magic'), dcOverride: castFlag(source).recognitionDC});
    if (!plan) throw Error('This casting has no known tradition. The GM can identify it manually.');
    if (plan.untrained) {
      await resultMessage(target, actor, `Spell recognition automatically fails: untrained in ${esc(skillLabel(plan.skill))}. No check was rolled.`,
        {privateResult: !game.pf2e.settings.metagame.secretChecks, mode: data.mode, recipient: author.id});
      return;
    }
    const options = [`action:${plan.action}`, ...spell.system.traits.value.map(t => `item:trait:${t}`), 'item:magical', 'secret'];
    if (plan.hasFeat && spell.spellcasting?.tradition === 'divine') options.push('recognize-spell');
    const adjustments = {};
    // Native degree adjustments keep the result card consistent with the floor.
    if (plan.automatic) Object.assign(adjustments, {criticalFailure: 'to-success', failure: 'to-success'});
    const ephemeralEffects = Object.keys(adjustments).length ? [{_id: foundry.utils.randomID(), name: 'Recognition proficiency', type: 'effect',
      system: {rules: [{key: 'AdjustDegreeOfSuccess', selector: plan.skill, adjustment: adjustments}]}}] : [];
    const roller = actor.getContextualClone(options, ephemeralEffects);
    const statistic = roller.getStatistic(plan.skill);
    const roll = await statistic.roll({label: plan.hasFeat ? 'Recognize Spell' : 'Identify Spell (Recall Knowledge)',
      dc: {value: plan.dc, visible: game.settings.get('pf2e', 'metagame_showDC')},
      extraRollOptions: options, messageMode: data.mode === 'self' ? 'gm' : data.mode, skipDialog: true,
      callback: async (_roll, _outcome, message) => {
        if (data.mode === 'self' && game.pf2e.settings.metagame.secretChecks && message && context()) await message.update({whisper: [author.id]});
      }});
    if (!roll) throw Error('Recognition roll was cancelled.');
    fresh = context();
    if (!fresh) return;
    ({author, actor, target, source} = fresh);
    const degree = plan.automatic ? Math.max(2, roll.degreeOfSuccess) : roll.degreeOfSuccess;
    const outcome = ['critical failure — choose an incorrect identification', 'failure', 'success',
      plan.hasFeat ? 'critical success — +1 circumstance to AC or saves against this spell' : 'critical success'][degree];
    const autoReveal = degree >= 2 && game.settings.get(ID, 'revealOnRecognition');
    if (autoReveal) await revealCast(source, {recognition: {actor: actor.id, name: actor.name,
      reason: `${degree === 3 ? 'critical success' : 'success'} using ${skillLabel(plan.skill)} to recognize this spell`}});
    // Our successful reveal is allowed, but its current audience/ownership still gates the result.
    if (!context(true)) return;
    await resultMessage(target, actor, `${esc(outcome)} identifying <strong>${esc(spell.name)}</strong>.${plan.automatic ? ' Common spell automatically recognized through skill proficiency; rolled for critical success.' : ''} ${autoReveal ? 'The spell card was automatically revealed.' : 'Use the GM Reveal control to share the spell.'}`, {privateResult: true});
  } catch (error) {
    if (!context(true)) return;
    console.error(ID, error); ui.notifications.error('Spell recognition could not finish. Ask the GM to resolve it manually.');
    await ChatMessage.create({whisper: request.whisper, content: '<p>Spell recognition could not finish. Ask the GM to resolve it manually.</p>'});
  }
  finally {busy.delete(request.id);}
}

export async function requestRecognition(message, actor) {
  if (!currentOwnedActor(actor, game.user)) return ui.notifications.warn('Select one character you own, or assign your character in User Configuration.');
  if (!publicRecognition(message, game.user) || !message.visible || !message.isContentVisible) return ui.notifications.warn('This spell recognition prompt is no longer available.');
  if (!game.socket.connected) return ui.notifications.warn('Reconnect before recognizing a spell.');
  if (!game.users.some(u => u.active && u.isGM)) return ui.notifications.warn('A GM must be connected to resolve spell recognition.');
  await ChatMessage.create({speaker: ChatMessage.getSpeaker({actor}), content: `<p>${esc(actor.name)} attempts to recognize the spell.</p>`,
    whisper: [...new Set([game.user.id, ...game.users.filter(u => u.isGM).map(u => u.id)])],
    flags: {[ID]: {recognitionRequest: {actor: actor.id, actorUuid: actor.uuid, message: message.id, mode: game.settings.get('core', 'messageMode')}}}});
}

export const recognitionV1 = Object.freeze({apiVersion: 1,
  request: async (message, actor) => { await requestRecognition(message, actor); },
  refreshControls: refreshRecognitionControls});

export function renderRecognition(message, element) {
  const flag = castFlag(message);
  if (flag?.role !== 'public' || flag.revealed || flag.followup || !message.isContentVisible) return;
  const container = element.querySelector('.card-buttons');
  if (!container || container.querySelector('[data-recognize-spell]')) return;
  const button = document.createElement('button');
  button.type = 'button'; button.dataset.recognizeSpell = ''; updateRecognitionButton(message, button);
  button.addEventListener('click', async event => {
    event.preventDefault(); event.stopPropagation(); button.disabled = true;
    const selected = canvas.tokens?.controlled.filter(t => t.actor?.isOfType('character') && t.actor.isOwner) ?? [];
    try {
      if (selected.length > 1) return ui.notifications.warn('Select one character to recognize this spell.');
      await requestRecognition(message, selected[0]?.actor ?? game.user.character);
    } finally {button.disabled = false;}
  });
  container.append(button);
}

export function setupRecognition(reveal) {
  revealCast = reveal;
  Hooks.on('controlToken', refreshRecognitionButtons);
  Hooks.on('updateActor', refreshRecognitionButtons);
  Hooks.on('updateItem', refreshRecognitionButtons);
  Hooks.on('createItem', refreshRecognitionButtons);
  Hooks.on('deleteItem', refreshRecognitionButtons);
  Hooks.on('updateUser', refreshRecognitionButtons);
  Hooks.on('createChatMessage', message => {
    if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
    void resolveRequest(message);
  });
}
