# Changelog

## 0.2.1

- Recognition buttons name the required skill and casting tradition, account for supported skill substitutions, and refresh when the selected character changes.
- Unknown-spell recognition automatically fails without rolling when the resolved skill is untrained, with or without the Recognize Spell feat. The explanation follows the GM's secret-check and message visibility settings.
- Prepared/repertoire recognition still succeeds without a roll, including for untrained characters.

## 0.2.0

- Recognize Spell button with native skill rolls, tradition-based skill/DC selection, Unified Theory, Oddity Identification for Recall Knowledge, rarity and Bizarre Magic adjustments.
- Prepared spells (including expended preparations) and repertoire spells recognize without a roll and explain why, regardless of the automatic-reveal setting.
- Automatically revealed cards name the recognizing PC and retain the prepared/repertoire explanation on the card after reload.
- Optional automatic party recognition at casting, default off. Requires a conscious party character on the caster's scene with the spell prepared/in repertoire and confirmed individual sight. Deafness does not prevent sight; blindness, unconsciousness, hidden/invisible casters and subtle spells prevent automatic reveal.
- Native PF2e secret-check, DC and result visibility settings apply. Action/reaction costs remain table-managed; GM retains reveal control for rolled checks.
- Recognize Spell proficiency success floors and untrained failure ceilings; no actor documents or combat resources are modified.

Verified on Foundry VTT 14.369 / PF2e 8.6.0: 32 portable tests, 102 native integration checks plus 44 focused checks after attribution, and GM/player playtesting.

## 0.1.0

Initial public release. Runtime behavior matches the version tested at the table; public packaging adds installation/update URLs, documentation, tests and release tooling.

- Anonymous enemy spell cards with PF2e's native saving throw buttons.
- Existing PF2e DC, result and breakdown visibility settings respected.
- Private native GM spell card with per-cast reveal and follow-up save controls.
- Caster choices, target choices and conditional save sequencing.
- Explicit profiles for Phantasmal Killer, Phantasmal Calamity, Shadow Raid, Cinder Swarm and Wrathful Storm.
- GM review for other spells with additional explicit save checks; editable save DCs.
- Anonymous native attack/damage rolls and area-template preparation from the GM card.
- Native slot consumption preserved; cancelled caster-choice dialogs consume nothing.
- Party-allied NPCs and player characters retain normal spell cards.
- No required add-on modules.

Tested on Foundry VTT14.369 and PF2e8.6.0. UI text is currently English. See [known limitations](README.md#limitations).
