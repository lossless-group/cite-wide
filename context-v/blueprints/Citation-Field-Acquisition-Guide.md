---
title: "Citation Field Acquisition Guide — Per-Field Reference for Filling the Lossless Schema"
lede: "The operational reference for the citation acquisition agent. For each field in the Lossless Citation schema: where the value comes from, the cheap path the agent should try first, the expensive path it falls back to, the validation rule, the failure behavior, and the publisher_types that warrant filling it. Designed to be loaded as prompt context for the agent and as a checklist for human reviewers."
date_authored_initial_draft: 2026-05-01
date_authored_current_draft: 2026-05-01
status: Draft
category: Blueprint
applies_to: cite-wide canonicalization pipeline
authors:
  - Michael Staton
augmented_with: Claude Code (Opus 4.7, 1M context)
tags:
  - Field-Reference
  - Acquisition-Specs
  - Agent-Prompt-Context
  - Operational-Guide
sibling_docs:
  - "Lossless-Citation-Standards.md"
  - "Citation-Acquisition-Pipeline.md"
---

> **How to read this doc.** Every field in the Lossless Citation schema gets an entry below, in the same order as the schema sections. Each entry follows the same eight-part template (Source of Truth / Cheap Path / Expensive Path / Fallback / Validation / Applicable Types / Examples / Notes). **Skim by field name on first read; read deeply only the fields you're about to fill.**
>
> **For an AI agent reading this as prompt context:** treat each field's entry as a procedural specification. The Cheap Path is your first attempt. Only escalate to the Expensive Path on cheap-path failure or low confidence. Always honor the Fallback when both paths fail — never invent. Cross-check against the Applicable Types from the matrix in `Lossless-Citation-Standards.md` before emitting.
>
> **For a human reviewer:** this doc tells you where the agent's values came from. Use the Examples and Notes sections to spot-check questionable values.

## Legend

| Symbol / Term | Meaning |
|---|---|
| **Source of Truth** | The canonical origin of this value — where the truth lives if it lives anywhere |
| **Cheap Path** | Deterministic OR meta-tag OR regex extraction; no LLM call required |
| **Expensive Path** | LLM (Claude API), web search, or content download required |
| **Fallback** | What to emit when both Cheap and Expensive fail |
| **Validation** | The rule a downstream consumer applies to decide if the value is valid |
| **Applicable Types** | Subset of `publisher_type` taxonomy where this field is Expected/Optional. See matrix in Standards doc |
| **Examples** | Good and bad value examples |
| **Notes** | Gotchas, edge cases, future-evolution hooks |

---

# Identity Section (Portability Spine pt. 1)

## `internal_uuid`

- **Source of Truth:** generated at capture time. There is no external truth — it's the identifier *we* mint.
- **Cheap Path:** `crypto.randomUUID()` (Node 19+) or any UUID v4 library. Deterministic single line of code.
- **Expensive Path:** N/A — never AI-generated.
- **Fallback:** Hard failure. Phase 1 cannot proceed without this. If RNG is unavailable, the system has bigger problems.
- **Validation:** Must match RFC 4122 v4 regex: `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`. Must be globally unique within the knowledge base (collision probability ~0; treated as impossibility).
- **Applicable Types:** All — Expected for every publisher_type.
- **Examples:**
  - Good: `"3f2504e0-4f89-41d3-9a0c-0305e82c3301"`
  - Bad: `"abc123"` (that's a hexcode, not a UUID)
  - Bad: omitted entirely (violates Spine)
- **Notes:** UUID generation is the cheapest line of code in this entire pipeline. The architectural commitment — to *have* one at capture time — is the load-bearing decision. Without it, every cross-tier move requires entity resolution.

## `reference_hexcode`

- **Source of Truth:** the cite-wide plugin's hex-code generator (`citationService.generateHexId`).
- **Cheap Path:** if caller provides one (the source already has a hex from being referenced in vault), reuse. Otherwise generate via the plugin's existing logic with collision check against the canonical citations folder.
- **Expensive Path:** N/A — purely deterministic.
- **Fallback:** if 5 generation attempts collide, emit error to surface a bug.
- **Validation:** lowercase `[a-z0-9]+`, 6+ chars, must include at least one letter and one digit (per existing plugin convention).
- **Applicable Types:** All — Expected for every canonicalized citation.
- **Examples:**
  - Good: `"a1b2c3"`, `"k7m4q9"`
  - Bad: `"ABC123"` (uppercase)
  - Bad: `"abcdef"` (no digits)
  - Bad: `"123456"` (no letters)
- **Notes:** Hex code is the *vault-facing* identifier (`[^abc123]` markers). UUID is the *system-facing* identifier. Both exist; both matter; they're not redundant.

## `default_slug`

- **Source of Truth:** derived from `title`.
- **Cheap Path:** deterministic transformation of title — lowercase, strip non-alphanumeric except spaces, collapse spaces to single dash, trim. Cap length to ~60 chars at a word boundary.
- **Expensive Path:** AI refinement when the cheap-path slug is awkward (e.g., title is a question with weird punctuation; or the title is non-English; or the deterministic slug collides with an existing one and disambiguation is needed).
- **Fallback:** if title is empty or unusable, fall back to `{publisher-slug}-{hexcode}` form. E.g., `"the-information-a1b2c3"`.
- **Validation:** matches `^[a-z0-9]+(-[a-z0-9]+)*$`. Unique within the canonical-citations folder.
- **Applicable Types:** All — Expected.
- **Examples:**
  - Title: `"Vector Databases Are Dying: Here's the Production Evidence"` → slug: `"vector-databases-are-dying-production-evidence"`
  - Title: `"Why?"` → slug: `"why-{hexcode}"` (too short alone)
  - Title: `"GPT-4 vs Claude 3.5: An Engineering Deep Dive"` → slug: `"gpt-4-vs-claude-3-5-engineering-deep-dive"`
- **Notes:** This is "snake-case" in the user's local terminology, which is conventionally called "kebab-case" (dashes). YAML property names use underscores; slugs use dashes. Don't conflate.

---

# Bibliographic Core

## `title`

- **Source of Truth:** the page's `<title>` tag, OG `og:title`, or Twitter `twitter:title` meta. In rare cases (HTML-as-data sources), the source's structured data.
- **Cheap Path:** prefer `og:title` > `twitter:title` > `<title>` > first `<h1>`. Strip site-name suffixes ("Article Title | Site Name" → "Article Title").
- **Expensive Path:** AI cleanup when the cheap path returns `og:title` that's stuffed with SEO clutter, or when `<title>` is just the publisher name.
- **Fallback:** if no title can be extracted, set to `"Untitled — {first 80 chars of body content}"`. Flag for human review.
- **Validation:** non-empty string. Reasonable length (4-200 chars).
- **Applicable Types:** All — Expected.
- **Examples:**
  - Good: `"Why Smart People Believe Stupid Things"`
  - Acceptable: `"Vector Databases Are Dying: Here's the Production Evidence"`
  - Bad: `"Home | TechCrunch"` (the publisher used `<title>` for the whole site)
  - Bad: `""` (must flag and use fallback)
- **Notes:** Common pattern of "Title | Publisher" in `<title>` tags should be split — keep title, the publisher portion ends up in `publisher`. Be conservative — don't strip if separator is ambiguous.

## `subtitle`

- **Source of Truth:** the source itself when it has one — academic papers, books, market-analyst reports often have explicit subtitles. Often appears in `<h2>` after `<h1>`, or in OG `og:description` for academic sources.
- **Cheap Path:** for academic/working-paper sources, parse the page's structured citation block (DOI metadata, JATS XML if available). For books, the OpenLibrary or Google Books API. For market reports, the report cover page.
- **Expensive Path:** AI to disambiguate `subtitle` from `lede` when only one description meta tag exists and source type is mixed.
- **Fallback:** empty.
- **Validation:** if present, non-empty, distinct from `title`. Reasonable length (5-300 chars).
- **Applicable Types:** Expected for `Academic-Journal`, `Market-Research-Organization`. Optional for `Academic-Working-Paper`, `Think-Tank`, `Government-Agency`. Not Applicable for web-style content (use `lede`).
- **Examples:**
  - Title: `"The Capital Asset Pricing Model"` Subtitle: `"A Critique and Extension"`
  - Title: `"Vector Databases: Market Insights 2026"` Subtitle: `"Growth, Consolidation, and the SaaS Tax Ceiling"`
- **Notes:** **Mutual exclusion with `lede`** — don't fill both for the same source. The matrix dictates which applies; the agent should consult it.

## `lede`

- **Source of Truth:** the source's first paragraph for magazine/blog content, or `<meta name="description">` / `og:description` / `twitter:description`.
- **Cheap Path:** prefer the meta description over a body extraction (they're usually written for syndication and read better). Truncate to ~250 chars at a sentence boundary.
- **Expensive Path:** AI summarization when meta description is missing or unusable. **NOTE — see TODO in Standards doc:** policy not yet decided whether AI-generated `lede` is allowed.
- **Fallback:** empty.
- **Validation:** if present, non-empty, distinct from title. 30-400 chars.
- **Applicable Types:** Expected for `Industry-Media`, `Individual-Researcher`, `Content-Marketing`. Optional for `Content-Creator`. Not Applicable for academic, government, market-research, social-media.
- **Examples:**
  - Good: `"The vector database market is undergoing significant consolidation as major cloud providers add native vector search to their existing data services, squeezing standalone providers."`
  - Bad: `"Read more on TechCrunch."` (template boilerplate, not a lede)
- **Notes:** **Mutual exclusion with `subtitle`.** AI-generated lede policy still TBD — for now, only fill from source-provided text. When source provides nothing, leave empty.

## `authors`

- **Source of Truth:** byline on the article, structured citation metadata for academic, OpenGraph `article:author` or HTML `<meta name="author">`.
- **Cheap Path:** check meta tags first — `<meta name="author">`, `<meta property="article:author">`, JSON-LD structured data, then byline regex (`/^By\s+(.+?)\s*$/m`, `/Written by\s+(.+?)\s*$/`).
- **Expensive Path:** AI parsing of byline strings when multiple authors are joined by commas + "and" + suffixes ("By Erik Brynjolfsson, Bharat Chandar, and Ruyu Chen, Ph.D., Stanford Digital Economy Lab"). The AI splits into individual normalized author names.
- **Fallback:** empty array — leave blank rather than hallucinate.
- **Validation:** array of strings. Each string is `"FirstName LastName"` form. Drop credentials (Ph.D., M.D., etc.) by default — but see TODO.
- **Applicable Types:** Expected for academic, market-research, industry-media, individual-researcher, content-creator, social-media, UGC. Optional for think-tank, content-marketing. Not Applicable for government-agency (use the agency name as `publisher`), data-as-a-service (no individual author).
- **Examples:**
  - Source: `"By Adam Grant"` → `["Adam Grant"]`
  - Source: `"Erik Brynjolfsson, Bharat Chandar, Ruyu Chen"` → `["Erik Brynjolfsson", "Bharat Chandar", "Ruyu Chen"]`
  - Source: `"By Daron Acemoglu, MIT Economics"` → `["Daron Acemoglu"]` (drop affiliation; affiliation isn't an author)
  - Source: anonymous (Reddit thread, "Anonymous" tag) → `[]` empty array
- **Notes:** Suffix policy and affiliation handling — **TODO (human):** confirm whether to keep "Ph.D." / "Dr." or drop. Currently: drop, for cleaner downstream rendering.

## `date_published`

- **Source of Truth:** `article:published_time` meta tag, `og:article:published_time`, JSON-LD structured data, datePublished microdata, or the article's visible date stamp.
- **Cheap Path:** meta tags > structured data > visible HTML (e.g. `<time datetime="...">`) > URL date pattern (some publishers embed dates in URLs: `/2026/04/article-slug`).
- **Expensive Path:** AI to parse human-readable dates from article text ("Published April 2026", "Updated last week"). Resolve relative dates against `date_added`.
- **Fallback:** empty (don't guess).
- **Validation:** ISO 8601: `YYYY-MM-DD`, `YYYY-MM`, or `YYYY`. Sanity check: not in the future; not before 1900 unless `publisher_type` is academic.
- **Applicable Types:** All — Expected.
- **Examples:**
  - Good: `2024-10-15`, `2024-10`, `2024`
  - Bad: `"October 15, 2024"` (use ISO; if you have prose date, parse to ISO before emitting)
  - Bad: `2027-01-01` (in the future, sanity-check fails)
- **Notes:** Missing day is common for older sources, magazines, working papers. Missing month is rare but possible for old archival sources. Renderer must handle gracefully (`"2024"` vs `"October 2024"` vs `"October 15, 2024"`).

## `edition_or_version`

- **Source of Truth:** the source itself — book edition, software version, dataset release tag, journal volume/issue.
- **Cheap Path:** structured-data lookups (Google Books, OpenLibrary, npm registry, GitHub releases API). For papers, parse "Vol. 12, Issue 3" patterns.
- **Expensive Path:** AI to interpret free-form versioning text ("Updated edition", "Second printing").
- **Fallback:** empty.
- **Validation:** if present, non-empty string. No further format constraint (deliberately free-form).
- **Applicable Types:** Expected for `Academic-Journal` (volume/issue), `Data-as-a-Service-Provider` (release version). Optional for academic-working-paper, market-research, think-tank, government-agency. Not Applicable for web content.
- **Examples:**
  - Book: `"Second Edition"`, `"Third Revised Edition"`
  - Journal: `"Vol. 12, Issue 3"` or `"42(7)"`
  - Software/dataset: `"v2.4.1"`, `"2026-Q1 release"`
- **Notes:** Free-form is intentional — we don't want to force `"v2.4.1"` style for books.

---

# Publisher / Source-of-Source

## `publisher`

- **Source of Truth:** OG `og:site_name`, JSON-LD organization name, or convention from URL hostname.
- **Cheap Path:** `og:site_name` > JSON-LD `publisher.name` > hostname-to-known-name mapping (a small hardcoded map for top 50 publishers).
- **Expensive Path:** AI normalization for unknown publishers — given the hostname and a sample of HTML, output the canonical name. ("nyt.com" → "The New York Times".) AI also handles content-creator naming (a Substack URL → the author's publication name, not "Substack").
- **Fallback:** the hostname stripped of `www.` and TLD, Title-Cased. ("substack.com" → not great but better than blank.)
- **Validation:** non-empty string. Reasonable length (3-100 chars).
- **Applicable Types:** All — Expected, except `Individual-Researcher` where it's Optional (a personal blog often *is* the author; `publisher = author_name` works).
- **Examples:**
  - "nytimes.com" → `"The New York Times"`
  - "stratechery.com" → `"Stratechery"`
  - "stratechery.substack.com" → `"Stratechery"` (NOT `"Substack"`)
  - "marginalrevolution.com" → `"Marginal Revolution"`
- **Notes:** This is the most-AI-leveraged field for new sources. A good hostname-to-publisher map covers ~70% of capture volume cheaply.

## `publisher_url`

- **Source of Truth:** the canonical site root (not a section page).
- **Cheap Path:** `https://` + hostname of `first_accessed_at_url`. For multi-publisher platforms (Substack, Medium, GitHub Pages), use the author's specific subdomain or path.
- **Expensive Path:** rarely needed — sometimes JSON-LD provides the canonical org URL when the hostname is misleading.
- **Fallback:** the hostname-derived value (always available).
- **Validation:** valid URL format. HTTPS preferred.
- **Applicable Types:** All — Expected.
- **Examples:**
  - `first_accessed_at_url`: `"https://www.nytimes.com/2024/10/15/article-slug"` → `publisher_url`: `"https://www.nytimes.com"`
  - `first_accessed_at_url`: `"https://stratechery.com/2024/post-slug/"` → `publisher_url`: `"https://stratechery.com"`
  - Substack: `first_accessed_at_url`: `"https://author.substack.com/p/post-slug"` → `publisher_url`: `"https://author.substack.com"` (the author's Substack, not substack.com)
- **Notes:** For DaaS sources, this might be the API platform homepage rather than a content page.

## `publisher_type`

- **Source of Truth:** classification — there's no extractive truth, only the agent's reasoned judgment.
- **Cheap Path:** hostname-to-type lookup table for known publishers. (`nytimes.com` → `Industry-Media`; `nature.com` → `Academic-Journal`; `crunchbase.com` → `Data-as-a-Service-Provider`.)
- **Expensive Path:** Claude tool-use classification with the taxonomy attached as the tool schema. Input: hostname, title, sample of body content. Output: `publisher_type` + confidence + reasoning.
- **Fallback:** `"Other"` — flag for human review.
- **Validation:** must be a Train-Case value from the controlled taxonomy in the Standards doc. Confidence threshold: ≥ 0.7 to be accepted; < 0.7 falls back to `"Other"`.
- **Applicable Types:** All — Expected (it's the classification *of* the type).
- **Examples:** see Publisher and Publication Types table in Standards doc.
- **Notes:** This is the most reasoning-heavy classification step. The taxonomy itself may evolve — when adding new types, update Standards, this Guide, *and* the lookup table simultaneously.

## `publisher_favicon_url`

- **Source of Truth:** the site's favicon link.
- **Cheap Path:** parse `<link rel="icon">` (and variants: `apple-touch-icon`, `mask-icon`). Resolve relative URLs against the site root. Fall back to `{publisher_url}/favicon.ico`.
- **Expensive Path:** for sites that serve favicons via redirects or CDN-only (no link tag), the agent may need to fetch the publisher_url root and re-parse.
- **Fallback:** empty (renderers default to a generic favicon).
- **Validation:** valid URL. Image content-type when fetched (PNG, ICO, SVG).
- **Applicable Types:** Expected for web-rendering-heavy types (Industry-Media, Individual-Researcher, Content-Creator, Social-Media, Content-Marketing, UGC, Government-Agency). Optional for academic, market-research, think-tank, DaaS.
- **Examples:**
  - `"https://www.nytimes.com/favicon.ico"`
  - `"https://stratechery.com/wp-content/themes/stratechery-2017/assets/img/favicon.ico"`
- **Notes:** Many sites serve multiple favicon sizes. The 32x32 PNG is the most-portable default.

---

# Access & Retrieval (Portability Spine pt. 2)

## `first_accessed_at_url`

- **Source of Truth:** the URL the contributor first retrieved from. **This is provided by the caller** — it's not derived.
- **Cheap Path:** caller-provided. Always.
- **Expensive Path:** N/A.
- **Fallback:** if no URL is provided, the agent cannot canonicalize — hard error.
- **Validation:** valid URL with `http://` or `https://` protocol. HTTPS strongly preferred but not required (some archival sources are HTTP-only).
- **Applicable Types:** All — Expected.
- **Examples:**
  - Good: `"https://www.nytimes.com/2024/10/15/article-slug"`
  - Good: `"https://arxiv.org/abs/2406.12345"`
  - Bad: `"www.nytimes.com/article-slug"` (missing protocol)
- **Notes:** **Once set, never changes.** This field is the attribution anchor. URL drift is captured separately in `recently_accessed_at_url`.

## `recently_accessed_at_url`

- **Source of Truth:** the agent's most-recent successful fetch.
- **Cheap Path:** during HTTP fetch, capture the redirect chain. The final URL after all redirects is `recently_accessed_at_url`.
- **Expensive Path:** if the source has moved with no redirect (paywall change, slug rename without 301), AI search to find the new location.
- **Fallback:** equals `first_accessed_at_url` (no drift detected). On unrecoverable drift, prefix with `DEAD:` (e.g. `"DEAD:https://example.com/old-url"`) and flag.
- **Validation:** same as `first_accessed_at_url` (valid URL), or the `DEAD:` prefix form.
- **Applicable Types:** Always Optional — the agent only fills it when drift is detected. Renderers should default to `first_accessed_at_url` when this is empty.
- **Examples:**
  - No drift: equals `first_accessed_at_url`
  - Slug rename: `first_accessed_at_url` was `/2024/10/old-slug`; now `/2024/10/new-slug`
  - Dead: `"DEAD:https://www.example.com/article-that-404s"`
- **Notes:** Drift detection during re-fetches is the agent's job. **TODO (human):** decide if `recently_accessed_at_url` should always mirror `first_accessed_at_url` on first capture (for symmetry / never-empty contract) or only populate on drift.

## `date_added`

- **Source of Truth:** the agent — this is "when did this entry get created in our system."
- **Cheap Path:** today's date in ISO 8601, captured at Phase 1.
- **Expensive Path:** N/A.
- **Fallback:** N/A.
- **Validation:** ISO 8601. Not in the future. Not before 2025 (when this system started).
- **Applicable Types:** All — Expected.
- **Examples:** `"2026-05-01"`
- **Notes:** Set once, never updated. For backfilled imports of older citations, this is the import date, not the original capture date.

## `date_recently_accessed`

- **Source of Truth:** the agent's most-recent successful fetch.
- **Cheap Path:** captured at the time of HTTP fetch.
- **Expensive Path:** N/A.
- **Fallback:** equals `date_added` if no re-fetch has happened.
- **Validation:** ISO 8601. Not in the future. Not before `date_added`.
- **Applicable Types:** All — Expected.
- **Examples:** `"2026-05-01"` (same day as `date_added`); `"2026-08-15"` (re-fetched 3 months later)
- **Notes:** Updates on every successful re-fetch. Lets a downstream consumer know "this archived content might be stale" if `date_recently_accessed` is months ago.

---

# Media

## `piece_og_image`

- **Source of Truth:** OG `og:image` meta tag.
- **Cheap Path:** `og:image` > `twitter:image` > first `<img>` in article body.
- **Expensive Path:** rarely needed.
- **Fallback:** empty.
- **Validation:** valid URL. Image content-type when fetched.
- **Applicable Types:** Expected for `Industry-Media`, `Individual-Researcher`, `Content-Creator`, `Social-Media`, `Content-Marketing`. Optional for academic/think-tank/government/market-research. Not Applicable for DaaS.
- **Examples:** `"https://example.com/article/og-image.jpg"`
- **Notes:** Some publishers serve dynamic OG images per article; others use site-default. Either is valid.

## `piece_thumbnail_url`

- **Source of Truth:** `twitter:image` meta tag (often the smaller variant), or a thumbnail-specific structured-data field.
- **Cheap Path:** `twitter:image` > `og:image:secure_url` > resized OG image > empty.
- **Expensive Path:** rarely needed.
- **Fallback:** equals `piece_og_image` (renderers can downsize at display time).
- **Validation:** valid URL.
- **Applicable Types:** same as `piece_og_image`.
- **Examples:** `"https://example.com/article/thumbnail.jpg"`
- **Notes:** Distinct from `piece_og_image` only when the publisher provides separately-sized variants. Often duplicates the OG image.

---

# API / Structured-Data Provider

## `api_provider_url`

- **Source of Truth:** the API platform's documented base URL.
- **Cheap Path:** lookup table for known DaaS providers (Crunchbase, Pitchbook, Google Books, etc.).
- **Expensive Path:** AI-assisted lookup when the source mentions an API but the agent doesn't know it. Web search.
- **Fallback:** empty.
- **Validation:** valid URL.
- **Applicable Types:** Expected for `Market-Research-Organization`, `Data-as-a-Service-Provider`. Optional for `Academic-Journal`, `Academic-Working-Paper`, `Government-Agency`. Not Applicable for web content.
- **Examples:**
  - `"https://api.crunchbase.com/v4/"`
  - `"https://www.googleapis.com/books/v1/"`
- **Notes:** This field is for sources where the API delivery is *primary* — not where the source happens to also have an API. A NYT article retrieved via the NYT Article API would use the API fields; a NYT article retrieved via web would not.

## `api_provider_name`

- **Source of Truth:** the API platform's branded name.
- **Cheap Path:** same lookup table as `api_provider_url`.
- **Expensive Path:** AI normalization.
- **Fallback:** derive from `api_provider_url` hostname.
- **Validation:** non-empty string.
- **Applicable Types:** same as `api_provider_url`.
- **Examples:** `"Crunchbase API"`, `"Google Books API"`, `"Preqin Data API"`
- **Notes:** Distinct from `publisher` — `publisher` is the source's own brand; `api_provider_name` is the delivery platform's brand. Often different (e.g. an academic paper's `publisher` is the journal, but `api_provider_name` is "Crossref" or "Semantic Scholar").

## `api_source_url`

- **Source of Truth:** the specific endpoint that returned this source.
- **Cheap Path:** the URL the agent retrieved from when canonicalizing via API.
- **Expensive Path:** N/A.
- **Fallback:** empty.
- **Validation:** valid URL. Should start with `api_provider_url`.
- **Applicable Types:** same as `api_provider_url`.
- **Examples:** `"https://api.crunchbase.com/v4/entities/organizations/anthropic"`
- **Notes:** The pair (`api_provider_url`, `api_source_url`) lets a future consumer re-fetch the source via the same API.

---

# Content Archival (Portability Spine pt. 3)

## `downloaded_content_path`

- **Source of Truth:** the agent's filesystem write during Phase 5.
- **Cheap Path:** for HTML, save raw response body. For PDFs, save the binary. For paywalled, save what's accessible (often just the meta tags).
- **Expensive Path:** Jina.ai Reader for cleaned content extraction. Useful when the raw HTML is JS-heavy and needs rendering.
- **Fallback:** empty (no archive). Flag for human review.
- **Validation:** path is relative to the vault root; file exists; not zero bytes.
- **Applicable Types:** Expected for academic, market-research, think-tank, government, industry-media, individual-researcher, DaaS. Optional for content-creator, social-media, content-marketing, UGC.
- **Examples:**
  - `"Citations/_archive/abc123.html"`
  - `"Citations/_archive/abc123.pdf"`
  - `"Citations/_archive/abc123-paywalled.html"` (filename hints at partial)
- **Notes:** Filename convention: `{hexcode}.{ext}`. Folder convention: `_archive/` prefix to keep them visually grouped without cluttering the main Citations listing.

## `structured_data_path`

- **Source of Truth:** Jina.ai Reader output, OR Claude tool-use structured extraction, OR both.
- **Cheap Path:** Jina Reader's cleaned-text output saved as Markdown.
- **Expensive Path:** Claude tool-use to extract a typed JSON object from the cleaned text — title, body sections, key claims, statistics, citations-within-the-source. Used when the source is high-importance (DaaS, academic, market-research).
- **Fallback:** empty. Flag.
- **Validation:** path exists; valid Markdown or valid JSON depending on extension.
- **Applicable Types:** Expected for academic, market-research, think-tank, government, DaaS. Optional for industry-media, individual-researcher. Not Applicable for content-creator, social-media, content-marketing, UGC.
- **Examples:**
  - `"Citations/_archive/abc123.md"` (Jina-cleaned)
  - `"Citations/_archive/abc123.json"` (Claude-extracted)
- **Notes:** **TODO (human):** decide one-or-both convention. Both increases canonicalize cost; one limits downstream consumer flexibility. Lean: both, but JSON extraction only on high-importance types.

---

# Annotation & Cross-Reference

## `cited_in_files`

- **Source of Truth:** the cite-wide plugin's vault index — which markdown files contain `[^reference_hexcode]` markers pointing at this citation.
- **Cheap Path:** plugin maintains this list automatically when it inserts hex citations. The MCP server doesn't fill this; it's plugin-side state.
- **Expensive Path:** if the plugin's index is stale, a vault-wide grep for the hexcode reconstructs it.
- **Fallback:** empty array (the citation exists but isn't yet cited anywhere).
- **Validation:** array of paths relative to the vault root. Each path exists.
- **Applicable Types:** All — managed automatically.
- **Examples:** `["projects/avalanche-thesis.md", "drafts/vector-db-memo.md"]`
- **Notes:** The agent should NOT rewrite this field — it's owned by the plugin's vault-watching logic. The agent emits the citation YAML; the plugin maintains `cited_in_files` over time.

## `tags`

- **Source of Truth:** AI classification — there's no extractive truth.
- **Cheap Path:** hostname-to-default-tags map. (`*.arxiv.org` → `["Academic-Working-Paper", "AI-Research"]`; etc.) Quick wins; doesn't generalize.
- **Expensive Path:** Claude tool-use classification given title + first 500 chars + publisher_type. Output: 3-7 Train-Case tags. Prefer pulling from existing tag corpus (when overlap exists) over inventing new tags.
- **Fallback:** empty array. Flag.
- **Validation:** array of Train-Case strings (`^[A-Z][a-zA-Z]*(-[A-Z][a-zA-Z]*)*$`). Length 3-7 tags. Each tag 3-50 chars.
- **Applicable Types:** All — Expected.
- **Examples:**
  - Source: vector DB market analysis → `["Vector-Databases", "RAG-Pipelines", "Market-Analysis", "Investment-Memo"]`
  - Source: Anthropic Economic Index report → `["Anthropic", "AI-Economics", "Labor-Displacement", "Economic-Index"]`
- **Notes:** **TODO (human):** taxonomy governance — controlled vocabulary or organic? Lean: organic with periodic consolidation. The agent should prefer existing tags but can introduce new when needed.

---

# Open Decisions (TODOs Specific to This Guide)

These TODOs are field-level — they affect specific entries above. Schema-level TODOs are in the Standards doc; pipeline-level TODOs are in the Pipeline doc.

- **TODO (human):** `authors` — keep "Ph.D." / "Dr." suffixes or drop? Currently: drop.
- **TODO (human):** `lede` — allow AI-generated when source provides none? Currently: only source-provided.
- **TODO (human):** `recently_accessed_at_url` — always mirror `first_accessed_at_url` on first capture, or only populate on drift? Currently: only on drift.
- **TODO (human):** `structured_data_path` — Markdown only / JSON only / both? Currently: both for high-importance types.
- **TODO (human):** `tags` taxonomy — controlled vocabulary or organic? If controlled, where is the canonical list? Currently: organic with consolidation passes.
- **TODO (AI):** Build the hostname-to-publisher-name lookup map. Top 50 publishers by capture frequency would handle the majority of cheap-path lookups. Should be a JSON file in the MCP server, periodically updated.
- **TODO (AI):** Build the hostname-to-publisher_type lookup map. Same idea. Same JSON file possibly.
- **TODO (AI):** Build the hostname-to-default-tags map for Phase 4 cheap path.
- **TODO (AI):** When two meta tags conflict (e.g. `<title>` says X, `og:title` says Y), what's the resolution rule? Currently: prefer OG; flag the disagreement.
- **TODO (AI):** Edition/version detection for software/datasets — npm registry / GitHub Releases API integration to add to the cheap path.

# Cross-References

- **Schema definition** (the WHAT this Guide operationalizes): `Lossless-Citation-Standards.md`
- **Pipeline architecture** (the HOW the agent runs phases): `Citation-Acquisition-Pipeline.md`
- **Inline citation format** (the markdown layer): `context-v/reminders/Lossless-Citation-Spec.md`
- **Existing implementations** to reuse: `src/services/urlCitationService.ts` (Jina extract; covers Phase 2 partially), `src/services/citationFileService.ts` (frontmatter writes), `src/services/citationService.ts` (hex generator)
