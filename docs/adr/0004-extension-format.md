# 4. Own extension format with a Mihon-like data model

Status: Accepted (2026-09-23)

## Decision
Extensions are single ES2020 bundles plus `manifest.json` (`id`, `apiVersion`, sources; the former `domains` allowlist was dropped, see [0031](0031-no-domain-allowlist.md)). The data model mirrors Mihon (`Source`, `Manga`, `Chapter`, `Page`, filters, preferences) so Kotlin extensions are easy to port. Repositories are signed with ed25519; bundles are sha256-verified. See docs/BRAINSTORM.md §5.2–5.8.

## Consequences
No reuse of existing Aidoku/Paperback extensions; an SDK and CLI (`mr-ext`) are required for contributors.
