# 7. Catppuccin palette

Status: Accepted (2026-09-23)

## Decision
Themes use Catppuccin via `@catppuccin/tailwindcss`: Mocha (default dark), Latte (light), Frappé, Macchiato and an AMOLED variant (Mocha with pure black surfaces). The accent is one of the 14 Catppuccin accents (default Mauve) set through `data-accent`; text on the accent uses crust (base on Latte). Semantic tokens follow shadcn/ui naming (`apps/desktop/src/renderer/src/styles.css`).

## Consequences
Components never hardcode hex colors; they use semantic tokens or `ctp-*` utilities.
