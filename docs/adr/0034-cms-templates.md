# 34. CMS templates for extensions

Status: Accepted (2026-10-04)

## Context
Many sites run on one of two WordPress themes, Madara and MangaThemesia, whose pages share a structure. Each extension for such a site repeated the same listing, details, chapter and page selectors; the Mihon world solves this with shared multisrc modules. Matane's extensions are self-contained bundles in a sandbox ([0003](0003-quickjs-extension-sandbox.md)), run by a host that must not need to know about any theme.

## Decision
- **A library, not a host feature.** `@matane/extension-templates` (MIT, `packages/extension-templates`) exports `madara(config)` and `mangaThemesia(config)`, each returning a complete `Source`. An extension imports it and `mr-ext build` bundles it, like any dependency. The app, the host protocol and `SDK_API_VERSION` do not change; a template can improve without a new app.
- **Plain objects to override.** A template returns a `Source`, so a site's differences are a spread (`{ ...madara(config), search }`) plus configuration: paths, orders, and every CSS selector (`MADARA_SELECTORS`, `MANGATHEMESIA_SELECTORS` are exported). The templates read each theme's **default markup**; a site that changed it adapts through the config.
- **Sandbox-safe code.** ES2020 only, strings and regular expressions (no `URL`, no Node.js), parsing through the `html` global. Manga and chapters are stored as paths relative to `baseUrl`. Chapter dates understand relative text and calendar dates in English and Indonesian.
- **Scaffolding.** `mr-ext create --template html|madara|mangathemesia` (`html` is the previous behaviour and the default); the dependency follows `--layout` like the SDK's.
- **Published with the other packages.** Same version, same tag (`sdk-v*`), same provenance; `publish-sdk.yml` checks four versions now.
- **No site inside.** Tests run the scaffolded extensions in the sandbox against pages written for the tests (fictional titles, `example.org`), in `packages/extension-cli` (the CLI builds and runs them; the templates package has only unit tests of its helpers, so the two do not depend on each other).

## Consequences
- A new site on either theme is a one-line extension, and fixes to a template reach every extension that updates the dependency.
- Selectors follow the default markup as known from the themes' typical output; they are **not** verified against any live site in this repository. The first `mr-ext test` against a real site may need a selector override, which is what the config is for.
- Filters, `transformImage` and `migrateUrl` are not part of the templates.
