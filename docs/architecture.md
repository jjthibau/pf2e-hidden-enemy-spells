# Architecture and maintenance

The module extends native spell casting and chat; it does not edit actors, owned spell documents, spell slots, conditions or HP directly. `scripts/main.js` is the casting integration. `scripts/plans.js` and `scripts/recognition.js` contain portable policy; `scripts/recognition-foundry.js` integrates recognition with native documents, checks and perception.

## One cast, two views

```mermaid
flowchart TD
  A[GM casts an eligible NPC spell] --> B[Resolve save plan and caster choice]
  B --> C[Native PF2e cast and slot consumption]
  C --> D[Original native card: GM whisper]
  C --> E[Anonymous card: original audience]
  E --> F[Native saving throw]
  D --> G[GM releases conditional save]
  G --> F
  D --> H[GM reveals original card]
  H --> E
```

The `spellcastingEntry.cast` wrapper resolves choices before calling PF2e's original method. A cancelled choice returns before the original method can consume anything. A per-spell in-flight guard prevents duplicate simultaneous casts from sharing pending choices.

The `spell.toMessage` wrapper requests a native draft with `create:false`. Internal previews using `create:false` bypass interception. This preserves native card generation, heightening, variants and casting flags.

The original card becomes a normal GM whisper. A separate public card uses the original speaker/audience but generic content. An explicitly private or blind cast never becomes a public announcement. Both cards share a random link token in module flags; the public flags do not contain the original spell identifier or private plan.

## Native saves

The anonymous card contains standard PF2e `spell-save` buttons and a minimal anonymous `embeddedSpell`. That record preserves traits, caster spellcasting context and heightened rank. It omits the original name, slug, description, artwork and item UUID.

PF2e handles selected tokens, saving throw statistics, roll dialogs, bonuses, outcomes and incapacitation. Buttons carry the actual DC; PF2e's metagame setting controls whether players see it. The numeric DC is not an adversarial client-data secret. Anonymous card labels refresh when the DC setting changes.

## Sequencing

`planFor` returns initial saves, GM-only follow-up candidates, and optional caster/target choice metadata. Curated profiles cover cases where PF2e's single primary-defense field cannot describe the sequence.

Unprofiled spells use their primary defense. Only explicit inline save-check syntax is considered for additional checks; ordinary prose mentioning save bonuses is not parsed into saving throws. Ambiguous candidates require a GM review dialog. This conservatism is deliberate: do not assume that every extra check occurs immediately.

Profiles use slugs. Native overlay IDs are used for Cinder Swarm's variants. Changes to PF2e spell data or overlay IDs require native regression testing. Legacy Phantasmal Killer and remastered Vision of Death must remain distinct.

## Reveal, follow-ups and native rolls

GM controls are attached during chat rendering and their handlers verify `game.user.isGM`. Reveal replaces the original anonymous card's content and PF2e flags with the original native card. It explicitly removes the anonymous embedded spell when the original has none, because a normal nested flag update would otherwise retain it. Reveal is idempotent and one-way.

A follow-up creates a separate anonymous native save card. It does not infer which creatures failed earlier rolls, consume slots, or apply conditions. The GM controls eligibility and timing.

Attacks, damage, counteract checks and templates invoked from the concealed GM card use an in-memory anonymous spell copy. Original PF2e methods perform the calculations and native damage application remains unchanged. The copy's generic slug is a known tradeoff for custom spell-specific predicates; test those separately. Calls made outside these card controls are not intercepted automatically.

## Compatibility boundaries

The integration wraps the system document-class methods present at `ready`, preserving the existing method chain. It does not require libWrapper. Modules that later replace those methods or create their own cards may still conflict.

There is no external service, analytics, account integration, runtime AI call, or additional socket protocol. The standard Foundry message/document model still governs visibility and trust.

## Recognition

Player requests are ordinary chat documents whispered to the author and GMs, containing only the public card ID, character ID and chosen native message mode. The active GM validates the actual document author, character ownership and original card audience before resolving the private spell. Each request is marked handled before rolling to prevent processing the same request twice. No original spell identifier is sent in request flags. A character may make additional requests for the same casting; retry rulings, action costs and awareness on manual requests are table-managed.

Prepared/repertoire matches reveal the original card with a persistent attribution note naming the recognizing PC and explaining the preparation/repertoire match. The note and recognition metadata are stored on the revealed public message; manual GM reveals add no attribution. The GM resolves skill substitutions, then automatically fails unknown-spell requests if that skill is untrained. No roll or spell identity is produced; the explanation follows native secret-check visibility and the requesting message mode. Trained requests use a native skill check on a contextual actor clone; ephemeral degree adjustments implement proficiency success floors without modifying the actor. Results containing the original spell identity stay GM-only for rolled checks; the GM chooses when to reveal publicly. Recognition button labels use the existing public casting tradition/traits plus the selected character's skill substitutions and refresh when selection, actor items or user assignment changes.

Automatic reveal is opt-in and uses only party characters with matching preparations/repertoire on the rendered caster scene. Individual native basic-sight and light-perception detection uses a temporary unregistered vision source, with cleanup and fail-closed handling. It never swaps users, controls tokens, registers a vision source or changes fog. This requires Foundry14/PF2e internals and native regression coverage. Unknown awareness and nonvisual senses remain GM decisions.

Button labels show only the resolved skill, for example Recognize Spell (Nature). Separately, the revealOnRecognition world setting defaults off. When enabled, a final adjusted degree of success of success or critical success reveals the existing card, preserves its audience, and attributes the recognizing PC/skill. Failed and untrained requests leave the card hidden. This setting does not change native check visibility or the independent prepared/repertoire behavior.

Before releasing a runtime change, review [testing.md](testing.md). Understanding this flow, the failure modes of nested flag updates, and the limitations of anonymous copies is part of maintaining the module.
