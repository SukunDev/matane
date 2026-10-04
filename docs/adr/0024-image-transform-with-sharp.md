# 24. Scrambled images: the extension describes, the host restores with sharp

Status: Accepted (2026-09-29)

## Context
Some sites encrypt their image files (XOR, AES) or cut pages into shuffled tiles (docs/BRAINSTORM.md §5.6). Decoding and re-encoding pixels inside the QuickJS sandbox would be far too slow, and bytes crossing the sandbox as JSON would cost several times their size.

## Decision
- `transformImage(page, bytes)` returns **instructions**: replacement `bytes` (decrypted in the sandbox, with `crypto.aesDecrypt` run by the host for AES) and/or `tiles` (a canvas size and rectangles to copy).
- Binary data crosses the sandbox as ArrayBuffers through a dedicated host primitive (`__hostBytes`), never as JSON: the fetched image goes in by id (`image.take`), restored bytes come back the same way (`image.put`). The same primitive serves `crypto.aesDecrypt` and `base64.decodeBytes/encodeBytes`.
- The host checks the instructions (sizes, at most 10 000 rectangles, everything inside the source and the canvas) and rebuilds the picture with **sharp** 0.35: one decode to raw pixels, row copies per rectangle, one encode in the original format (JPEG q92, WebP q92, AVIF, otherwise PNG). The code lives in `@matane/extension-runtime/image`, shared by the app and `mr-ext test`.
- Only sources that define `transformImage` go through it; their responses may have any content type, and the restored bytes must be a known image type.
- The restored image is what is cached and downloaded, so offline reading never runs the extension.
- sharp is unpacked from the asar together with its `@img/*` platform packages (native addon + libvips).

## Consequences
- The app and the CLI ship sharp's prebuilt binaries (~20 MB per platform); it will also be used for cover colours (Phase 5).
- An extension that needs another kind of pixel work (e.g. rotations) needs a new instruction and a new `apiVersion`.
