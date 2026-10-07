---
site_uuid: 174977b4-e5ae-4728-94a6-63585cb5ff01
hex_code: 0xwh8x
title: "Promote to Canonical Source"
lede: "One command turns a footnote you'll cite again — a book, a report — into a rich, reusable record in the Citations folder."
summary: "Spec for cite-wide's 'Promote to canonical source' command (v1). It upgrades a single hex citation from the light Citations format to the canonical schema in Lossless-Citation-Standards.md, filling only the deterministic and metadata-derivable fields; AI-required fields and content archival are out of scope. Implements the 'future button' named in Maximize-Data-Collection-on-Cannonical-Sources.md."
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
  - Canonical-Sources
---

# Promote to Canonical Source

## Why Care?

A memo might cite forty sources, but only a handful deserve to live on: the industry report everyone quotes, the book that frames the argument. Today Cite Wide saves every citation the same thin way, a footnote line and a URL. **Promote to canonical source** marks the few that matter and gives them a complete, reusable record, so the next piece that cites them starts with good data instead of a bare link.

This is the "Promote to Canonical Source" button that [[Maximize-Data-Collection-on-Cannonical-Sources]] names as future work. It writes the schema defined in [[Lossless-Citation-Standards]].

## The command

**Promote to canonical source** (command ID `promote-to-canonical-source`) is an editor command.

1. **Find the citation.** The cursor is on an inline `[^id]` or on its `[^id]:` definition line. Otherwise, show a notice and stop.
2. **Gather what's knowable without AI:**
   - **Parse the footnote** for title (a quoted or linked title), URL, year or date, and the trailing publisher/author segments.
   - **Read the existing light file**, if `Citations/<id>.md` exists. Keep its fields and `filesUsedIn`.
   - **Fetch the page's metadata**, if there's a URL. Use one `requestUrl` GET with `throw: false` and parse `<meta>` tags with no new dependency. Read `og:title`, `og:site_name`, `og:image`, `article:published_time`, `author` / `article:author`, and the scholarly tags `citation_title`, `citation_author`, `citation_publication_date`, and `citation_publisher`. A failed or slow fetch (10 s timeout) falls back to the parsed values.
3. **Confirm in a modal** with these fields prefilled and editable:
   - title
   - subtitle
   - authors, one per line
   - date published
   - publisher
   - publication type: book, report, paper, article, web page, video, or other
   - URL

   Then **Promote** or **Cancel**.
4. **Write `Citations/<id>.md`.** Create it or upgrade it in place via `processFrontMatter`. The body is kept if it exists.

## Fields written (v1)

The canonical file **keeps every light-format key** (`hexId`, `title`, `url`, `referenceText`, `usageCount`, `filesUsedIn`, …), so existing Dataview queries in `examples/` keep working. It **adds** these:

| Field | Source |
|---|---|
| `canonical: true` | constant; how queries tell canonical from light |
| `internal_uuid` | generated v4 UUID, **write-once**: never regenerated if present |
| `reference_hexcode` | the citation ID |
| `default_slug` | kebab-case of the title |
| `title`, `subtitle`, `authors` (list), `date_published` (ISO, partial OK) | modal |
| `publisher`, `publisher_url` (site root of the URL) | modal / derived |
| `publication_type` | modal |
| `first_accessed_at_url` | the URL; write-once |
| `date_added` | today; write-once |
| `date_recently_accessed` | today, if the fetch succeeded |
| `piece_og_image` | `og:image` |
| `cited_in_files` | mirrors `filesUsedIn` |

**Promoting again is safe.** Write-once fields keep their values, and the user's edits from the modal win over fetched values.

## Out of scope for v1

- AI-required fields (`publisher_type`, `tags`, `edition_or_version`, the `api_*` fields): left absent for a later agent pipeline.
- Content archival (`downloaded_content_path`, `structured_data_path`): not wanted. Obsidian handles large vaults fine, and the operator doesn't need saved copies.
- Bulk promotion.

## Acceptance

- Tests, red first:
  - footnote parsing on real vault shapes (the OpenCloud report line, a book, a plain URL)
  - the `<meta>` extractor
  - field assembly (write-once fields kept on re-promote; light keys preserved; `canonical: true` set)
  - command registration (15 commands)
- Every gate: tests, tsc, ESLint 0/0, build, `CI=true pnpm@10 install --frozen-lockfile`.
- Operator check in Obsidian: promote `[^80nyxu]` in `Vocabulary/Open Source Software.md` and inspect `Citations/80nyxu.md`.
