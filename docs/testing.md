# Testing

## Portable checks

```sh
npm test
python tools/build_release.py
python tools/check_release.py
```

The tests use synthetic spell metadata and Node's built-in test runner. They cover ordinary/no-save spells, false save-bonus matches, unknown-check review, explicit DCs and traits, profile sequencing, caster/target choices, overlay selection, invalid choices and independent plan objects.

The build uses an explicit nine-file allowlist. Release checks verify manifest/version consistency, archive contents, runtime byte parity and SHA256 checksums. No licensed compendium data or Foundry installation is needed for CI.

## Native test checklist

Use your own licensed Foundry installation in an isolated world, with separate GM and player browser profiles. Do not use a live campaign as an automated fixture. Current verified versions: Foundry14.369 / PF2e8.6.0.

Create a synthetic enemy NPC with a spellcasting entry and DC28, and a player-owned character with a placed token. Give the character a higher level than twice the tested incapacitation spell's rank so its adjustment can be checked. Use your installed system's compendium to add spells locally; do not commit or distribute that compendium.

| Area | Verification |
| --- | --- |
| Audience | Original native card is GM-only; player card omits the original name, art, description and item UUID. Explicit GM/blind modes stay private. |
| Native saves | Player selects their token; native buttons roll against the actual DC with traits, caster context and rank intact. |
| Visibility | Restrictive DC setting hides DC; permissive setting shows it. Results/breakdowns follow PF2e settings. Check setting changes and reconnects. |
| Conditional saves | Phantasmal Killer initially posts Will only. GM releases Fortitude later, with the native incapacitation adjustment. |
| Remaster | Vision of Death does not inherit the legacy Fortitude check. |
| Multiple checks | Calamity offers the conditional Reflex and repeat Will checks to the GM. |
| Target choice | Shadow Raid displays Reflex and Will, with a choose-one instruction. |
| Caster choice | Both Cinder Swarm modes choose the matching native variant and save. Cancel spends no slot; accepting consumes exactly one. |
| Unknown spells | A synthetic spell with two explicit checks opens review, supports caster choice, and retains a manually entered DC. |
| Native controls | Hidden native attack/damage cards do not identify the spell. Damage application and Undo work. Native template preparation retains its shape with an anonymous label. |
| Reveal | Same public card becomes the full native spell; native save controls work; repeated reveal is harmless. |
| Scope | PC spells, player-owned NPCs, party-allied NPCs, and the disable switch retain native behavior. |
| Persistence | Anonymous/revealed cards and GM controls behave correctly after reload. |
| Recognition | Selected/assigned character requests are resolved by a connected GM. Prepared, expended and repertoire matches skip rolling and explain why, even with automatic reveal off. |
| Recognition rules | Check actual casting tradition, Unified Theory, rank DC, uncommon +2 / rare +5 / unique +10, Bizarre Magic, common-only proficiency floors and automatic untrained failure with/without the feat. Verify skill-only button labels, training guidance, repeat attempts via button/API, strict/permissive failure visibility and prepared/repertoire exceptions. Verify reveal-after-recognition defaults off, successful opted-in checks reveal with PC attribution and unchanged audience, and failed checks remain hidden. |
| Awareness | With automatic reveal enabled, test individual sight, walls, darkness, blindness, unconsciousness, deafness, paralysis/stun, invisible/GM-hidden caster and subtle spells. No scene or ambiguous caster remains manual. |
| Roll privacy | Native secret-check/DC/results settings and public/GM/blind/self modes; self rolls belong to the requesting player. Requests contain no original spell identifiers. |
| Integration | Repeat with the table's enabled modules; compare to a minimal world if a conflict occurs. |

Before the initial public release, separate native GM/player clients passed59 standalone assertions and62 assertions with ten additional modules enabled. The runtime was then playtested by the GM and a player. This verifies the exercised workflows, not every spell or third-party module.

Version 0.2.0 passes 32 portable tests and 102 native assertions with the same ten additional modules, separate GM/player clients, and no page/console errors. Native checks include rarity adjustments, prepared/repertoire recognition, individual sight/walls/darkness, relevant conditions, subtle casting, secret/permissive roll settings, self rolls, Oddity Identification, proficiency success floors and the GM DC override dialog.

Following the on-card attribution update, 44 focused native checks pass with that module stack, including the recognizing PC's name, prepared/repertoire explanation and persistence after player reload. No page/console errors.

The recognition workflow was also playtested by a GM/player before publication.

Native template preparation was checked programmatically; mouse placement remains a manual check. Conditions, affected targets, skill alternatives and repeat timing remain GM adjudication. Rapid synthetic chat bursts can encounter Foundry14's notification-animation race when chat is collapsed; keep the chat sidebar open during stress tests and distinguish core notification errors from module failures.
