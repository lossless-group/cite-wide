---
site_uuid: 174977b4-e5ae-4728-94a6-63585cb5ff01
hex_code: 0xwh8x
title: "Promote to Canonical Source"
lede: "One command turns a source you'll cite again — a book, a report — into a rich record with its file and full text in your vault."
summary: "Spec for cite-wide's 'Promote to canonical source' command (v1). It upgrades a single hex citation from the light Citations format to the canonical schema in Lossless-Citation-Standards.md, filling the deterministic and metadata-derivable fields in two tiers (a free in-plugin extractor ported from Metafetch, then Jina Reader), downloading the source file, and importing its text as markdown. Phase 2 (specified, not built) adds an AI agent that summarizes and links the source to existing notes and tags. Implements the 'future button' named in Maximize-Data-Collection-on-Cannonical-Sources.md."
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
at_semantic_version: 0.0.1.0
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
   - **Tier 1, the free metadata extractor.** Port Metafetch's `src/services/directFetchService.ts` into Cite Wide as a **copy**, not an import, so each plugin stays standalone. Credit Metafetch in a header comment. It parses `<meta>` tags with no dependencies: Open Graph, `article:*`, `author`, the scholarly `citation_*` tags (including repeated `citation_author`), `<title>`, and the favicon, and normalizes author names and dates. Use one `requestUrl` GET with `throw: false` and a 10 s timeout.
   - **Tier 2, Jina Reader** (`r.jina.ai`, already wired in `urlCitationService`; the key is optional but raises rate limits). Use it when tier 1 leaves the title or authors empty, and always for the text import below. Firecrawl is a possible later provider, behind its own optional key; not in v1.
3. **Confirm in a modal** with these fields prefilled and editable:
   - title
   - subtitle
   - authors, one per line
   - date published
   - publisher
   - publication type: book, report, paper, article, web page, video, or other
   - URL

   Then **Promote** or **Cancel**.
4. **Capture the content** (checkbox in the modal, on by default):
   - **The original file.** If the URL serves a downloadable document (`content-type` PDF, EPUB, DOCX, PPTX, or XLSX, or a URL ending in one of those), save its bytes to `Citations/_files/<id>.<ext>` and record the path in `downloaded_content_path`.
   - **The source text, as markdown.** Import it through Jina Reader, which handles both web pages and PDFs, into `Citations/_text/<id>.md`, a plain note with a backlink to the citation, and record that path in `source_text_path`. If Jina is unavailable, skip the import and say so in the notice; the citation is still promoted.
   - Both are skipped quietly when there's no URL.
5. **Write `Citations/<id>.md`.** Create it or upgrade it in place via `processFrontMatter`. The body is kept if it exists.

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
| `publisher_favicon_url` | tier 1 favicon |
| `downloaded_content_path` | `Citations/_files/<id>.<ext>`, when a file was downloaded |
| `source_text_path` | `Citations/_text/<id>.md`, when text was imported (an addition to the standard: the markdown text, distinct from `structured_data_path`'s JSON) |

**Promoting again is safe.** Write-once fields keep their values, and the user's edits from the modal win over fetched values.

## Phase 2 (specified, not built): the enrichment agent

Once a canonical source has its text, an LLM agent (Claude or GPT, with the operator's key) enriches it. It would be a **separate command**, "Enrich canonical source", so promotion stays fast, free, and deterministic.

- **Summarize** the source into the citation file's body, under `## Summary`.
- **Link it into the vault.** Wikilink the people, organizations, concepts, and tools it mentions, **preferring notes that already exist.** The agent gets an inventory of existing note titles and aliases, and creates a new link only when nothing fits.
- **Tag it, preferring existing tags.** The agent gets the vault's tag list (from `metadataCache`) and reuses tags before inventing new ones. This is also where `publisher_type` and `tags` from the standard get filled.
- **Instructions are a prompt file.** It's bundled in the plugin as the default, and a vault-side override can replace it, following the Perplexed preambles pattern: vault files override, and bundled defaults keep the plugin working on its own.
- Open questions for that phase: which provider and model by default; how large a vault inventory to send (title list vs. retrieval); and whether to show a review diff before writing.

## Out of scope for v1

- The enrichment agent (Phase 2 above).
- AI-only fields (`publisher_type`, `tags`, `edition_or_version`, the `api_*` fields) and `structured_data_path`.
- Firecrawl as a provider.
- Bulk promotion.

## Acceptance

- Tests, red first:
  - footnote parsing on real vault shapes (the OpenCloud report line, a book, a plain URL)
  - the ported tier-1 extractor (multi-author `citation_author`, both attribute orders, entities, favicon)
  - content capture: a PDF response is saved to `_files/` with the right extension; Jina text goes to `_text/` with a backlink; a Jina failure still promotes
  - field assembly (write-once fields kept on re-promote; light keys preserved; `canonical: true` set)
  - command registration (15 commands)
- Every gate: tests, tsc, ESLint 0/0, build, `CI=true pnpm@10 install --frozen-lockfile`.
- Operator check in Obsidian: promote `[^80nyxu]` in `Vocabulary/Open Source Software.md` and inspect `Citations/80nyxu.md`.
