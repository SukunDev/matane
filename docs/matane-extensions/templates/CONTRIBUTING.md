# Contributing

Extensions are small TypeScript projects that run in Matane's sandbox (QuickJS, no Node.js APIs, network only to the domains they list). The full guide: [the extension guide](https://sukundev.github.io/matane/extensions/).

## Setup

```sh
pnpm install
pnpm test                 # every extension, against recorded fixtures
pnpm repo:build:unsigned  # build the whole repository into public/, as it would be published
```

## A new extension

```sh
cd extensions
pnpm exec mr-ext create my-site --name "My Site" --domain my-site.example --lang en --layout catalog
```

`--layout catalog` takes the `@matane/*` versions from the workspace catalog and extends the root `tsconfig.base.json`. Then run `pnpm install` from the root.

Develop with the app: Extensions → **Load from folder** → `extensions/my-site` (after `pnpm build`; it hot-reloads on every build), and **View logs** for its requests and errors. Check the whole reading flow against the real site with `pnpm exec mr-ext test extensions/my-site`.

## Checklist for a pull request

- [ ] `id` is new, lowercase, without a language, and will never change.
- [ ] `version` in `manifest.json` is higher than the published one (CI checks this).
- [ ] `domains` lists only what is needed. Every domain added in an update is asked for again in the app.
- [ ] `nsfw` is `true` for adult sites.
- [ ] `rateLimit` follows the site's rules.
- [ ] `url` values are stable. If their form changes, `migrateUrl` handles every older version.
- [ ] `icon.png`: square, 96–256 px, at most 512 KB.
- [ ] Tests with recorded fixtures (`MR_RECORD=1 pnpm test`; fixtures are not committed), and `mr-ext test` passes against the real site.
- [ ] No paywall bypass, and nothing the site's terms forbid.

## Publishing

Merging to `main` publishes: CI builds every extension, signs the index with the official key (a repository secret) and deploys it to GitHub Pages. Nobody signs anything by hand, and an unsigned or wrongly signed repository is never published.
