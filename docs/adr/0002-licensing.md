# 2. GPL-3.0 app, MIT extension SDK

Status: Accepted (2026-09-23)

## Decision
The application is GPL-3.0-only so forks stay open source. `packages/extension-sdk` is MIT so third-party extensions are not bound by the GPL.

## Consequences
Code copied between the SDK and the app must respect the direction of the licenses (MIT → GPL is fine, not the reverse).
