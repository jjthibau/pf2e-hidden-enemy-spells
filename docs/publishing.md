# Releases and Foundry's package directory

There are two distribution paths: direct installation from the public manifest URL, and discovery in Foundry's package directory. The first does not require directory approval.

## GitHub release

The stable installation/update URL is:

```text
https://github.com/jjthibau/pf2e-hidden-enemy-spells/releases/latest/download/module.json
```

Each release supplies `module.json`, `module.zip`, and `SHA256SUMS`. The manifest's `download` URL points to that exact version's ZIP. The ZIP has `module.json` at its root and includes only the allowlisted runtime/documentation files. GitHub's automatically generated source archives are not the install package.

For a new version:

1. Update `module.json` and `package.json` versions together, set the versioned `download` URL, and add a changelog entry.
2. Run portable checks and native tests appropriate to the change. Verify compatibility before expanding it.
3. Commit the prepared release. Tag that commit, for example `git tag v0.1.1`, then push the commit and tag.
4. The Release workflow checks the tag/version, builds the archive, tests it, and creates the GitHub release. Prerelease tags are marked as prereleases.
5. Test installation from the public manifest in an isolated Foundry instance. Keep the stable manifest URL unchanged for future updates.

CI and release workflows use commit-pinned first-party actions and least-needed token permissions. No npm dependencies or external publishing token are needed for GitHub releases.

## Foundry directory submission

An owner of an active Foundry software license can submit a package for manual review through the [Package Submission Form](https://foundryvtt.com/creators/submit/), linked from the [packages page](https://foundryvtt.com/packages/). Sign into the licensed Foundry account first. Directory approval is separate from creating a GitHub release.

Prepared technical details:

| Field | Value |
| --- | --- |
| Package type | Add-on Module |
| ID | `pf2e-hidden-enemy-spells` |
| Title | PF2e Hidden Enemy Spells |
| Project URL | https://github.com/jjthibau/pf2e-hidden-enemy-spells |
| Latest manifest | https://github.com/jjthibau/pf2e-hidden-enemy-spells/releases/latest/download/module.json |
| Initial version manifest | https://github.com/jjthibau/pf2e-hidden-enemy-spells/releases/download/v0.1.0/module.json |
| License | MIT |
| System | PF2e; verified8.6.0 |
| Foundry | Minimum/verified14.369, generation14 |
| Suggested categories | Chat Log and Messaging; Combat Enhancements; Automation Enhancers |

Use the maintainer's own listing description and review the current form's requirements before submitting. The README, real UI screenshots, architecture guide and changelog provide material for that review; no directory approval is implied by this repository.

Foundry's [AI content policy](https://foundryvtt.com/article/ai-policy/) permits AI-assisted code and package documentation under conditions. The submitting author must personally understand, explain, modify and maintain the code, and must attest accordingly. Prepared UI/marketing content also has authorship requirements. The maintainer must personally review those requirements and supply any required human-authored wording; automated repository setup cannot make that attestation. This project must not be described as “Zero AI.”

## Later directory releases

After approval, publish later versions through the package's management page. Foundry also provides a [Package Release API](https://foundryvtt.com/article/package-release-api/) with a per-package token and dry-run mode. The API uses the version-specific manifest URL, not the stable latest URL. No such token is required or included here; add automation only after the package exists and its maintainer authorizes it.

References: [manifest fields](https://foundryvtt.com/article/module-development/), [directory submission FAQ](https://foundryvtt.com/packages/), [release API](https://foundryvtt.com/article/package-release-api/).
