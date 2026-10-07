---
site_uuid: cb530fc3-fcb9-46dd-8f03-b81793f259cb
hex_code: 5bghmp
title: "Enrich Citations"
lede: "One command fills in every citation's missing title, author, date, publisher, and brand assets — and shows you every change before it writes."
summary: "Spec for cite-wide's 'Enrich all citations' and 'Enrich this citation' commands. They bring the 2026-10-06 one-off enrichment of the lossless vault (scripts run outside Obsidian) into the plugin. The metadata pipeline already exists in canonicalSourceService/directFetchService; this adds the orchestration: footnote discovery through Obsidian's file list, a pure change planner, a review modal, frontmatter writes limited to empty or junk fields, and a run report note."
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
status: Signed-Off
tags:
  - Spec
  - Citations
  - Metadata-Extraction
---

# Enrich Citations

## Why Care?

Citation files fill in slowly and unevenly: whatever a footnote happened to contain, plus whatever an old extraction wrote, junk included. On 2026-10-06 a one-off run over the lossless vault took author coverage from 43 to 70 of 70 and filled 49 reference texts, 63 publishers, and dozens of logos and dates. That run lived in throwaway scripts outside Obsidian. This spec moves it into Cite Wide, so anyone can run it, safely, any time.

See [[Enriching-the-Lossless-Vault-Citations]] for what that run taught us. Every rule below comes from something that went wrong there.

## Commands

| Command | ID | Scope |
|---|---|---|
| Enrich all citations | `enrich-all-citations` | Every `.md` file in the citations folder |
| Enrich this citation | `enrich-this-citation` | The citation under the cursor (`[^id]` or `[^id]:`), or the open file when it lives in the citations folder |

## Pipeline (per citation)

1. **Read** the citation file's frontmatter (`metadataCache`).
2. **Find usage.** Scan the vault's markdown files (`vault.getMarkdownFiles()`, which includes symlinked folders) for `[^id]:` definition lines and `[^id]` uses. Do it once per run, building an index for all citations; never once per citation.
3. **Fetch.** Use the existing functions unchanged: `parseFootnote`, `fetchTier1`, `needsTier2` → `fetchTier2`, `needsPublisherBrand` → `fetchPublisherBrand` + `mergeBrand`, `isYouTubeUrl` → `fetchYouTubeChannel`, then `buildPrefill`. URL precedence follows the prefill.
4. **Plan.** A **pure** function, `planCitationChanges(current, fetched, usage) → FieldChange[]`, where a `FieldChange` is `{ key, from, to, reason }`. No I/O, so it can be fully unit-tested.
5. **Review.** A modal lists the citations with proposed changes, showing old → new per field and a checkbox per citation (all on by default). Nothing is written until the user clicks **Apply**.
6. **Write.** Use `processFrontMatter`, applying only the approved changes.
7. **Report.** Create a note, `<citations folder>/_reports/Enrichment-<YYYY-MM-DD-HHmm>.md`, listing:
   - what changed (counts per field)
   - dead or blocked links (both tiers failed)
   - citations with no footnote anywhere
   - fields still empty

## Planning rules (the load-bearing part)

| Field | Rule |
|---|---|
| `title`, `url`, `date`, `source`, `referenceText` | Fill when empty **or junk** (`isJunkTitle` for titles). Otherwise never overwrite. Entity-encoded titles (`&rsquo;`) are replaced by their decoded form. |
| `author` | Fill when empty, or when the stored value fails `isPlausibleAuthor` (reading times, sentence fragments, link debris). |
| `authors` (list) | Add when absent; replace only when every entry fails `isPlausibleAuthor`. |
| `publisher`, `publisher_url`, `date_published`, `piece_og_image`, `publisher_*` brand fields | Add when absent; never blank a stored value. |
| `date_recently_accessed` | Set when tier 1 succeeded. |
| `filesUsedIn` | The notes that use `[^id]` today, as `[[full/path|Alias]]` (`obsidianLinker`). Replace when the stored list differs and at least one usage was found; keep it when none was found. |
| `canonical` | **Never set.** Promotion stays a deliberate act. |
| everything else | Untouched. |

## Behavior

- **Concurrency:** 4 fetches at a time. A progress notice shows "Enriching 12 / 70…", with a Cancel button that stops before the review step.
- **Re-running is safe.** A second run over an enriched vault proposes zero changes, apart from `date_recently_accessed`, which is excluded from the "has changes" count.
- **Standalone:** no new dependencies; all network calls go through `requestUrl`.

## Acceptance

Tests are written red first:

- **`planCitationChanges`**, against the real cases:
  - an empty file plus a footnote → filled
  - stored junk author "3 minutes" → replaced
  - a real stored title kept over a fetched one
  - "Page not found | MRU" replaced
  - entity title decoded
  - `filesUsedIn` path → `[[full/path|Alias]]`
  - no usage → kept
  - `canonical` never set
  - an already-enriched file → no changes (idempotence)
- **The usage index**, over a stub vault with nested and symlinked-style paths.
- **Report rendering**, as a pure function.
- **The onload test** expects 17 commands.

Gates: `pnpm test`, tsc, ESLint 0/0, and the build. The operator then runs **Enrich all citations** on the lossless vault and expects the review modal to propose little or nothing, since the vault was already enriched by the one-off run.
