# Packages for Linux distributions

The release workflow builds AppImage, deb, rpm and tar.gz for Linux (plus the Windows installer and portable exe, and the macOS dmg). Two packages live outside GitHub releases and are submitted by hand: **AUR** (`aur/`) and **Flathub** (`flatpak/`). Both repack the release `Matane-<version>-linux-x64.tar.gz` and tell the app how it was installed (`MATANE_PACKAGE`), so it says "update through your package manager" instead of offering a download (ADR 0021).

## AUR: `matane-bin`

Files: `aur/PKGBUILD`, `aur/.SRCINFO`, `aur/matane.sh` (the `/usr/bin/matane` launcher), `aur/matane.desktop`.

After a release is published (the tar.gz must be downloadable):

```sh
node packaging/update-aur.mjs 1.0.0     # version, sha256 of every source, .SRCINFO
cd packaging/aur && makepkg -f          # optional: builds and checks the package locally
```

First submission (once):

1. Create an account on <https://aur.archlinux.org>, add your SSH public key in _My Account_.
2. Check that `matane-bin` is not taken: <https://aur.archlinux.org/packages?K=matane>.
3. `git clone ssh://aur@aur.archlinux.org/matane-bin.git` (an empty repository creates the package).
4. Copy `PKGBUILD`, `.SRCINFO`, `matane.sh`, `matane.desktop` into it, `git add`, `git commit -m "Initial import: 1.0.0"`, `git push`.

Each release: run the script, copy the four files again, commit ("Update to 1.0.1"), push. `.SRCINFO` must always match the `PKGBUILD` (the script writes both; `makepkg --printsrcinfo` gives the same output).

## Flathub: `dev.sukun.matane`

Files: `flatpak/dev.sukun.matane.yml` (manifest), `flatpak/dev.sukun.matane.metainfo.xml`, `flatpak/dev.sukun.matane.desktop`.

After a release is published:

```sh
node packaging/update-flatpak.mjs 1.0.0 --date 2026-10-30   # URL + sha256, <release> entry
appstreamcli validate packaging/flatpak/dev.sukun.matane.metainfo.xml
desktop-file-validate packaging/flatpak/dev.sukun.matane.desktop
# With flatpak-builder installed (and the Flathub remote):
flatpak-builder --user --install --force-clean build-dir packaging/flatpak/dev.sukun.matane.yml
flatpak run dev.sukun.matane
```

First submission (once), following <https://docs.flathub.org/docs/for-app-authors/submission>:

1. Check the requirements: the app id `dev.sukun.matane` must match a domain you control (`sukun.dev`) — Flathub verifies it later through a file on that domain. Otherwise use `io.github.SukunDev.Matane` (renaming the files and the ids inside them).
2. Make sure `runtime-version`/`base-version` are the current Freedesktop and Electron BaseApp branch.
3. Fork <https://github.com/flathub/flathub>, branch from `new-pr`, add the three files, open a pull request against `new-pr` titled "Add dev.sukun.matane".
4. Answer the review; once merged, Flathub creates `flathub/dev.sukun.matane`, where later updates go (as pull requests with the updated manifest and metainfo).

Permissions and why (also in the manifest): network; Wayland with X11 fallback; GPU; `~/Documents/Matane` (the default download folder; other folders go through the file chooser portal); notifications; the tray (`StatusNotifierWatcher`); the keyring (proxy password); the Discord sockets for Rich Presence (off unless turned on).

## Checks before submitting

- `MATANE_PACKAGE` reaches the app: Settings → About says "Installed as AUR package" / "Installed as Flatpak".
- The app starts with a fresh profile, downloads to `~/Documents/Matane`, the tray icon shows.
