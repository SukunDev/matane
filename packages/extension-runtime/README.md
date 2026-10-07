# @matane/extension-runtime

The sandbox that runs [Matane](https://github.com/mataneorg/matane) extensions: a QuickJS runtime per extension with memory, CPU and time limits, the host globals (`http` through the embedder, which decides what it may reach, `html` parsed on the host, `storage`, `crypto`…), plus the host side of repositories (ed25519 signatures, archives) and of `transformImage` (tiles rebuilt with sharp).

The Matane app and `@matane/extension-cli` both use it, so an extension behaves the same in `mr-ext test`, in its tests and in the app. You normally only need it in extension tests:

```ts
import { ExtensionRuntime } from '@matane/extension-runtime';
import { buildExtension, createFixtureHost } from '@matane/extension-cli';

const built = await buildExtension('.', { write: false });
const runtime = await ExtensionRuntime.create({
  code: built.code,
  manifest: built.manifest,
  host: createFixtureHost({ dir: 'test/fixtures' }),
  hostInfo: { appName: 'test', appVersion: '0', apiVersion: 1 },
});
const popular = await runtime.call('en', 'getPopular', [1]);
```

Subpaths: `/repo` (index signing and verification, archive reading), `/image` (`restoreImage`, `applyTiles`, `sniffImageType`), `/http-bridge`. MIT.
