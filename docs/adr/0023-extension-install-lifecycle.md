# 23. Installing, updating and removing extensions

Status: Accepted (2026-09-27)

## Context
Until Phase 4 extensions were either built into the app or loaded from a folder in developer mode. Installs from repositories (ADR 0022) must never leave half an extension behind, must show what an extension may reach, and must not let one repository take over another's extension.

## Decision
- **Two steps.** `prepareInstall` downloads the archive, checks size + sha256 against the signed index and validates its contents and manifest, then returns what the install dialog shows (repository trust, API version, size, "SHA-256 verified"). Nothing is written until `install(token)`; unanswered tokens expire after 10 minutes.
- **Atomic write** to `userData/extensions/<id>`: files go to `<id>.tmp`, the old folder moves to `<id>.old`, the new one takes its place, the old one is removed. On start, leftovers are cleaned up (`.tmp` removed, an `.old` without its folder restored).
- **Origin priority** for the same id: developer folder > installed from a repository > built-in. The extension row remembers its repository (`extensions.repo_id`); updates only come from there. If another repository offers the same id, it is shown as "installed from another repository" and cannot be installed until the first one is uninstalled.
- **Updates** install directly ("Update all" installs every one); see [0031](0031-no-domain-allowlist.md).
- **Uninstall** removes the folder, the extension's storage and preferences (cascade), clears its session (`persist:ext-<id>`) and unloads its runtime. Its sources stay in the database, so library manga are shown as "source not installed" until it is installed again. A built-in with the same id takes over again.
- Removing a repository keeps its extensions installed, without updates.

## Consequences
- An install needs the archive in memory (at most 20 MB), which keeps verification simple.
- The official repository and moving MangaDex out of the app follow in Phase 4e.

## Update (Milestone 4f, 2 Oct 2026)
- The official repository is live: `https://sukundev.github.io/matane-extensions/`, signed by `ed25519:MorWEtba9PuogLbiYZR/HVUVn+KpY3zsNq8nzqyhAbw=` (`main/extensions/official.ts`). Its sources are github.com/SukunDev/matane-extensions.
- The app ships no built-in extension anymore (`extensions/` left the repository, and so did `extraResources`). The `builtin` origin stays in the registry, which reads an absent folder as empty: it is the way back if an extension ever has to ship with the app again.
- Users of 0.1 with the built-in MangaDex get it from the official repository by the handoff; their library, progress, preferences and storage stay (same id).
- End-to-end tests never reach the real repository: with `MATANE_E2E` the official URL is only the test's own.

