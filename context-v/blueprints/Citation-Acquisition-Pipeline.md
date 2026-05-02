---
title: "Citation Acquisition Pipeline — Agent Architecture, Phases, Output Contract"
lede: "The HOW for filling the Lossless Citation schema. Decouples the capture moment (a URL pasted into a doc) from the canonicalization moment (the source promoted into the knowledge base). Specifies the agent that does the work: where it runs, what tools it has, what phases it executes, what it emits, how it fails gracefully, and how multiple clients (Obsidian plugin, CLI, Investment Memo Orchestrator) share the same agent."
date_authored_initial_draft: 2026-05-01
date_authored_current_draft: 2026-05-01
status: Draft
category: Blueprint
applies_to: cite-wide Obsidian plugin + companion MCP server (to be built)
authors:
  - Michael Staton
augmented_with: Claude Code (Opus 4.7, 1M context)
tags:
  - Agent-Architecture
  - MCP-Server
  - Pipeline-Design
  - Claude-API
  - Citation-Acquisition
sibling_docs:
  - "Lossless-Citation-Standards.md"
  - "Citation-Field-Acquisition-Guide.md"
---

> **How to read this doc.** Section order is implementation order. **Architecture → Tool Envelope → Phases → Output Contract → Triggers → State → Failure Modes → Open Decisions.** Skip ahead if you already know the architecture; do not skip ahead if you're filling in TODOs.
>
> **For an AI agent reading this as prompt context:** the **Phases** section is your runbook. The **Field Acquisition Guide** sibling doc is your per-field reference. Always validate against the **Output Contract** before returning.

## Why This Is a Separate Concern

The Standards doc says **what** a canonical citation looks like. This doc says **how** one gets there. They're separated because the schema is rendering-target-neutral and survives across years; the acquisition mechanism is a moving target — APIs change, LLMs improve, archival strategies evolve.

The pipeline also exists because canonicalization is **not free**. Filling the rich schema requires HTTP fetches, HTML parsing, AI calls (each ~5-30s, ~$0.01-0.10 per source), and filesystem operations. These costs are acceptable for sources we consciously promote into the canonical knowledge base; they're absurd to pay for every random URL pasted into a doc.

**Decoupling capture from canonicalization is the key design move.** Capture is cheap — it happens automatically when a URL is dropped into a markdown file (today's `extractAndInsertCitation` flow). Canonicalization is expensive — it happens explicitly, on demand, when a contributor decides "this source is worth the full treatment."

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENTS (multiple)                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌──────────────────────┐   ┌──────────────────┐  ┌─────────────┐  │
│   │ cite-wide plugin     │   │ CLI tool         │  │ Investment  │  │
│   │ (Obsidian)           │   │ (batch sweeps,   │  │ Memo        │  │
│   │ - Promote button     │   │  CI, scripts)    │  │ Orchestrator│  │
│   │ - Canonicalize cmd   │   │                  │  │ (consumer)  │  │
│   │ - Save All Hex cmd   │   │                  │  │             │  │
│   └──────────┬───────────┘   └────────┬─────────┘  └──────┬──────┘  │
│              │                        │                   │         │
│              └────────────┬───────────┴───────────────────┘         │
│                           │  MCP protocol                           │
└───────────────────────────┼─────────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────────┐
│                         MCP SERVER (the agent)                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Exposed MCP tools:                                                │
│   - canonicalize_citation(source_url | hex_id)                      │
│   - lookup_citation_by_uuid(uuid)                                   │
│   - sweep_pending_citations(folder_path)                            │
│   - validate_citation(yaml_blob)                                    │
│                                                                     │
│   Internal tools (the agent's tool envelope):                       │
│   - http_fetch(url) → { final_url, status, html, headers }          │
│   - parse_html_meta(html) → og/twitter/standard meta tags           │
│   - resolve_favicon(url, html) → favicon URL                        │
│   - jina_reader(url) → cleaned-content extraction                   │
│   - claude_classify(prompt, schema) → structured output             │
│   - generate_uuid_v4()                                              │
│   - generate_hex_code(existing_codes) → 6+ char alphanum            │
│   - normalize_slug(title) → snake-case (kebab) string               │
│   - filesystem_write(path, content)                                 │
│   - filesystem_read(path)                                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Why MCP server, not in-plugin code?**

- **Reuse across clients.** The same agent serves the Obsidian plugin, a CLI, and the Investment Memo Orchestrator. Putting the logic in the plugin would couple it to Obsidian's lifecycle.
- **Heavy lift outside Obsidian.** HTTP fetches with retry, content downloads, AI calls — these don't belong in Obsidian's renderer process. MCP runs as a separate Node/Python process.
- **Future-proofing for shared knowledge base.** When the personal KB → org KB transition happens, the MCP server becomes the org-shared agent (running on a server, accessed by all contributors). The plugin's role shrinks to "client of the canonical service."
- **Tool-use ergonomics.** Claude Code, Claude Desktop, and other MCP-aware clients can talk to the same server directly — letting *us* canonicalize sources mid-conversation when working with an agent.

> **TODO (human):** Confirm MCP-server-first architecture vs in-plugin-first. The latter is faster to ship but harder to reuse. Recommend MCP-server.

## Tool Envelope

The agent needs these capabilities. For each, I've noted which existing tool fills the role and which gaps need new code.

| Capability | Source | Status |
|---|---|---|
| HTTP fetch with redirect chain capture | Standard `fetch` + redirect tracking | Build |
| HTML meta-tag parser (OG, Twitter, standard) | `cheerio` or `linkedom` | Build (~50 lines) |
| Favicon URL resolution | Convention-based: `<link rel="icon">` then `/favicon.ico` fallback | Build (~20 lines) |
| Jina.ai Reader (clean content extraction) | Already integrated in plugin via `urlCitationService` | Reuse |
| Claude API structured output (tool use) | Anthropic SDK `tools` param | Build (~100 lines wrapper) |
| UUID v4 generator | Standard library | Trivial |
| Hex code generator (collision-checked) | Existing `citationService.generateHexId` | Reuse (move to MCP) |
| Slug normalizer | Build deterministic helper: lowercase, strip non-alnum, collapse dashes | Build (~30 lines) |
| Filesystem read/write | Standard library | Trivial |
| Citation YAML serializer/parser | Existing `citationFileService` patterns + `js-yaml` | Reuse |

**Claude API specifics:**

- **Model:** Claude Sonnet 4.6 for classification and normalization tasks (cheaper, fast). Reserve Opus 4.7 for the ambiguous edge cases (lede-vs-subtitle when both seem plausible, publisher classification when type is unclear).
- **Tool use schema** for `publisher_type` classification:
  ```json
  {
    "name": "classify_publisher",
    "input_schema": {
      "type": "object",
      "properties": {
        "publisher_type": { "enum": [/* Train-Case taxonomy from Standards doc */] },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
        "reasoning": { "type": "string" }
      },
      "required": ["publisher_type", "confidence", "reasoning"]
    }
  }
  ```
- **Confidence threshold:** Below 0.7, fall back to `Other` and surface to human reviewer.
- **Prompt caching:** Cache the Standards doc + Field Guide as the system prompt. Per-source dynamic content (HTML excerpt, meta tags) goes in the user message. Material cost reduction across a sweep.

> **TODO (human):** Confirm model selection (Sonnet 4.6 default + Opus 4.7 for ambiguous). Could be flipped if Opus is dramatically better at one-shot classification.

## Phases

The agent runs phases in order. Each phase is **independently retryable** — if phase 4 fails, phases 1-3 stay valid. Output state is persisted between phases to support resume-from-failure.

### Phase 1 — Deterministic (no network, no AI)

- `internal_uuid` ← `generate_uuid_v4()`
- `reference_hexcode` ← provided by caller, OR `generate_hex_code(existing_codes)` if missing
- `default_slug` ← `normalize_slug(provided_title or hexcode-as-fallback)` — refined later
- `date_added` ← today (ISO 8601)
- `first_accessed_at_url` ← provided source URL
- `recently_accessed_at_url` ← `first_accessed_at_url` (mirrored on first capture)
- `date_recently_accessed` ← today (will update on re-fetches)

**Failure mode:** Phase 1 cannot fail. If it does, the agent has a bug — exit non-zero and surface.

### Phase 2 — Fetch + meta extraction (network, no AI)

- `http_fetch(first_accessed_at_url)` → if final URL differs from input, update `recently_accessed_at_url` to the final URL.
- Parse HTML for:
  - `<title>` and OG `og:title` → candidate `title`
  - `<meta name="description">`, `og:description`, `twitter:description` → candidate `lede` (first paragraph fallback for blog/magazine sources)
  - `<meta name="author">`, `<meta property="article:author">`, byline regexes → candidate `authors`
  - `<meta name="article:published_time">`, `og:article:published_time` → `date_published`
  - `<link rel="icon">` or `/favicon.ico` → `publisher_favicon_url`
  - `og:image`, `twitter:image` → `piece_og_image` and `piece_thumbnail_url`
  - URL hostname → candidate `publisher_url`

**Failure modes:**
- 404 / 410: skip phase, mark URL as dead in a side-channel log; continue with what we have.
- Timeout: retry once with longer timeout; then skip.
- Paywalled / requires auth: capture what we can; mark `lede` empty so AI doesn't try to invent one.

### Phase 3 — AI normalization (AI calls, no network beyond Claude)

For each candidate field from Phase 2, ask Claude to:

- **Pick `subtitle` vs `lede`** — based on the `publisher_type` (after Phase 4 classifies it; Phase 3 may run *after* Phase 4 if we're optimizing AI cost, but order written here is logical).
- **Normalize `publisher`** name — "nytimes.com" → "The New York Times", "wsj.com" → "The Wall Street Journal", "lex-fridman-podcast.simplecast.com" → "Lex Fridman Podcast".
- **Normalize `authors`** — split byline strings into individual authors, decide if "By Adam Grant" → `["Adam Grant"]` vs preserve "Adam Grant, Ph.D." style. Drop suffixes per house style.
- **Refine `default_slug`** — if Phase 1 used the hexcode fallback, generate a real slug from the now-known title.

**Failure modes:**
- Rate limit: backoff and retry; eventual fallback to Phase 2 candidates verbatim.
- Low confidence: emit field as-is from Phase 2 (raw OG meta), flag in warnings list.

### Phase 4 — AI classification (the most reasoning-heavy step)

- **`publisher_type`** — classify into the Train-Case taxonomy. Uses prompt caching to attach the Standards doc as context.
- **`tags`** — generate 3-7 Train-Case tags based on title + first 500 chars of content + publisher_type. Pull from existing tag corpus when overlap exists; introduce new tags sparingly.

**Failure modes:**
- Low confidence on `publisher_type` (< 0.7): set to `Other`, flag for human review.
- Tag generation timeout: emit empty array, flag.

### Phase 5 — Content archival (network + filesystem, no AI strictly required)

- **`downloaded_content_path`**: HTML save (`{citationsFolder}/_archive/{hexcode}.html`). For PDFs, save the binary. For paywalled, save the partial.
- **`structured_data_path`**: Run Jina.ai Reader → save the cleaned text as `.md` or pass through Claude for structured extraction → save as `.json`. *(TODO below — choice depends on downstream consumers.)*

**Failure modes:**
- Disk full: hard failure, surface immediately.
- Jina rate-limit: queue for retry; mark `structured_data_path` empty for now.

> **TODO (human):** Decide whether `structured_data_path` is a Markdown file from Jina (cheaper, lossy structured-ness) or a JSON file from a Claude tool-use extraction pass (more expensive, well-typed). Might be both: `.md` for human review, `.json` for downstream RAG ingest.

### Phase 6 — Validation

- Apply the **Source-Type Matrix** from the Standards doc against the assembled YAML.
- For each "Expected" field that's empty, emit a warning.
- For each "Not applicable" field that's filled, emit a warning (probable error).
- Check the Minimum-Viable Citation thresholds.
- Return: `{ valid, warnings, errors }` plus the final YAML.

## Output Contract

The agent's MCP-tool return shape:

```typescript
interface CanonicalizeCitationResult {
    success: boolean;                   // false only on hard failure (e.g., disk full, network out, Phase 1 bug)
    yaml: string;                       // the schema-conformant YAML body, ready to write into a citation file
    citation_file_path: string;         // where the file was written
    archive_paths: {                    // populated when Phase 5 succeeds
        downloaded?: string;
        structured?: string;
    };
    matrix_check: {                     // from Phase 6
        valid: boolean;                 // true = passes Minimum-Viable; false = warnings (still emits)
        warnings: string[];             // human-readable
        errors: string[];               // hard validation failures
    };
    phase_outcomes: {                   // for debugging / partial-success diagnosis
        deterministic: 'success' | 'error';
        fetch: 'success' | 'partial' | 'skipped' | 'error';
        normalize: 'success' | 'fallback' | 'error';
        classify: 'success' | 'low-confidence-other' | 'error';
        archive: 'success' | 'partial' | 'skipped' | 'error';
        validate: 'success' | 'warnings' | 'errors';
    };
}
```

> **AI agent note (output contract):** Emit valid YAML even when phases partially failed. The downstream consumer should be able to ingest the file and surface its own warnings. **Never return invalid YAML to silence a phase failure.**

## Trigger Model

The agent is invoked by clients in three ways. Each maps to a corresponding MCP tool.

### Trigger 1 — Per-citation, manual

- **Where:** "Promote to Canonical" button in the Citations modal (cite-wide plugin), or `canonicalize` CLI command on a specific hex.
- **Input:** existing hex ID (already in vault), or new URL to canonicalize from scratch.
- **Output:** writes/updates `Citations/{hex}.md` with full schema; reports per-phase outcomes back to the client.
- **User confirmation:** required before writing to disk (modal confirmation, CLI `--yes` flag).

### Trigger 2 — Bulk sweep

- **Where:** `Sweep Citations` command (cite-wide plugin) or `sweep` CLI subcommand.
- **Input:** folder path; optional filter (e.g., "only sources with `structured_data_path` empty").
- **Output:** processes citations in parallel (up to N concurrent, rate-limit-aware); reports aggregate statistics.
- **Idempotency:** see State section below.

### Trigger 3 — Capture-and-canonicalize

- **Where:** "Capture URL as Canonical Source" command (cite-wide plugin) or `capture` CLI subcommand.
- **Input:** URL.
- **Output:** generates new hex, runs full pipeline, writes `Citations/{hex}.md`. Skips the "already-exists" check that the modal-driven flow does.
- **Use case:** you're reading something in a browser, want to add it directly to the canonical archive without having referenced it in any vault doc yet.

> **TODO (human):** Should there be a fourth trigger for the Investment Memo Orchestrator's use case (look up a canonical source by URL or by content fingerprint, not by hex ID)? The orchestrator doesn't necessarily know the hex when it wants to attribute a claim.

## State, Idempotency, Resume

The agent's design assumption: **canonicalization can fail mid-pipeline and resume cleanly later.** This is critical for bulk sweeps and for sources behind flaky paywalls.

- **Persistence between phases:** the agent writes a `_canonicalize_state.json` per source (in the archive folder) tracking which phases succeeded. On resume, it skips phases marked `success`.
- **Re-canonicalization (idempotency):** running canonicalize on a source that already has full metadata is a no-op for filled fields. Empty/optional fields get re-attempted (a paywalled source might now be accessible; a tag corpus might have grown).
- **URL drift handling:** on re-fetch, if the URL redirects to a new location, `recently_accessed_at_url` updates to the new URL and `date_recently_accessed` updates to today. `first_accessed_at_url` never changes once set. If the new URL serves materially different content (heuristic: title diverged), flag for human review — this might be a different article entirely.
- **Hex collision on capture-and-canonicalize:** if a generated hex collides with an existing canonical, regenerate. Cap at 5 attempts; failure beyond that is a bug.

## Failure Modes & Graceful Degradation

| Failure | Severity | Behavior |
|---|---|---|
| Source URL 404/410 (dead link) | Low | Mark `recently_accessed_at_url` with prefix `DEAD:`; continue with cached data; flag |
| Source URL 403 / paywall | Low | Capture meta tags only; skip content download; flag |
| Source URL timeout | Low | Retry once; if still timing out, skip with flag |
| HTML parse failure (malformed) | Low | Use raw HTTP body for AI extraction; skip meta-tag phase |
| Claude API rate limit | Medium | Exponential backoff (max 3 retries); on persistent failure, skip phase and emit Phase 2 candidates verbatim |
| Claude API low confidence | Low | Use threshold (0.7); fallback to `Other` for `publisher_type`, raw values for normalization |
| Disk full | High | Hard error; surface to caller; do not write partial |
| Slug collision after disambiguation attempts | Medium | Use UUID-suffixed slug; flag for human review |
| Source content materially changed (drift detection) | Medium | Update `recently_accessed_at_url`; flag for human review (might be different article) |

> **AI agent note:** When emitting flags/warnings, use structured shape (level + message + field), not free-text. The CLI / plugin can then route warnings to the right place.

## Integration Hooks with the Existing Plugin

These are the seams in today's `cite-wide` codebase where the MCP-server pipeline plugs in. Listed for clarity, not as immediate work items.

- **`citationFileService.saveAllHexCitationsFromContent`** is today's "lite canonicalization" — it pulls reference text + URL, calls `createCitationFile`. The MCP server's `canonicalize_citation` tool **replaces** this for sources promoted past the lite tier.
- **`urlCitationService.extractCitationFromUrl`** (the Jina-based extract) is **still useful** — it's the cheap path for getting `title`, `authors`, `siteName`, `date_published` candidates. The MCP server should call it as part of Phase 2.
- **`CitationModal`** gains a **"Promote to Canonical"** button on hex groups (sibling to the existing "Save to Citations" button we just shipped). Promote = trigger MCP `canonicalize_citation` against the same hex. Save = today's lite write. The two coexist.
- **Settings** gains a `mcpServerUrl` field once the MCP server is in place. Default: localhost:port for solo use; team-shared URL when org KB lands.

## Open Decisions (TODOs)

- **TODO (human):** MCP-server-first architecture vs in-plugin-first — confirm. Lean: MCP-server.
- **TODO (human):** `structured_data_path` content type — Markdown (Jina), JSON (Claude tool-use), or both? Affects pipeline cost and consumer flexibility.
- **TODO (human):** Investment Memo Orchestrator's lookup pattern — by hex / URL / content fingerprint? Affects whether we need a fourth MCP tool.
- **TODO (human):** Bulk-sweep concurrency limits — how many sources in parallel? Throttle by rate limits (Claude API, Jina API), but the user-side concern is "don't burn the laptop."
- **TODO (human):** Where the MCP server runs — local-first (per-contributor laptop), or eventually a team-shared deployment? Affects auth, the `mcpServerUrl` setting, and the "communist KB" tier semantics.
- **TODO (AI):** Validate the Phase 2 meta-tag selectors against real-world sources. Phase 2 is the most empirically-driven phase; the listed selectors are a reasonable starting point but real sources have variants.
- **TODO (human + AI):** Pricing/cost model — at what canonicalize-volume does this become a noticeable line item? Per-source cost estimate is in the ballpark of $0.02-0.10. A 1000-source canonicalize sweep is $20-100. Worth surfacing in the CLI.
- **TODO (AI):** Error reporting taxonomy — current draft uses prose `string[]`. May want structured error codes once consumer tooling exists.

## Cross-References

- **Schema definition** (the WHAT this pipeline fills): `Lossless-Citation-Standards.md`
- **Per-field acquisition specifics** (cheap/expensive paths per field): `Citation-Field-Acquisition-Guide.md`
- **Inline citation format** (the markdown layer): `context-v/reminders/Lossless-Citation-Spec.md`
- **Existing plugin services** that the pipeline reuses or replaces: `src/services/citationFileService.ts`, `src/services/urlCitationService.ts`, `src/services/citationService.ts`
- **Existing modal** that gains the "Promote to Canonical" button: `src/modals/CitationModal.ts`
