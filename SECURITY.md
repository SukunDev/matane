# Security policy

Matane runs third-party extensions in a sandbox (QuickJS in a separate process, network only through the app, over http(s)). Bugs that let an extension or a website escape that — read files, reach the local system, run code in the app — are security issues.

## Reporting

Please **do not open a public issue**. Report privately through GitHub: **Security → Report a vulnerability** on [SukunDev/matane](https://github.com/SukunDev/matane/security/advisories/new). Include the version (Settings → About), your OS, and steps or an extension that shows the problem.

You should get an answer within a week. Fixes ship in the next release; the advisory is published once users can update.

## Supported versions

Only the latest release (currently the 0.1 betas) gets security fixes.
