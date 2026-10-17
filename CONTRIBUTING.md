# Contributing

Bug reports, compatibility reports, spell sequencing corrections and documentation improvements are welcome. Use the issue templates and include your Foundry, PF2e and module versions.

Keep reports focused on a reproducible example. Use a new test world with synthetic actors when possible. Do not attach campaign exports, licensed system/core code, credentials or private player information.

## Local checks

Requires Node.js22+ and Python3.10+. No npm dependencies are required.

```sh
npm test
npm run build
npm run check:release
```

The portable planner tests use small synthetic spell records. The optional native verification checklist is in [docs/testing.md](docs/testing.md); it requires your own licensed Foundry installation and an isolated world.

## Changes

- Read [the architecture guide](docs/architecture.md) before changing casting or chat behavior.
- Preserve native slot consumption, save context, traits and heightened rank.
- Keep player-visible anonymous cards free of original spell names, item UUIDs, artwork and description text.
- Prefer GM review over guessing the meaning of spell prose. Add a sequencing profile only when its trigger and order are clear.
- Do not expand supported Foundry/PF2e versions without native verification.
- Use actual UI screenshots from synthetic fixtures for documentation, not campaign captures or generated mockups.
- Keep runtime changes separate from formatting or release maintenance when practical.

Please keep discussions respectful and actionable. Maintainers may close abusive, duplicate or unrelated reports.

Software development used AI assistance. Contributors remain responsible for understanding and maintaining their submissions. Foundry's directory has its own [AI content policy](https://foundryvtt.com/article/ai-policy/), including author obligations and rules for prepared content. Do not claim that AI-assisted code or content is entirely human-created.
