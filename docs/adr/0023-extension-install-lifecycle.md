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

## Update (3 Oct 2026)
- The app ships no built-in extension (`extensions/` left the repository, and so did `extraResources`). The `builtin` origin stays in the registry, which reads an absent folder as empty: it is the way back if an extension ever has to ship with the app again.
- There is no official repository, no repository added by itself and no "handoff" of former built-in extensions: users add repositories by their URL (ADR 0022).

