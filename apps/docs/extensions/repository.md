# Publishing a repository

The official repository (matane-extensions) is set up from [`docs/matane-extensions/`](https://github.com/SukunDev/matane/blob/main/docs/matane-extensions/README.md): accounts, keys, the workflows that build, sign and publish it, and a daily smoke test. The same templates work for a repository of your own.

Extensions reach users through a repository: a static folder (GitHub Pages works) with a signed index.

```
repo/
├─ index.json            # name, extensions (id, version, langs, nsfw, domains, sha256, …)
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
- The app trusts a repository through keys it knows (the official key, or one the user chose to trust); the `publicKey` in `index.json` is only informative. `--unsigned` builds a repository the app will call unverified.

