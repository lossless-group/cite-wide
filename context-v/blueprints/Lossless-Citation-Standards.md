---
title: "Lossless Citation Standards — Schema, Audiences, Portability Thesis"
lede: "The schema layer of the Lossless citation system: what fields exist, why each exists, which audiences and source types each serves, and how the schema is designed to outlive any one rendering target. This is the WHAT and WHY. For HOW the schema gets filled, see Citation-Acquisition-Pipeline.md and Citation-Field-Acquisition-Guide.md."
date_authored_initial_draft: 2026-05-01
date_authored_current_draft: 2026-05-01
status: Draft
category: Blueprint
applies_to: cite-wide Obsidian plugin + downstream consumers (Investment Memo Orchestrator, future Vector DB / RAG pipelines, multi-site content publishing)
authors:
  - Michael Staton
augmented_with: Claude Code (Opus 4.7, 1M context)
tags:
  - Citation-Schema
  - YAML-Frontmatter
  - Knowledge-Base
  - Portability
  - RAG-Ready
sibling_docs:
  - "Citation-Acquisition-Pipeline.md"
  - "Citation-Field-Acquisition-Guide.md"
---

> **How to read this doc.** Sections are grouped by audience: the **WHY** sections (Thesis, Portability Spine) are mandatory context for anyone — human or AI agent — touching the schema. The **WHAT** sections (Schema, Source-Type Matrix, Audiences) are the actual specification. The **HOW** is deferred to the two sibling docs.
>
> **For an AI agent reading this as prompt context:** read top-to-bottom on first pass; re-read the Source-Type Matrix per source you process. Do not invent fields. Do not omit Portability Spine fields. When you don't know a value, leave the field empty — never fabricate.

## Why Care? — The Portability Thesis

Citations in this system are not bibliographic decoration. They are the **interop anchor between three knowledge tiers** the Lossless Group is consciously building:

1. **Personal knowledge base** — what one contributor reads, captures, and references in their own working files.
2. **Organizational knowledge base** — the "communist-style" pool where any contributor can use any other contributor's captured content. Cross-vault, cross-project. All of our content belongs to all of us.
3. **Beyond-human-scale derived layers** — vector databases, RAG/KAG retrieval pipelines, fine-tuning corpora. The substrate that lets agentic systems (e.g. the Investment Memo Orchestrator we're building separately) reason from our accumulated context rather than from live web search alone.

The schema below is designed for the **third tier first**, even though most contributors only see the first two. A field like `first_accessed_at_url` looks like trivial bibliographic metadata when you're writing a blog post. It's a deduplication key when 300 documents reference the same article through different display URLs and a vector pipeline is trying not to triple-count the same source.

> **The unifying mental model:** treat content as data we intend to **keep, port, reuse, and continue to build out**. Every field exists because some downstream consumer — perhaps not yet built — will need it.

## The Portability Spine

Five fields are load-bearing for the cross-tier story. If a citation has these five, it can move between tiers without identity loss. Everything else is display, classification, or annotation.

| Field | Why it's spine |
|---|---|
| `internal_uuid` | The stable cross-system anchor. Survives vault renames, file moves, copy-paste between vaults, eventual migration into a structured database. UUID generation is mechanical; the *commitment* to having one at capture time is the architectural decision. |
| `first_accessed_at_url` | The original URL we retrieved from. Anchoring and attribution — what we cited the first time. Survives even when the source's URL drifts (slug rename, redirect, paywall move). |
| `recently_accessed_at_url` | The current URL when content has drifted. Lets a downstream agent or content-archive process know where to re-fetch. Often equals `first_accessed_at_url`; only diverges when drift is detected. |
| `downloaded_content_path` | The bit-preserving record. Even if the publisher takes the page down, the source we cited is still on disk. This is what makes our citations honest in a year. |
| `structured_data_path` | The contract that "the JSON-y form of this source exists somewhere reachable." Lets a downstream consumer (Investment Memo Orchestrator, vector DB ingest, etc.) skip re-fetching and re-extracting — pull from structured shape directly. |

Backfill priority for an existing Citations folder is always: spine first, everything else second. The spine fields unblock all downstream work; the rest is polish.

## Naming Conventions (load-bearing — apply consistently)

| Surface | Convention | Example |
|---|---|---|
| YAML property names | `snake_case` (underscore) | `internal_uuid`, `default_slug`, `publisher_favicon_url` |
| `default_slug` value | `snake-case` / kebab-case (dash) | `vector-databases-2026-market-analysis` |
| `tags` values | `Train-Case` (capitalized words, dash-separated, no spaces) | `Vector-Databases`, `RAG-Pipelines`, `Investment-Memo` |
| `publisher_type` values | `Train-Case` from controlled taxonomy below | `Market-Research-Organization` |

Obsidian does not allow spaces in tags. We chose Train-Case (over kebab-case) for tag values so the tag taxonomy reads cleanly when humans browse it; we chose snake_case for properties because it's the YAML/Python idiom most consumers will expect.

## Audiences and Influences

Lossless citations need to render usefully into multiple downstream conventions. The schema is rendering-target-neutral — same data, different format depending on where the citation is consumed. The styles below are what we currently render into; new styles plug in by writing a new renderer over the same schema.

### Lossless House Style (default)

Our house style for footnote-form citations in Markdown. See `context-v/reminders/Lossless-Citation-Spec.md` for the inline-citation rules (`[^hexcode]` placement, spacing, reference-section formatting). The reference-line shape is:

```markdown
[^{hexcode}]: 2025, Jan 25. {Author Surname, First Name}. [Title of the source](url). Source Publisher Name || [Source Publisher Name](url). Accessed {Month Day, Year}.
```

Maps to the schema as: `date_published` (split into year/month/day), `authors[0]`, `title`, `recently_accessed_at_url` (what we link to), `publisher` (+ optional `publisher_url`), `date_recently_accessed`.

### Obsidian-Native

Default to GitHub Flavored Markdown + Remark/CommonMark conventions. Footnote syntax with `[^hexcode]` markers; reference definitions at the bottom of the file. Obsidian's autocomplete handles enum-like fields without us enforcing them. The Lossless House Style is a tightening of the Obsidian-native baseline.

### Academic Style

Renders to APA / MLA / Chicago / etc. Required fields beyond the spine: `authors` (full list, ordered), `date_published` (year minimum), `title`, `subtitle` (when journal/book has one), `publisher` (journal name, conference name, or book publisher), `edition_or_version` (for books, software, datasets). `lede` is not used; academic styles treat subtitle and abstract as separate concerns.

> **TODO (human):** Confirm which academic style is the default rendering target — APA seems most common in our market work; MLA appears in some humanities contributions. May want a per-document `citation_style_override` for sources that warrant non-default rendering.

### Market Analyst Style

The shape used in published research notes from research firms (Gartner, Forrester, Bloomberg Intelligence, McKinsey/BCG insights pieces, niche trackers like Pitchbook, Preqin, Crunchbase, SimilarWeb). Required: `publisher` (the firm), `publisher_type: "Market-Research-Organization"` or similar, `title`, `date_published`, often `authors` (analyst names matter). `subtitle` common; `lede` rare. Often paired with `api_provider_*` fields when the source is delivered via a data-as-a-service API rather than as a public webpage.

### Web-Ready Style

Magazine, blog, newsletter, social media, UGC. Required: `first_accessed_at_url`, `title`, `lede` (the magazine-style hook), `publisher` (the site name, normalized — "The New York Times" not "nytimes.com"), `publisher_favicon_url` (site renderers use it for visual cues), `piece_og_image` (for hero treatment). `subtitle` is rarely used here; `lede` replaces it.

> **TODO (human):** Decide whether `lede` is auto-generated from the first paragraph by AI when not present in OG metadata, or only ever populated when the source provides one. Consequences: AI-generated `lede` mixes our voice with the source's; source-only `lede` will be empty for most blog posts.

## Publisher and Publication Types

The `publisher_type` field is a controlled-but-not-enforced Train-Case taxonomy. It drives the **Source-Type → Field Applicability Matrix** below — different types call for different field subsets.

| `publisher_type` value | Definition | Examples |
|---|---|---|
| `Academic-Journal` | Peer-reviewed scholarly publication | Nature, JFE, Quarterly Journal of Economics |
| `Academic-Working-Paper` | Pre-publication or non-peer-reviewed academic | NBER, SSRN, arXiv |
| `Market-Research-Organization` | For-sale industry research | Gartner, Forrester, IDC, Omdia |
| `Think-Tank` | Policy / strategy non-profit | Brookings, RAND, Council on Foreign Relations |
| `Government-Agency` | National or supranational government | BLS, ECB, OECD, World Bank |
| `Consulting-Firm` | Strategy/management consulting public output | McKinsey Quarterly, BCG Insights, Bain Reports |
| `Industry-Media` | Trade publications & news | TechCrunch, The Information, Bloomberg, FT |
| `Individual-Researcher` | Personal blog / Substack of a credentialed individual | Stratechery, Marginal Revolution, Eugene Wei |
| `Content-Creator` | YouTube, podcast, or platform-native creator | Lex Fridman podcast, AI Explained YouTube |
| `Social-Media-User` | Single-platform-resident author (no own site) | LinkedIn poster, Twitter/X user, Mastodon user |
| `Data-as-a-Service-Provider` | Source delivered primarily via API or paid platform | Crunchbase, Preqin, Pitchbook, SimilarWeb, Traxn |
| `Content-Marketing` | Vendor-published content with brand-promotion intent | Hubspot blog, AWS blog, vendor whitepapers |
| `UGC-Community` | User-generated discussion | Reddit thread, Quora answer, Stack Overflow post, Hacker News thread |
| `Other` | Doesn't fit cleanly elsewhere — flag for review | (used sparingly) |

> **AI agent note:** When you cannot confidently classify a source, use `Other` and surface the ambiguity to a human reviewer. **Do not guess** between two plausible types.

## Schema (full YAML)

The schema is grouped into logical sections below. **All fields are optional unless marked Required.** Empty strings and empty arrays are valid — leaving fields off is fine. The agent should not fabricate values to make a field present.

```yaml
# ─── Identity (Portability Spine pt. 1) ──────────────────────────────────
internal_uuid: "{uuid-v4}"           # Required (always-include). Stable cross-system anchor. UUID v4. Must be unique across the entire knowledge base. Generation is deterministic; persistence is not negotiable.
reference_hexcode: "abc123"          # Required for canonical sources (sources promoted into the Citations folder). 6+ chars from [a-z0-9]. Used in inline `[^reference_hexcode]` markers across vault. Generated by cite-wide plugin.
default_slug: "example-slug"         # Required. snake-case (kebab-case) of the meaningful part of the title. Must be unique within the canonical-citations folder. Human-readable; works as a URL path component.

# ─── Bibliographic core ──────────────────────────────────────────────────
title: "Example Title"               # Required.
subtitle: "Example Subtitle"         # Used by academic, book, and market-analyst sources. Mutually exclusive with `lede` per source — don't fill both.
lede: "Example Lede"                 # Magazine/blog hook. Mutually exclusive with `subtitle` per source.
authors:                             # Empty array OK if anonymous; otherwise list in publication order.
  - "Author One"
  - "Author Two"
date_published: 2024-10-15           # ISO 8601. Missing day common — render gracefully. Missing month rare but possible — same.
edition_or_version: "1.0"            # Books, journals, datasets, software releases. Free-form: "Second Edition", "Version 2.0", "v0.42.1".

# ─── Publisher / source-of-source ────────────────────────────────────────
publisher: "Example Publisher"       # Normalized name. "The New York Times", not "nytimes.com" or "NYT".
publisher_url: "https://example.com" # Canonical site root, not a section page.
publisher_type:                      # Single value from the Train-Case taxonomy. Drives field applicability.
  - "Industry-Media"
publisher_favicon_url: "https://example.com/favicon.ico"  # Web-ready rendering needs this.

# ─── Access & retrieval (Portability Spine pt. 2) ────────────────────────
first_accessed_at_url: "https://example.com/article"        # Required. The URL we *originally* retrieved from. Anchoring + attribution. Spine field.
date_added: 2026-04-15                                      # When this citation entry was created in our system.
recently_accessed_at_url: "https://example.com/article-v2"  # The CURRENT URL if the source has drifted (slug rename, redirect, mirror). Often = first_accessed_at_url; only diverges on drift detection.
date_recently_accessed: 2026-04-20                          # When we last successfully retrieved (by either URL).

# ─── Media (display & social-share assets) ───────────────────────────────
piece_og_image: "https://example.com/article/og-image.jpg"
piece_thumbnail_url: "https://example.com/article/thumbnail.jpg"

# ─── API / structured-data provider ──────────────────────────────────────
api_provider_url: "https://api.example.com/v1/"             # The API root, when the source is API-deliverable.
api_provider_name: "Example API Provider"                   # Normalized. "Google Books API", "Crunchbase API".
api_source_url: "https://api.example.com/v1/article-slug"   # The specific endpoint that returned this source.

# ─── Content archival (Portability Spine pt. 3) ──────────────────────────
downloaded_content_path: "Citations/_archive/abc123.html"   # Spine field. Local path to the bit-preserving copy.
structured_data_path: "Citations/_archive/abc123.json"      # Spine field. Local path to the structured-extraction output.

# ─── Annotation & cross-reference ────────────────────────────────────────
cited_in_files:                      # Tracked automatically by the plugin; do not hand-edit.
  - "file1.md"
  - "file2.md"
tags:                                # Train-Case. Categories, topics, dossier tags, project tags. Hierarchy resolved at consumer level.
  - "Tag-One"
  - "Tag-Two"
```

> **AI agent note (output contract):** Emit exactly the field names above. Do not introduce new fields without updating this spec. Do not fabricate values; emit empty strings or omit fields when the source-of-truth lookup fails. The pipeline doc specifies which lookup paths to try and in what order.

## Source-Type → Field Applicability Matrix

For each source type, this matrix lists fields that are **expected** (E), **optional** (O), or **not applicable** (—). The agent uses this to decide which fields to attempt and which to skip.

| Field \ Type | Acad-Journal | Acad-WP | Mkt-Research | Think-Tank | Gov-Agency | Industry-Media | Indiv-Researcher | Content-Creator | Social-Media | DaaS-Provider | Content-Marketing | UGC-Community |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `internal_uuid` | E | E | E | E | E | E | E | E | E | E | E | E |
| `reference_hexcode` | E | E | E | E | E | E | E | E | E | E | E | E |
| `default_slug` | E | E | E | E | E | E | E | E | E | E | E | E |
| `title` | E | E | E | E | E | E | E | E | E | E | E | E |
| `subtitle` | E | O | E | O | O | — | — | — | — | — | — | — |
| `lede` | — | — | — | — | — | E | E | O | — | — | E | — |
| `authors` | E | E | E | O | — | E | E | E | E | — | O | E |
| `date_published` | E | E | E | E | E | E | E | E | E | E | E | E |
| `edition_or_version` | E | O | O | O | O | — | — | — | — | E | — | — |
| `publisher` | E | E | E | E | E | E | O | E | E | E | E | E |
| `publisher_url` | E | E | E | E | E | E | E | E | E | E | E | E |
| `publisher_type` | E | E | E | E | E | E | E | E | E | E | E | E |
| `publisher_favicon_url` | O | O | O | O | E | E | E | E | E | O | E | E |
| `first_accessed_at_url` | E | E | E | E | E | E | E | E | E | E | E | E |
| `recently_accessed_at_url` | O | O | O | O | O | O | O | O | O | O | O | O |
| `date_added` | E | E | E | E | E | E | E | E | E | E | E | E |
| `date_recently_accessed` | E | E | E | E | E | E | E | E | E | E | E | E |
| `piece_og_image` | O | O | O | O | O | E | E | E | E | — | E | O |
| `piece_thumbnail_url` | O | O | O | O | O | E | E | E | E | — | E | O |
| `api_provider_url` | O | O | E | — | O | — | — | — | — | E | — | — |
| `api_provider_name` | O | O | E | — | O | — | — | — | — | E | — | — |
| `api_source_url` | O | O | E | — | O | — | — | — | — | E | — | — |
| `downloaded_content_path` | E | E | E | E | E | E | E | O | O | E | O | O |
| `structured_data_path` | E | E | E | E | E | O | O | — | — | E | — | — |
| `cited_in_files` | (auto) | (auto) | (auto) | (auto) | (auto) | (auto) | (auto) | (auto) | (auto) | (auto) | (auto) | (auto) |
| `tags` | E | E | E | E | E | E | E | E | E | E | E | E |

> **AI agent note:** "Expected" means: the agent must attempt to fill this field and surface a warning if it cannot. "Optional" means: fill if cheaply available; do not chase. "Not applicable" means: do not emit even if data is somehow available (it would be misleading on this source type).
>
> **Note on `recently_accessed_at_url`:** Always Optional in this matrix because the agent only fills it when URL drift is detected. On first capture, it equals `first_accessed_at_url` and may be omitted (renderers default to `first_accessed_at_url` when this is empty).
>
> **Human reviewer note:** Override the matrix at the per-source level if a specific source warrants a non-default field set (e.g. a Substack post that's structurally an academic working paper).

## Minimum-Viable Citation

For a citation to be considered **valid** (i.e. ingestible by downstream tooling without warnings), it must have:

- All five Portability Spine fields: `internal_uuid`, `first_accessed_at_url`, `recently_accessed_at_url` (may equal first), `downloaded_content_path`, `structured_data_path`. *(For ad-hoc citations not yet promoted to canonical, the two `_path` fields may be empty strings — the validator emits a warning but not an error.)*
- `title`
- `date_added`
- `publisher_type` (so the matrix above can be applied for further checks)
- `tags` non-empty (downstream search and clustering rely on tag presence)

A citation that lacks any of these is **incomplete** — usable in display contexts but not in the canonical archive. The acquisition pipeline (sibling doc) defines the agent's behavior when a minimum-viable threshold cannot be met.

## Coexistence with the Current `CitationMetadata`

Today's `cite-wide` plugin defines a 12-field `CitationMetadata` interface in `src/services/citationFileService.ts`:

```ts
interface CitationMetadata {
    hexId: string;
    title: string | undefined;
    author: string | undefined;            // singular; this schema makes it plural
    url: string | undefined;               // == first_accessed_at_url (no drift tracking yet)
    date: string | undefined;              // == date_published
    source: string | undefined;            // == publisher
    tags: string[];
    created: string;                       // == date_added
    lastModified: string;                  // operational, not part of this schema
    referenceText: string | undefined;     // operational, not part of this schema
    usageCount: number;                    // operational
    filesUsedIn: string[];                 // == cited_in_files
}
```

**Coexistence model: opt-in upgrade.** Most pasted research stays in the current narrow shape — that's fine for ad-hoc use. Sources consciously promoted into the canonical archive get the full schema applied via the acquisition pipeline.

> **TODO (human + AI):** Decide on the migration path when the rich schema becomes the default. Options:
> - **Big-bang**: replace `CitationMetadata` interface; backfill all existing `Citations/*.md` via the agent.
> - **Dual-shape**: keep `CitationMetadata` as the "light" shape; introduce `CanonicalCitationMetadata` as the "rich" shape; both serialize to the same YAML, but tooling reads the level it expects. **Lower-risk path; recommended unless we hit a blocker.**
> - **Opt-in only**: never auto-migrate; rich shape only appears on promoted sources. Old citations stay light forever.

## Open Decisions (TODOs)

These are the spec-level open questions. Each blocks some piece of the implementation but not the rest.

- **TODO (human):** Default academic rendering style — APA / MLA / Chicago / other? Allow per-document `citation_style_override`?
- **TODO (human):** `lede` auto-generation policy — only when source provides, or AI-generate when missing? Consequences: AI-generated `lede` mixes our voice with the source's; source-only `lede` will be empty for most blog posts.
- **TODO (human):** `tags` taxonomy governance — controlled vocabulary or organic growth with periodic consolidation passes? If controlled, where is the canonical list stored?
- **TODO (human + AI):** Migration model from current `CitationMetadata` — see Coexistence section. Lean: dual-shape.
- **TODO (AI):** Validate the Source-Type Matrix against real sources — first pass was reasoned-from-template; some cells need empirical checking. Particularly `Social-Media` and `UGC-Community` rows.
- **TODO (human):** Should `recently_accessed_at_url` always be present (mirror to `first_accessed_at_url` on first capture for symmetry), or only present on detected drift (current draft)?
- **TODO (AI):** When `subtitle` and `lede` data both seem present in source meta tags, what's the decision rule? Currently "by source type" via the matrix — but a tricky case is a magazine-style academic paper.

## Cross-References

- **Inline citation format** (the markdown layer, distinct from this YAML layer): `context-v/reminders/Lossless-Citation-Spec.md`
- **Acquisition pipeline** (the agent that fills this schema): `Citation-Acquisition-Pipeline.md`
- **Per-field operational guide** (cheap path / expensive path / fallback for each field): `Citation-Field-Acquisition-Guide.md`
- **Parsing source citations from LLM responses** (Perplexity, Google AI, Claude formats): `Parse-Common-Citation-Formats.md`
- **Current narrow implementation**: `src/services/citationFileService.ts` (`CitationMetadata` interface)
