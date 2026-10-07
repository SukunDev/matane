# FAQ and troubleshooting

## Is Matane legal? Where does the content come from?

Matane is a reader. It does not host, upload or distribute any manga. Sources are provided by extensions, which read websites on your behalf, just like a web browser. Which sources you use, and whether that is allowed where you live, is up to you. Support the creators: buy the books and use official platforms when you can.

## A source shows an error or no chapters

1. Press **Try again**. "Cloudflare check required": press **Verify** and complete the check in the window that opens.
2. In Indonesia and other countries that block sites by DNS, turn on [DNS-over-HTTPS](./network).
3. Check **Extensions → ⋮ → View logs** for the failing request.
4. Update the extension. If it still fails, report it to the extension's repository (not Matane's).

## Matane cannot reach anything

Settings → Network → **Test connection**. A proxy or DNS-over-HTTPS setting that does not work here is the usual cause; set the proxy to **System** and DNS-over-HTTPS to **Off** to rule them out.

## Images load slowly or the strip jumps

Turn on **Split tall pages** (Settings → Reader), lower **Preload pages** on a slow connection, and give the page cache more space in Settings → Data & storage.

## Windows or macOS says the app is unsafe

The builds are not code-signed yet. See [Install](./install#windows) for "Run anyway" (Windows) and "Open Anyway" (macOS).

## Where are my files? How do I uninstall completely?

See [Where your data is](./install#where-your-data-is). Uninstalling keeps your library; delete the data folder (and the download folder) to remove everything. Make a [backup](./backup) first if you may come back.

## Reporting a bug

1. **Settings → Advanced → Copy debug info.** It copies the versions, how Matane was installed, your extensions and the last 100 log lines, with your home folder, user name and URL tokens removed. Read it before you share it.
2. Set **Log level** to **Debug**, reproduce the problem, and copy the debug info again for more detail.
3. Open an issue at [github.com/mataneorg/matane/issues](https://github.com/mataneorg/matane/issues/new/choose) and paste it.

If Matane crashes, Settings → Advanced → **Crash reports** opens the folder with the crash dumps. They never leave your computer unless you attach them.

Security problems: please report them privately, as described in [SECURITY.md](https://github.com/mataneorg/matane/blob/main/SECURITY.md).

## Does Matane collect data?

No. There is no telemetry or analytics. Matane only talks to the sources you use, the repositories you added, GitHub (update checks), and Discord on your computer if you turned on Rich Presence.
