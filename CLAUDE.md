# CLAUDE.md — Cite-Wide

Project-level primer for AI assistants (and humans) working in this repo.
Read this before making non-trivial changes. The reminder docs in
`context-v/reminders/` are the source-of-truth for specific topics; this file
points at them.

## What This Is

**Cite-Wide** is an Obsidian community plugin for vault-wide citation
management. It converts numeric footnotes into stable hex IDs, extracts
citations from URLs via the Jina.ai Reader API, and writes per-citation
markdown files with rich frontmatter for Dataview queries.

User-facing feature surface and screenshots: see `README.md`.

## Status

- **Submitted to the Obsidian community plugin store and rejected** for
  insufficient type safety (explicit `any` usage). A type-safety pass is the
  current top priority before re-submission.
- Active development happens on the `development` branch; `master` is the
  release/PR-target branch.
- `manifest.json` and `versions.json` track the published Obsidian plugin
  version; do not bump them manually — `pnpm version` runs `version-bump.mjs`.

## Type Safety — Read This First

This is the load-bearing contract for the codebase. Full rules and patterns:

> **`context-v/reminders/Obsidian-Type-Safety.md`**

Headlines:

1. **No `any` anywhere.** The Obsidian review bot runs
   `@typescript-eslint/no-explicit-any` and rejects PRs that violate it.
   Disabling the rule is itself a rejection reason.
2. **`tsconfig.json` is already maximally strict** (`strict: true` plus every
   individual flag). Do not weaken any flag to make code compile — fix the
   code.
3. **Use `unknown` + narrow** for external data (network responses, YAML
   frontmatter, undocumented Obsidian APIs). Type predicates (`v is string`)
   are the canonical narrowing tool.
4. **YAML frontmatter is treated as untrusted input.** Content creators write
   inconsistent value shapes (string-where-array-expected, number-where-string-expected,
   etc.). Coerce at the boundary with small `asString` / `asNumber` /
   `asStringArray` helpers; types inside the codebase remain strict.
5. **Use Obsidian's frontmatter APIs**, not regex:
   - Read: `this.app.metadataCache.getFileCache(file)?.frontmatter`
   - Read+write: `this.app.fileManager.processFrontMatter(file, fn)`
   - The hand-rolled regex parser at `src/services/citationFileService.ts:404`
     is being retired; do not extend it.

## Repository Layout

```
cite-wide/
├── main.ts                    Plugin entry; command registration; Modal classes
├── manifest.json              Obsidian plugin manifest (id, version, minAppVersion)
├── versions.json              Plugin → minAppVersion compatibility map
├── styles.css                 Plugin-injected CSS (modal + reference panel)
├── esbuild.config.mjs         Bundler config (main.ts → main.js)
├── version-bump.mjs           Version sync helper run by `pnpm version`
├── tsconfig.json              Maximally strict; do not weaken
├── src/
│   ├── services/              Business logic; one class per concern
│   │   ├── citationFileService.ts          Per-citation markdown files; YAML I/O
│   │   ├── urlCitationService.ts           Jina.ai Reader API client
│   │   └── cleanReferencesSectionService.ts
│   ├── utils/
│   │   └── logger.ts          Plugin-scoped logger (LogEntry, addEntry, etc.)
│   └── types/
│       └── obsidian.d.ts      Augments Obsidian's d.ts for undocumented APIs
├── examples/                  Dataview query examples for users
├── context-v/                 Project context for AI/human collaborators
│   ├── changelogs/            Per-day changelog entries (YYYY-MM-DD_NN.md)
│   └── reminders/             Topic-specific source-of-truth docs
└── README.md                  User-facing feature documentation
```

## Build, Dev, and Local Install

```bash
pnpm install
pnpm dev                       # esbuild watch mode → main.js
pnpm build                     # tsc -noEmit -skipLibCheck && esbuild production
pnpm version                   # bumps version + syncs manifest.json/versions.json
```

To exercise the plugin in a live Obsidian vault, symlink the repo into the
vault's plugin folder:

```bash
ln -s /absolute/path/to/cite-wide /absolute/path/to/vault/.obsidian/plugins/cite-wide
```

Reload Obsidian and enable in Community Plugins → Installed.

## Conventions

### Changelogs

Per-day entries in `context-v/changelogs/` named `YYYY-MM-DD_NN.md`. Frontmatter
schema mirrors `astro-knots/sites/calmstorm-decks/context-v/changelogs/`. See
`context-v/changelogs/2026-05-01_01.md` for the canonical example.

Sections in order: **Why Care?** → **What Was Built / Updated** →
*(optional)* **What Changed in Approach** → **Open Items** → **Files Touched** →
**Reference**.

### Git commit style

Type-scoped imperative messages: `update(packages):`, `fix(command):`,
`improve(styles):`, `feat:`, `add(feature):`. Match the project's existing log
when in doubt (`git log --oneline -20`).

### Branch model

`development` (active) → PR → `master`. Do not commit directly to `master`.

## Known Open Questions

These are deliberate non-decisions. Surface them when relevant rather than
silently picking a side:

1. **Unused dependencies.** `fastify`, `@modelcontextprotocol/sdk`, and `zod`
   appear in `package.json` but a `grep` of `src/` and `main.ts` finds zero
   imports. They were added in commit `644582d` and never wired in. An
   Obsidian plugin runs in Obsidian's Electron host with no HTTP server, so
   `fastify` is structurally suspect. **Decision pending:** confirm and
   remove, or wire them into a feature.
2. **Major dependency bumps held back** as of 2026-05-01: `typescript 5.8 → 6`,
   `eslint 9 → 10`, `zod 3 → 4`, and `@types/node` (intentionally pinned to
   22.x to match local Node runtime). See changelog `2026-05-01_01.md`.
3. **No eslint config exists locally.** The deps are installed but
   `.eslintrc*` / `eslint.config.*` are absent. The review bot's rules are
   the first place `no-explicit-any` runs. A flat-config eslint that mirrors
   the bot is a near-term need; see §4 of the type-safety reminder.
4. **`src/types/obsidian.d.ts` is partially redundant.** Some interface
   augmentations (e.g. `MarkdownView.file`, `MarkdownView.editor`) duplicate
   declarations already in upstream `obsidian.d.ts`. The remaining genuine
   shim (`App.commands`) is currently typed `any` and needs replacement.

## When Working in This Repo

- Default to `unknown` over `any` for any value you can't fully type. If you
  catch yourself reaching for `any`, re-read the type-safety reminder before
  continuing.
- Treat YAML frontmatter coming back from Obsidian as `Record<string, unknown>`
  regardless of what `obsidian.d.ts` claims. Coerce per field.
- Touching `package.json` or `pnpm-lock.yaml`? Add a changelog entry under
  `context-v/changelogs/`. Dependency drift without a written record is what
  prompted this convention.
- Touching `manifest.json` or `versions.json`? Use `pnpm version`; do not edit
  by hand.
- Confirm the build still passes: `pnpm build` should complete with no
  TypeScript errors and no esbuild warnings.
