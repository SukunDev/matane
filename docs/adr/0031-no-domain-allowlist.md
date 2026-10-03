# 31. No domain allowlist for extensions

Status: Accepted (2026-10-03)

## Context
Manifests listed every host an extension could reach (`domains`), checked for each request, redirect hop and image, and every new domain in an update was asked for again. Ported sites spread pages over many image hosts and CDNs that change often, so keeping the lists current meant editing extensions one by one, and Mihon/Tachiyomi extensions have no such list either.

## Decision
- `domains` is gone from the manifest schema, the repository index and the extension entries the app shows. Older manifests and indexes that still carry it parse as before; the field is ignored.
- Requests are still limited to http(s) and still go through the app (rate limits, sessions, challenge solving), but to any host.
- The install dialog no longer lists hosts, and updates install without a second confirmation ("Update all" and automatic updates install every update).
- SDK, runtime and CLI move to 0.2.0.

## Consequences
- An extension can contact any website, so trust rests on the repository (signed index, trust by key, [0022](0022-extension-repositories-and-trust.md)) and on reviewing extension code.
- Supersedes the allowlist parts of [0004](0004-extension-format.md), [0022](0022-extension-repositories-and-trust.md) and [0023](0023-extension-install-lifecycle.md).
