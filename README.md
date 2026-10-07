<p align="center"><img src="docs/assets/logo.png" width="128" alt="Matane logo"></p>

<h1 align="center">Matane (またね)</h1>

<p align="center">
  A free, open-source manga reader for your desktop.<br>
  Close the app now, pick up on the same page next time.
</p>

<p align="center">
  <a href="https://github.com/mataneorg/matane/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/mataneorg/matane/total?style=for-the-badge&label=Downloads"></a>
  <a href="https://github.com/mataneorg/matane/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/mataneorg/matane?style=for-the-badge"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/mataneorg/matane?style=for-the-badge"></a>
  <a href="https://saweria.co/PakdeKun"><img alt="Support on Saweria" src="https://img.shields.io/badge/Support-Saweria-F7931E?style=for-the-badge"></a>
</p>

<p align="center">
  <a href="https://github.com/mataneorg/matane/releases">Download</a> ·
  <a href="https://mataneorg.github.io/matane/">Documentation</a> ·
  <a href="https://github.com/mataneorg/matane/issues/new/choose">Report a problem</a> ·
  <a href="#support-the-project">Support</a>
</p>

---

_Matane_ is Japanese for "see you later". It runs on **Windows, macOS and Linux** and is like [Mihon](https://mihon.app), but for your computer.

> [!NOTE]
> Matane **1.0 is in its release candidate** (1.0.0-rc.1, marked "Pre-release" on GitHub). It already does a lot, but expect a few rough edges. If something breaks, please [tell us](https://github.com/mataneorg/matane/issues/new/choose).

> [!IMPORTANT]
> Matane does **not** host or distribute any content, and it comes with **no sources built in**. You choose where your manga comes from by adding an extension repository (a link from someone you trust). See [How do I get manga?](#how-do-i-get-manga)

## Features

**Read comfortably**

- Single page, double page, vertical and webtoon modes, left-to-right or right-to-left
- Zoom, touch gestures, auto-scroll and automatic border cropping
- Colour filters (brightness, contrast, warm tint, grayscale, invert)
- Keyboard shortcuts you can change to anything you like

**Keep your library**

- Organise manga into categories; sort, filter and search your whole library
- Remembers where you stopped, with a "continue reading" shortcut
- Reading history, chapter bookmarks and an incognito mode
- Reading statistics: streaks, favourite genres, time spent
- Press <kbd>Ctrl</kbd>+<kbd>K</kbd> to jump to anything

**Read offline, stay up to date**

- Download chapters as CBZ files or folders, with a queue, "download ahead" and automatic cleanup
- Read CBZ files and folders of images that are already on your computer
- Matane checks your library for new chapters and notifies you
- Works offline, can start with your computer and live in the system tray

**Bring your stuff with you**

- Back up your library, progress and settings to one file, restore it any time
- Import a Mihon/Tachiyomi backup (`.tachibk`)
- Keep AniList, MyAnimeList, Kitsu and MangaUpdates up to date as you read, and bring back what you read elsewhere
- Search across all your sources at once, and move a manga to another source

**Yours to customise**

- Four [Catppuccin](https://catppuccin.com) themes (one light, three dark); available in English and Indonesian
- Optional proxy, DNS-over-HTTPS and custom User-Agent for sites your provider blocks
- Optional Discord Rich Presence (off by default, never shown for adult sources or in incognito)

## Download

Get the latest version from **[GitHub Releases](https://github.com/mataneorg/matane/releases)**. Beta versions are marked "Pre-release".

### The first time you open it

Matane is not code-signed yet, so your system will show a warning. This is expected:

- **Windows:** "Windows protected your PC" → click **More info** → **Run anyway**.
- **macOS:** open the dmg and drag Matane to Applications. The first launch is blocked ("cannot verify the developer" / "is damaged"): open **System Settings → Privacy & Security** and click **Open Anyway**, or run `xattr -dr com.apple.quarantine /Applications/Matane.app` in Terminal.
- **Linux:** make the AppImage executable (`chmod +x Matane-*.AppImage`, or right-click → Properties → "Allow executing") and run it. Some distributions need `libfuse2`.

### Where is my data?

- **App data** (library, progress, settings): `~/.config/Matane` on Linux, `%APPDATA%\Matane` on Windows, `~/Library/Application Support/Matane` on macOS.
- **Downloads:** `Documents/Matane`, unless you pick another folder.
- **Privacy:** nothing is sent anywhere except requests to the sources you use and the update check against GitHub releases.

## How do I get manga?

Matane gets its manga from **extensions**, small add-ons that each connect to one source. Extensions are published in **repositories**, and a repository is just a URL.

1. Get the URL of an extension repository from a source you trust.
2. In Matane, open **Extensions** and add the repository.
3. Install the sources you want, then browse and read.

Extensions run in a sandbox and ask your permission before reaching a website. Repositories are signed, so Matane can tell if one was tampered with. The full walkthrough is in the [user guide](https://mataneorg.github.io/matane/).

## Support the project

Matane is free and made in spare time. If it makes your reading nicer and you would like to help keep it going, a donation is very welcome (and never expected).

<p align="center">
  <a href="https://saweria.co/PakdeKun"><img alt="Support on Saweria" src="https://img.shields.io/badge/Donate%20via-Saweria-F7931E?style=for-the-badge"></a>
</p>

Other ways to help, all free:

- Star the repository
- [Report bugs](https://github.com/mataneorg/matane/issues/new/choose) or [suggest features](https://github.com/mataneorg/matane/issues/new/choose)
- Tell a friend who reads manga

## Help and documentation

- **[User guide and FAQ](https://mataneorg.github.io/matane/)**: installing, library, reader, downloads, backup, network settings
- **[Changelog](CHANGELOG.md)**: what changed in each version
- **[Report a problem](https://github.com/mataneorg/matane/issues/new/choose)**: in Settings → Advanced, "Copy debug info" gives you details to paste into the report (without your home folder or tokens)

## For developers

Want to build Matane from source, fix a bug or write an extension? Everything is in **[DEVELOPMENT.md](DEVELOPMENT.md)**: setup, commands, project layout, how the app works, testing and releases. Also see [`CONTRIBUTING.md`](CONTRIBUTING.md) and the [extension guide](https://mataneorg.github.io/matane/extensions/).

## License

Matane is released under the [GPL-3.0](LICENSE). The extension SDK, runtime and CLI (`packages/extension-*`) are [MIT](packages/extension-sdk/LICENSE).

## Disclaimer

Matane does not host, store or distribute any manga or other content, and the developers have no affiliation with any content available through third-party extensions. The main repository only ships extensions for services that allow it. Please respect the creators and the laws of your country.
