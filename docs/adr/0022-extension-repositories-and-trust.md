# 22. Extension repositories: signed index, trust by key

Status: Accepted (2026-09-27)

## Context
Extensions reach users through repositories (BRAINSTORM.md §5.8). A repository is a static folder (GitHub Pages or any host), so the host itself cannot be trusted: whoever controls it could swap an archive. Users must still be able to add community repositories.

## Decision
- **Format** (`@matane/extension-sdk/repo`): `index.json` (`formatVersion: 1`, name, informative `publicKey`, and per extension: id, version, apiVersion, description, nsfw, langs, `file`, `size`, `sha256`, `icon`), `index.json.sig` (base64 ed25519 over the exact bytes of `index.json`), `extensions/<id>-<version>.zip` and `extensions/icons/<id>.png`. File paths in the index must be exactly these, so an index cannot point outside the repository.
- **Archives** hold only `manifest.json`, `index.js` and an optional `icon.png`, flat. The manifest must match what the index lists (id, version, apiVersion, nsfw, langs); sizes are capped (index 2 MB, archive 20 MB, icon 512 KB).
- **Signing** uses `node:crypto` ed25519; `mr-ext repo keygen|build|verify` (builds are reproducible). The private key only lives in CI secrets.
- **Trust** is decided by keys the app knows, never by the index: *official* (a key built into the app, `OFFICIAL_KEYS`), *trusted* (a key the user chose with "Trust this key", only offered when the index's own key made a valid signature), otherwise *unverified* (unsigned, unknown key, or a signature that does not match). Adding an unverified repository needs a confirmation; installing from it shows a warning.
- **Sync** fetches `index.json` + `.sig` (HTTPS only; plain HTTP just for loopback), daily when online or on demand. A repository that was official or trusted never silently accepts an index that is no longer signed with its key: the old index is kept and the error shown.
- Every archive must match the signed `sha256` and size before anything is written (ADR 0023).

## Consequences
- Key rotation for the official repository needs an app release that knows the new key.
- A trusted community key is pinned per repository; if its owner rotates keys, the user has to remove and add the repository again.
- End-to-end tests set their own official key (`MATANE_E2E_OFFICIAL_KEY`, only with `MATANE_E2E`).
