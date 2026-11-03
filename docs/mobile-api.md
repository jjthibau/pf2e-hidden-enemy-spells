# Explicit character recognition API (unreleased source)

This additive API is source work, not a new release. Published0.2.2 does not include `recognitionV1`. The package version, runtime allowlist and existing API members are unchanged.

After the supported module reaches ready:

```js
const api = game.modules.get('pf2e-hidden-enemy-spells').api.recognitionV1;
// api.apiVersion === 1
api.refreshControls(ownedActor, nativeChatElement);
await api.request(publicMessage, ownedActor);
```

Supply the current native owned character Actor and current permitted public root ChatMessage. World Actors and synthetic token Actors work. UUIDs must identify that exact current native Actor. Clones, removed/replaced documents, noncharacters, inaccessible/blind prompts and disconnected requests refuse through the existing native warning path. A revealed root is no longer a recognition prompt.

`refreshControls(actor, root = document)` updates existing native Recognize Spell button text/title using the module's same skill-selection policy and public casting information. It changes only eligible, connected, readable controls inside that root. It does not select/control tokens, assign a character, read private source spells, create documents, or roll. An invalid Actor leaves controls unchanged. Call it again after your viewed character or native card changes; native selection hooks continue their existing behavior.

`request(message, actor)` delegates the existing ordinary whisper/request workflow and returns `undefined`. Awaiting it observes submission processing only: **it is not a completed recognition, a GM acknowledgement or an exactly-once transaction receipt**. No new relay, automatic retry, rollback or outcome protocol exists. A thrown error or lost connection after dispatch may leave a submitted request; do not automatically retry. The native GM processing, result visibility, prepared/repertoire recognition, feats and reveal settings still own the outcome. Legacy `api.requestRecognition(message, actor)` remains available with its historical return behavior.

New requests retain the original `actor` ID field and add a bounded world/synthetic `actorUuid`. The elected GM uses the UUID when present and never silently falls back to an ID if that UUID is malformed or unavailable. Requests without the UUID retain legacy world-Actor lookup. Identity, requester ownership, current audience and elected-GM authority are checked again after the handled-flag await and before later result writes. Token-specific state is preserved without inventing another recognition rules implementation.

This API does not prepare native PF2e save selection. Integrators hosting ordinary `spell-save` buttons must bind their selected character/token to the native PF2e selection path separately. Manual awareness and action/reaction costs remain table-managed. An already-dispatched native roll cannot be cancelled by these preflight checks; no cross-client atomicity guarantee is added.

Revealing a root now persists its already-public display name and updates eligible existing/new follow-up save cards through the same save-card renderer. Follow-ups retain their save/DC/basic/traits/casting information, anonymous embedded item ID, speaker, blind state and whisper audience. Only their visible name/render fields change; no original spell UUID, slug, description or artwork is copied into them. A narrower/private follow-up can inherit a name only if its readers are allowed by the root, including implicit GM/blind rules. Already rolled checks are not rewritten or reposted.

Legacy single-save follow-ups are reconstructed only from their existing public minimal spell and save-button fields. Unknown/missing mechanics remain unchanged for GM adjudication. Already-revealed roots can be passed to the existing `api.reveal(privateCard)` again to reconcile a failed child update; the same GM button becomes **Refresh follow-up names**. There is no whole-world startup migration. Local reconciliation coalesces concurrent updates, and background writes use the existing elected GM. Native document events reconcile root/follow-up changes; they do not provide a cross-document atomic disclosure transaction.

Setting creation/update/deletion for the existing PF2e Show DC key refreshes this module's existing save-button text only in verified mounted native ChatLog cards, its current sidebar popout, and registered single-message popouts. The same provider label function handles ordinary card rendering and these refreshes. This does not rerender a message/window, post unmounted history, change DC datasets, replace handlers, refresh recognition-character labels, or write documents. Work coalesces and continues in batches of at most 32 mounted entries/element descendants, with fresh current-message, visibility, native-root and session checks. Open windows keep their native position, minimized state and focus because no window lifecycle method is invoked.

The mounted refresh has portable registered-hook/native-shaped tests. Actual first-persistence/default-restoration behavior, native synthetic resolution, dialogs and phone/tablet controls still require separate native acceptance. Portable tests are not browser/device compatibility certification.
