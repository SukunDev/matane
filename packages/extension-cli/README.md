# @matane/extension-cli

`mr-ext`: create, build, test and publish extensions for [Matane](https://github.com/SukunDev/matane).

```sh
npx @matane/extension-cli create my-site --domain my-site.example --lang en
cd my-site && npm install
npx mr-ext build          # src/index.ts → dist/ (one self-contained ES2020 script + manifest.json)
npx mr-ext test           # popular → details → chapters → pages → first image, against the real site
```

| Command                      | What it does                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `create <id>`                | Scaffolds an extension (`--layout standalone` by default; `catalog` inside a pnpm workspace with a shared `catalog:`). |
| `build [dir]`                | Bundles with esbuild and validates the manifest; fails on anything that needs Node.js.                                 |
| `test [dir]`                 | Runs the reading flow in the same sandbox as the app, and `transformImage` on the first page (written to `.mr-ext/`).  |
| `bench [dir]`                | Call times, heap usage and synthetic worst cases.                                                                      |
| `repo keygen`                | Creates an ed25519 signing key (keep the private key out of git).                                                      |
| `repo build <ext…> -o <dir>` | Zips, hashes and indexes extensions into a repository folder and signs `index.json` (`--key` or `$MR_REPO_KEY`).       |
| `repo verify <dir\|url>`     | Checks a repository the way the app does.                                                                              |

For tests: `createFixtureHost` records HTTP responses once (`MR_RECORD=1`) and replays them offline. The full guide: [the extension guide](https://sukundev.github.io/matane/extensions/). MIT.
