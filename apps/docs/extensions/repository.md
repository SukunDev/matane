# Publishing a repository

Extensions reach users through a repository: a static folder (GitHub Pages works) with a signed index.

```
repo/
├─ index.json            # name, extensions (id, version, langs, nsfw, sha256, …)
├─ index.json.sig        # ed25519 signature over the exact bytes of index.json
└─ extensions/
   ├─ my-site-1.0.0.zip  # manifest.json + index.js (+ icon.png), nothing else
   └─ icons/my-site.png
```

```sh
mr-ext repo keygen --out repo-key.pem        # once; prints the public key (ed25519:…)
mr-ext repo build ext/a ext/b -o public --name "My Extensions" --key repo-key.pem
mr-ext repo verify public --public-key ed25519:…   # or a URL: https://you.github.io/repo
```

- **Keep the private key out of git.** In CI, put the PEM in a secret and pass it as `$MR_REPO_KEY` instead of `--key`. `keygen` refuses to overwrite an existing key.
- `repo build` takes extension folders with sources (`src/index.ts`, built and minified) or already built ones (`manifest.json` + `index.js`). It rewrites the output folder completely, and refuses a non-empty folder that is not a repository.
- Builds are reproducible: the same extensions give byte-identical archives and index, so a rebuild only changes what really changed.
- `repo verify` checks what the app checks: the signature, the index, and each archive's size, sha256, contents and manifest (it must match the index). Any problem exits with code 1.
- The app trusts a repository through a key the user chose to trust; the `publicKey` in `index.json` is only informative. `--unsigned` builds a repository the app will call unverified.

## Contributing and publishing: the usual workflow

Matane does not host extensions and has no built-in repository. Whoever maintains a repository (you, or a group) works like this:

1. **One git repository for the extensions**, as a pnpm workspace: one folder per extension under `extensions/`, a shared `tsconfig.base.json`, and the SDK, runtime and CLI as dependencies (a `catalog:` entry in `pnpm-workspace.yaml` keeps their versions in one place). Add an extension with `mr-ext create <id> --dir extensions --layout catalog`.
2. **Each extension** has its own `manifest.json`, `src/index.ts`, a `test/` folder with recorded fixtures (`MR_RECORD=1 pnpm test`) and, optionally, an `icon.png`. A pull request should add or change one extension, bump its `version`, and pass `mr-ext build` and its fixture tests.
3. **CI** runs typecheck and the fixture tests on every pull request. On the main branch it runs `mr-ext repo build extensions/* -o public --name "<name>"` with the private key in `$MR_REPO_KEY`, then `mr-ext repo verify public`, and deploys `public/` to static hosting (GitHub Pages works). A scheduled job running `mr-ext test` against the live sites tells you when one broke.
4. **Users** add the repository's URL in Extensions → Repositories and choose to trust its key; the app then checks every index and archive against that key.

Keep the private key out of the repository and back it up: a repository signed with a new key looks like a different (unverified) repository to everyone who trusted the old one.
