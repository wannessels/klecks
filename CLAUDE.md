# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Klecks is a browser-based painting app (the open-source release of [kleki.com](https://kleki.com)). It builds in two flavors from the same source:
- **Standalone** (`src/index.html` → `src/app/script/main-standalone.ts`) — full app, used at kleki.com.
- **Embed** (`src/embed.ts` → `src/app/script/main-embed.ts`) — reduced-feature widget for hosting on other sites (see `examples/embed/`).

The codebase is pure TypeScript + DOM (no framework — no React/Vue). UI is built by composing classes that own raw `HTMLElement`s. Bundling is Parcel; styling is SCSS + module SCSS.

## Common commands

```
npm ci                 # install (must run first)
npm run lang:build     # generate language files — REQUIRED before start/build
npm run start          # dev server (Parcel)
npm run build          # production build of standalone → /dist/
npm run build:embed    # production build of embed → /dist/
npm run build:help     # help page (the "?" modal) → /dist/
npm run lang:build -- --missing   # also lists untranslated keys
npm run lang:add <code>           # scaffold a new language file
```

`lang:build` is mandatory after any change under `src/languages/` — Klecks won't run with stale generated files. There is no test runner and no linter wired into npm scripts; do not invent `npm test` / `npm run lint`.

`.npmrc` sets `ignore-scripts=true`, so dependency postinstall scripts won't run — keep that in mind when adding deps.

## Architecture

### Layered source layout (`src/app/script/`)

- `bb/` — "bitbof base": low-level, app-agnostic helpers (math, color, DOM, input, transforms). Anything generic enough to be reused outside Klecks lives here. Exported through `bb/bb.ts` as `BB`.
- `fx-canvas/` — WebGL filter engine (forked from glfx.js). Used by the WebGL-flagged filters. `filters/unused/` is excluded from tsconfig.
- `klecks/` — the painting app itself. This is where most domain logic lives:
  - `canvas/kl-canvas.ts` — the layered drawing surface (the document being painted).
  - `brushes/` + `brushes-ui/` — brush implementations (pen, blend, sketchy, pixel, chemy, smudge, eraser) and their tool-tab UIs. Registered in `brushes/brushes.ts`.
  - `filters/` — image filters (blur, curves, distort, perspective, transform, etc.). Registered in `filters/filters.ts` as `FILTER_LIB`; dialogs/apply functions are loaded lazily via `filters-lazy.ts`.
  - `history/` — undo/redo. `KlHistory` stores diff entries plus a `composed` snapshot; `KlHistoryExecutor` applies them. `HISTORY_TILE_SIZE = 256` is wired to IndexedDB layout — do not change.
  - `storage/` — IndexedDB persistence (`kl-indexed-db.ts`), tab-recovery (`kl-recovery-manager.ts`), PSD import/export (`psd.ts`, `kl-canvas-to-psd-blob.ts`, `load-ag-psd.ts`), save-to-disk.
  - `ui/easel/` — the viewport/canvas-interaction layer. The `Easel` owns pointer input and dispatches to per-tool `Easel*` strategies (brush, hand, eyedropper, paint-bucket, gradient, text, shape, rotate, zoom).
  - `ui/` (rest) — components, modals, tool tabs, mobile UI, project viewport.
  - `select-tool/`, `transform/`, `image-operations/` — selection + non-filter image ops (shape draw, text render, etc.).
  - `kl.ts` re-exports the broad `KL` surface; `kl-types.ts` holds the shared types; `kl-config.ts` holds tunables.
- `app/kl-app.ts` — the top-level orchestrator. It wires Easel, history, storage, recovery, tool/layer/color UI, and import/export together. Both entrypoints (`main-standalone.ts`, `main-embed.ts`) construct a `KlApp`.
- `embed/` — embed-specific bootstrap + the slimmer toolspace top row.
- `language/` — runtime translation (`LANG(...)`) loader. The language files it consumes are emitted by `npm run lang:build`.
- `theme/`, `polyfills/` — dark/light theming and legacy-browser polyfills (target list is wide; see `browserslist` in `package.json`, which includes Chrome 61 / iOS Safari 9).

### Key cross-cutting concepts

- **History is the source of truth for the document.** Drawing operations push entries to `KlHistory`; the canvas state is the composed result. When adding a new operation that mutates the canvas, also push a matching history entry (`history/push-helpers/`) — otherwise undo/redo and recovery will desync.
- **Recovery.** `KlRecoveryManager` periodically serializes the project to IndexedDB so a crashed/closed tab can resume. Don't introduce state that mutates the canvas outside the history/recovery flow.
- **Filters are split across modal + apply.** The static `FILTER_LIB` in `filters/filters.ts` lists metadata only; the actual `getDialog` / `apply` functions are wired in by `importFilters()` (lazy). When adding a filter, register metadata in `FILTER_LIB` and the implementation in `filters-lazy.ts`.
- **Embed vs standalone.** Many features are gated by an `inEmbed` flag (e.g. on `TFilter`). When adding features, decide whether they should be available in the embed and set/check the flag accordingly.
- **Easel is the input router.** New canvas-interaction tools should be implemented as an `Easel*` tool in `ui/easel/tools/` and registered into `KlApp` alongside the existing tools, rather than hooking pointer events directly elsewhere.
- **No framework, no JSX.** UI classes typically expose `getElement(): HTMLElement` and own their subtree imperatively. Follow that pattern when adding components under `klecks/ui/components/`.

### Translations

- `src/languages/_base-en.json5` is the source of truth. Other `<code>.json5` files mirror its keys; any key missing or out-of-sync falls back to English. New keys must be added to `_base-en.json5` first.
- After editing any language file, run `npm run lang:build` (outputs into `src/app/languages` — generated, not hand-edited).
