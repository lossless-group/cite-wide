---
title: "Plan — Upgrade Cite Wide to Obsidian 1.13 (0.3.0)"
lede: "Cite Wide's commands stopped loading on Obsidian 1.14 and pnpm 12 wouldn't build it. One pass gets it loading, building, searchable, and tested."
summary: "Execution plan for Cite Wide 0.3.0: find and fix why commands no longer load on Obsidian 1.14, move to the current toolchain, add a zero-dependency test suite (command registration + settings definitions), rebuild the settings tab on getSettingDefinitions(), raise minAppVersion to 1.13.0, and document. Follows the family plan in content-farm/context-v/plans/Migrate-Plugin-Family-to-Obsidian-1-13.md; status moves to Shipped when verified in Obsidian."
publish: true
date_created: 2026-10-06
date_modified: 2026-10-06
date_authored_initial_draft: 2026-10-06
date_authored_current_draft: 2026-10-06
date_authored_final_draft:
authors:
  - Michael Staton
augmented_with:
  - Claude Code on Claude Opus 5.5
at_semantic_version: 0.0.0.1
site_uuid: a7cf391e-fc70-4708-8284-61b8be5ee9ac
hex_code: h1cfx6
status: Implementing
tags:
  - Plan
  - Obsidian-Plugin
  - Obsidian-1-13
  - Release-0-3-0
---

# Plan — Upgrade Cite Wide to Obsidian 1.13 (0.3.0)

## Why Care?

Cite Wide's commands vanished from the command palette on Obsidian 1.14. The 14 commands were: hex citations, URL dedupe, LLM-research parsing, and reference cleanup. A citation tool you can't invoke is no tool at all. Separately, `pnpm build` failed under pnpm 12, so the plugin couldn't be rebuilt to fix anything.

This plan gets Cite Wide loading, building, and tested on Obsidian 1.13+, and brings it level with Image Gin 0.3.0.

## What we know so far

- **The build** is fixed in `230a5ee`. pnpm 11+ ignores the `"pnpm"` block in `package.json`, so the security overrides and build-script settings moved into Cite Wide's own `pnpm-workspace.yaml`. That file lists only this plugin; it's a settings file, not a shared workspace. CI's pnpm 10 still installs from the frozen lockfile.
- **The missing commands are not yet explained.** The built `main.js` (2026-08-18) loads under Node with a stub of Obsidian's API, and `onload()` registers all 14 commands. The cause is something only real Obsidian 1.14 does. The developer-console error from a plugin reload will name it.
- **Installation:** the vault loads Cite Wide through a symlink to this repo, so `main.js` here is what Obsidian runs.

## Steps

| # | Step | Done when |
|---|---|---|
| 1 | **pnpm settings** in the plugin's own `pnpm-workspace.yaml` | `pnpm build` passes on pnpm 12; `CI=true pnpm@10 install --frozen-lockfile` passes ✅ `230a5ee` |
| 2 | **Toolchain:** `obsidian` 1.13.1, ESLint 10.12, typescript-eslint 8.71.1, eslint-plugin-obsidianmd 0.4.2 (the review-bot rules), esbuild 0.28.2. TypeScript held at 6.0.3, `@types/node` held on 22. | ✅ `2005c58` |
| 3 | **Tests:** the zero-dependency harness (esbuild + `node:test`), copied into this repo, plus two red-first specs | ✅ `599e13b` |
| 3a | `onload()` registers every command | ✅ 14/14 register (also against a stub mirroring 1.14.4's real `loadPlugin`) |
| 3b | Settings definitions | ✅ |
| 4 | **Missing-commands fix:** root cause from the console error, or from auditing `onload()` against the 1.13 types | ⏳ No code cause found: the 1.14.4 runtime (`app.js`) was audited and every command registers in tests. Leading theory: the vault ran a stale `main.js` while pnpm 12 couldn't rebuild (fixed in `230a5ee`; rebuilt). Confirmed or refuted by step 7. |
| 5 | **Settings tab** on `getSettingDefinitions()`; `minAppVersion` 1.13.0; version 0.2.3 → **0.3.0** in `manifest.json`, `package.json`, and `versions.json` | ✅ `e5c500d` |
| 6 | **Docs:** README (minimum version, anything stale), changelog entry, `changelog/releases/0.3.0.md` | ✅ `524eb4a` |
| 7 | **Verify in Obsidian:** quit (Cmd+Q) and reopen, confirm the 14 commands, search "Jina" in Settings | The operator confirms |
| 8 | **Release** (gated on the operator): fast-forward `development` → `main` → `master`, tag `0.3.0`, verify assets and attestations | Release live |

### Commands that must register

`show-citations`, `dedupe-citations-by-url`, `parse-llm-citations`, `paste-llm-content`, `save-all-hex-citations`, `convert-all-citations`, `insert-hex-citation`, `convert-selected-citation-to-hex`, `clean-references-section`, `convert-citation-section-to-footnotes`, `format-citations-punctuation`, `lift-table-citations`, `extract-citation-from-url`, `format-reference-links`

### Settings rows that must carry over

- Jina.ai API key (optional), bound to `jinaApiKey`
- Citations folder, bound to `citationsFolder`: becomes a `folder` control
- Auto-save URL citations, bound to `autoSaveUrlCitations`

## Gates (before every code commit)

- `pnpm test`
- `tsc -noEmit -skipLibCheck`
- ESLint at **0 errors and 0 warnings**
- `node esbuild.config.mjs production`
- `CI=true pnpm@10 install --frozen-lockfile`

## Stand-alone rule

Cite Wide installs, builds, tests, and releases on its own. The test harness and ESLint config are **copied** from Image Gin, never imported or referenced across repos.

## Related

- `content-farm/context-v/plans/Migrate-Plugin-Family-to-Obsidian-1-13.md`: the family plan
- `image-gin/context-v/plans/2026-10-06_Migrate-Settings-Tab-to-Obsidian-1-13-Declarative-API.md`: the reference migration
