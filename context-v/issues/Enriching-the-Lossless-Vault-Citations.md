---
title: "Issue: Enriching the Lossless Vault's 75 Citations with Promotion's Metadata Pipeline"
lede: "We ran the new canonical-source pipeline over every citation in the vault. It filled 49 reference texts and 63 publishers, and found five bugs."
summary: "Journey log for the 2026-10-06 bulk enrichment of /Users/mpstaton/content-md/lossless/Citations using cite-wide's own tier-1/tier-2/brand code, run from Node. It records the method, the before/after coverage, the five failure classes and the plugin fixes each produced (b545ca4, 4a388e2), the line-level write discipline, and the citations that still need a human (11 orphans, 7 dead or blocked links). Read it before running a bulk pass again or extending promotion."
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
site_uuid: 2e755952-4bfc-4d73-b33c-482abb3e5fa4
hex_code: zgv6x2
status: Resolved
tags:
  - Issue
  - Issue-Resolution
  - Citations
  - Canonical-Sources
  - Metadata-Extraction
---

# Issue: Enriching the Lossless Vault's 75 Citations

## Why Care?

A third of the vault's citation files were empty shells, and the rest held little more than a title and a URL. Before trusting "Promote to canonical source" with the few sources that matter most, we ran its metadata pipeline over **every** citation in the vault and watched what broke. Five things did, all now fixed in the plugin. The citations came out far richer.

## What changed in the vault

| Field | Before | After (of 75) |
|---|---|---|
| title | 50 | **64** |
| url | 50 | **64** |
| date | 32 | **51** |
| author | 43 | 48 |
| source | 50 | 63 |
| referenceText | 0 | **49** |
| publisher / date_published / authors | 0 | 63 / 51 / 48 |
| piece_og_image | 0 | 38 |
| publisher favicon / app icon / logo / brand color | 0 | 49 / 35 / 22 / 22 |

No file was marked `canonical: true`; promotion stays a deliberate choice. A backup of the original 75 files is at `~/content-md/_backups/Citations-2026-10-06-before-enrichment/`.

## Method

1. **Backup**, verified identical with `diff -rq`.
2. **Recover footnotes.** For each file, look for the `[^id]:` definition in the notes listed in `filesUsedIn`, falling back to a vault-wide search. This recovered 14 of the 25 empty files.
3. **Fetch with the plugin's own code.** esbuild bundled `canonicalSourceService` and `directFetchService` for Node, with `obsidian` aliased to a shim whose `requestUrl` wraps global `fetch` (browser user agent, 25 s timeout). Four workers handled 64 URLs in about 90 s. Results:
   - 44 pages read by tier 1
   - 20 failed tier 1
   - 42 needed Jina, because tier 1 left the title or authors empty
4. **Fill only what's empty or junk.** Light fields are filled when empty, or when they hold a junk title. Schema fields are added only when absent.
5. **Write line by line, never round-trip.** A first attempt that re-serialized the whole frontmatter through PyYAML restyled untouched lines: quote style, list indent, quoted timestamps. The writer now replaces only the target lines and appends new keys in the file's own list indent. Each file is then re-parsed and asserted: untouched keys unchanged, updates present, body byte-identical. It was applied to a copy first; the vault was then confirmed identical to that copy.

## What broke, and the fixes

| # | Symptom | Cause | Fix |
|---|---|---|---|
| 1 | Jina's "Just a moment…" would have replaced a good stored title | The bot-check guard covered tier 1 only | One `isJunkTitle()` applied to tier 1, tier 2, and stored values; a junk Jina response makes tier 2 return null (b545ca4) |
| 2 | Stored titles like "Page not found \| MRU", "This qatalog.com page can't be found" | Older URL extraction wrote error pages as titles | Junk stored titles count as empty and can be replaced (b545ca4) |
| 3 | Title "Asana" | Asana's `og:title` is its site name | A tier-1 title equal to the site name is ignored (b545ca4) |
| 4 | `What BMW&rsquo;s Corporate VC…` | The decoder ported from Metafetch knew only a few entities | Named-entity table (b545ca4); **Metafetch has the same gap** |
| 5 | A whole markdown link filed as an author | A stray `[^o7r24s]` inside the link text broke the link match | `parseFootnote` strips inner markers; authors can't be links or URLs (4a388e2) |

## Still needs a human

**11 orphan citation files (removed 2026-10-06 at the operator's call, moved to `~/.Trash/Citations-orphans-2026-10-06/`; copies are also in the backup).** These are files whose footnote definition no longer exists anywhere in the vault: the citation was inserted but never defined, or the definition was later deleted.

| File | Cited in |
|---|---|
| 2k7i3j, arjyx1, uv8sfv | iFly AGM notes.md |
| e2kfhb, h5o9du, xaz7sh | projects/Augment-It/Philosophy/Our-Approach.md |
| 3l14s3 | Vocabulary/Relational Database.md |
| 569gqp | Beautiful Soup.md |
| bsq8de | client-content/Hypernova/Portfolio/Trela.md |
| y0ml1v | FP&A.md |
| yxqi06 | Tooling/Software Development/Databases/ChromaDB.md |

**7 dead or blocked links**, where both tiers failed:

| File | Problem |
|---|---|
| f60i4f | Typo in the footnote URL: `claude-code-pluginsx` should be `claude-code-plugins` |
| jv6cq1 | The stored URL ends in a stray `)` from older extraction |
| oq9mgf | Business Insider article returns 404 |
| 0kal5f | Mount Royal University page returns 404 (the title was recovered from the footnote) |
| 0040jx, o8ltr6 | Silicon Valley Invest Club posts: "Publication Not Available" |
| 8j90if | logto.medium.com sits behind a Cloudflare bot check |

## Second pass: the orphans that weren't, stale paths, and junk authors

**Most of the vault is symlinks.** `Vocabulary`, `Tooling`, `projects`, `client-content`, `Sources`, `concepts` and others link into `lossless-monorepo/content/`. The search used to declare "orphans" did not follow symlinks (ugrep `-r`, and Python `os.walk` without `followlinks=True`). It saw 1,281 of 6,079 notes. Six of the eleven "orphans" had real footnotes in renamed or moved notes. They were deleted at the operator's instruction, restored from the Trash, and enriched. Only `y0ml1v`, `yxqi06`, and the three iFly topic markers (empty definitions) were truly orphaned.

**Paths go stale; wikilinks don't.** `filesUsedIn` stored plain paths, and 21 citation files pointed at notes that had since been renamed or moved ("Relational Database.md" → "Relational Databases.md", "projects/Augment-It/…" → "projects/Context-Vigilance/…"). The plugin now writes `filesUsedIn` / `cited_in_files` as wikilinks, which Obsidian rewrites on rename (bc097ea). The vault's 68 resolvable citation files were migrated to wikilinks pointing at the notes that use them today.

**Author is the dirtiest field.** 23 stored light authors, from older URL extraction, were not names. Examples: reading times ("3 minutes"), fragments ("completing the action below."), lowercase phrases ("training data"), link debris, and a CMS placeholder ("Super User"). Promotion now accepts only name-shaped authors and splits "X on Platform" and comma-joined bylines (1069316). In the vault, 20 junk authors were emptied and 4 replaced with real names from the page or footnote. The `authors` lists added in pass one were rewritten from the clean values. Re-running the cleanup is a verified no-op.

## Lessons for the next pass

- **Treat every fetched title as suspect.** Bot checks and error pages come back as HTTP 200 with a plausible-looking title, from both direct fetches and readers like Jina.
- **Big publishers block everyone.** The NYT, The Economist, and Scribd blocked plain fetches; Firecrawl refuses the NYT outright. For sources that matter, a direct PDF link or a built-in brand table beats scraping.
- **The footnote is often the best source.** For blocked pages, the human-written footnote carried the correct title, date, and publisher.
- **Never round-trip YAML.** Write line by line and assert.
- **Follow symlinks** in any vault-wide search, and dedupe by real path.
- **Store note references as wikilinks**, never paths: the operator renames notes often.
- **Validate authors** like titles. A string in an author field is not evidence of a name.
