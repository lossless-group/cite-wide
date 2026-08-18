---
title: "Paste LLM Content drops prose structure and emits link-only citations"
lede: >-
  Paste rewrites citation tokens and nothing else — headings flatten, refs become self-referential links, and one URL gets two hex codes.
date_created: 2026-08-08
date_modified: 2026-08-08
authors:
  - Michael Staton
augmented_with:
  - Claude Code on Claude Opus 5 (1M context)
semantic_version: 0.0.0.1
status: Open
type: issue
target_repo: cite-wide
applies_to: "Paste LLM Content (Convert Citations on Insert); also the post-hoc Convert LLM Citations command, which shares the same parser"
related:
  - "[[Lossless-Citation-Spec]]"
  - "[[Modal-for-Pasting-LLM-Native-Content]]"
  - "[[Parse-Common-Citation-Formats]]"
  - "[[User-Definable-Citation-Format-Templates]]"
tags:
  - Issue-Resolution
  - Cite-Wide
  - LLM-Citation-Parsing
  - Google-AI-Overviews
  - Markdown-Fidelity
site_uuid: 356e45e3-2610-4e25-9da9-40e86143d3bd
hex_code: nmjhu6
date_authored_initial_draft: 2026-08-08
date_authored_current_draft: 2026-08-08
---

# Paste LLM Content drops prose structure and emits link-only citations

## Summary

Pasting a Google AI Overview through **Paste LLM Content** converts the
citations correctly and leaves everything else alone. Three defects fall out
of that:

1. **Structural markdown is discarded.** Section headings arrive as bare
   paragraph lines, bullets stay as U+2022 `•` characters, and Google's
   trailing boilerplate rides along into the vault.
2. **Citations are link-only.** Google's reference block is a list of bare
   URLs, so each converted reference definition becomes
   `[^hex]: [https://url](https://url)` — a link whose visible text is its
   own href, carrying none of the date / title / author / publisher fields
   the [[Lossless-Citation-Spec]] requires.
3. **The same URL gets two hex codes.** Google cites the Wikipedia article as
   both `[1]` and `[13]`; both survive into the reference section as distinct
   citations of the identical URL.

All three trace to the same root cause (§ Root Cause), but they want
different fixes and can ship independently.

## Reproduction

Source: Google AI Overview for "YANG data modeling language", pasted into the
modal with **Source: Google AI Overviews** selected.

**Live artifact — the file this actually produced:**
`/Users/mpstaton/content-md/lossless/YANG Data Modeling Language.md`

That file is the primary evidence for everything below; line references in
this issue point into it. The same input was also run through the CLI harness
to confirm the behavior is in the parser and not in the Obsidian host:

```bash
node scripts/parse-llm-citations.mjs input.md -o output.md
```

The citation-conversion half works exactly as designed — 9 inline citations
and 5 reference definitions converted, hex namespace collision-free, inline
spacing normalized to spec. Nothing in this issue disputes that. The defects
are all in what the pipeline *doesn't* touch.

## Defect 1 — structural markdown is discarded

### What happened

Input (Google AI Overview, verbatim):

```
Key Characteristics 

• Protocol Independent: YANG defines the structure, but the data can be serialized into multiple formats like XML, JSON, or CBOR. 
• Separation of Data: It explicitly distinguishes between configuration data (read-write settings) and state data (read-only system metrics like packet counters). 
```

Output — byte-identical except for the citation markers elsewhere on the line:

```
Key Characteristics 

• Protocol Independent: YANG defines the structure, but the data can be serialized into multiple formats like XML, JSON, or CBOR. 
• Separation of Data: It explicitly distinguishes between configuration data (read-write settings) and state data (read-only system metrics like packet counters). 
```

### What was expected

```markdown
## Key Characteristics

- **Protocol Independent:** YANG defines the structure, but the data can be serialized into multiple formats like XML, JSON, or CBOR.
- **Separation of Data:** It explicitly distinguishes between configuration data (read-write settings) and state data (read-only system metrics like packet counters).
```

### The full inventory of what needs normalizing

Observed across this one paste — all of it is stable, recurring Google AI
Overview shape, not one-off noise:

| Artifact | Input | Wanted |
|---|---|---|
| Section heading | `Key Characteristics ` (bare line, trailing space, followed by blank line) | `## Key Characteristics` |
| Bullet | `• Leaf: Contains a single…` | `- **Leaf:** Contains a single…` |
| Bold lead-in | `• Protocol Independent: YANG…` | `- **Protocol Independent:** YANG…` |
| Trailing whitespace | every line ends with 1–2 spaces | stripped (a stray double-space is a markdown hard break) |
| Provider boilerplate | `AI responses may include mistakes.` | dropped |
| Conversational tail | `Are you exploring YANG for a specific project, and would you like assistance with…?` | dropped |
| Empty code reference | `Structure Example` heading whose example body never came across in the copy | flagged, not silently kept as a dangling heading |

The last row is worth calling out: Google's "Structure Example" section
promised a YANG module snippet that the clipboard did not carry, and the
Advanced Features bullets reference `regular expressions ()` and
`using  statements` — parentheses and gaps where inline code spans were
stripped by the copy. Nothing downstream can recover that content, but a
paste that silently keeps a heading with no body is worse than one that flags
it.

### Where it happens

`src/modals/PasteLlmContentModal.ts:164-167` — the entire insert path:

```ts
const result = llmCitationParserService.transform(pasted, pasteParse, { mapping });
this.editor.replaceSelection(result.content);
```

`transform()` is a line-by-line citation rewriter. It has no concept of
document structure and never claimed one. Nothing between the textarea and
`replaceSelection` normalizes prose.

### Note: the Provider selector is currently inert

`PasteLlmContentModal.ts:63-66` says so outright:

> Provider selector. Carried as metadata for now — the parser already
> auto-handles both Google AI multi-comma and Perplexity adjacent-multi
> forms, so the selection is informational.

Structural normalization is inherently provider-specific — Google AI
Overviews, Perplexity, and ChatGPT each mangle markdown differently. This
defect is the reason to make `provider` load-bearing rather than
informational. The field is already collected and already threaded to the
call site; it just isn't read.

## Defect 2 — citations are link-only

### What happened

Input reference block (Google gives bare URLs, nothing else):

```
[1] https://en.wikipedia.org/wiki/YANG
[2] https://www.youtube.com/watch?v=zy9QA-uU0u4
[3] https://developer.cisco.com/docs/nso/guides/the-yang-data-modeling-language/
```

Output — `YANG Data Modeling Language.md:40-53`, all fourteen in this shape:

```markdown
[^5ybd01]: [https://en.wikipedia.org/wiki/YANG](https://en.wikipedia.org/wiki/YANG)
[^3mjvld]: [https://www.youtube.com/watch?v=zy9QA-uU0u4](https://www.youtube.com/watch?v=zy9QA-uU0u4)
[^pw29bx]: [https://developer.cisco.com/docs/nso/guides/the-yang-data-modeling-language/](https://developer.cisco.com/docs/nso/guides/the-yang-data-modeling-language/)
```

Every reference definition is a markdown link whose visible text is its own
href. That renders as an unreadable URL wall, and it strands the citation
outside the canonical system — there is no title to match on, no publisher to
group by, no date to sort by. The Extreme Networks entry at line 48 is the
reductio: a 118-character GUID URL printed twice on one line.

### What was expected

Per [[Lossless-Citation-Spec]] § *Lossless Standard Reference Formatting*:

```markdown
[^{hexcode}]: 2025, Jan 25. {Author Surname, First Name}. [Title of the source](url). Publisher Name || [Publisher Name](url). Accessed {Month Day, Year}.
```

So the Wikipedia entry should land closer to:

```markdown
[^b0tf1l]: 2026, Jul 14. "[YANG | Wikipedia](https://en.wikipedia.org/wiki/YANG)". [Wikipedia](https://en.wikipedia.org).
```

### Where it happens

`src/services/llmCitationParserService.ts:547-561`,
`reformatRefDefBodyAsMarkdownLink()`:

```ts
const titleText = body.substring(0, urlMatch.index).trim();
// …
if (!titleText) {
    return suffix ? `[${url}](${url}) ${suffix}` : `[${url}](${url})`;
}
```

The `!titleText` branch is the whole defect. It is a **reasonable fallback**
for Perplexity, which emits `Title https://url` and therefore usually has
title text to hoist. Google emits the URL alone, so the fallback fires on
every single reference and the self-link is the best that function can do
with the string it was handed.

### Why this can't be fixed inside the parser

The metadata is not in the pasted text. No amount of string manipulation
recovers a title, author, date, or publisher from a bare URL. **The fix
requires a network fetch**, which puts it outside the parser's stated
contract — the file header at `llmCitationParserService.ts:26-27` commits to
being "Pure TypeScript — no Obsidian imports — so the service is testable
from a CLI harness without spinning up the plugin host."

That contract is worth keeping. Enrichment belongs in a layer above the
parser.

## Defect 3 — the same URL gets two hex codes

### What happened

`YANG Data Modeling Language.md:40` and `:52`:

```markdown
[^5ybd01]: [https://en.wikipedia.org/wiki/YANG](https://en.wikipedia.org/wiki/YANG)
…
[^w5ubin]: [https://en.wikipedia.org/wiki/YANG](https://en.wikipedia.org/wiki/YANG)
```

Google listed the Wikipedia YANG article as both `[1]` and `[13]`. Both
converted to distinct hex codes pointing at the identical URL. The reference
section now claims fourteen sources where there are thirteen.

This is the exact failure the [[Lossless-Citation-Spec]] calls out as the
reason hex codes exist at all — *"we cannot have numeric collisions due to
carelessness. Content creators should not be spending their time scouting for
collisions."* Duplicate-URL detection is the same discipline one layer up.

### Also visible: seven uncited reference definitions

Lines 47–53 (`[^hphy5l]` … `[^9wojgn]`) are reference definitions with no
inline citation anywhere in the document. Google listed fourteen URLs but
only cited `[1]`–`[7]` in the prose it generated. The parser flags this class
of thing (`orphan-refdef`), but the paste modal converts and inserts them
regardless, and the flags are not surfaced anywhere the user will see them at
paste time.

Whether uncited references should be dropped, kept, or kept-and-marked is a
judgment call worth making deliberately — they are genuinely useful as a
reading list, and genuinely noise in a reference section.

### Where it happens

`src/services/dedupeByUrlService.ts` already implements URL-based citation
consolidation for the standalone *Dedupe by URL* command. The paste path
never calls it. As with Defect 2, the capability exists and is simply
unreachable from this command.

## Root cause

One sentence: **the paste pipeline is a citation-token rewriter, and all
three defects are things a token rewriter structurally cannot do.**

Defect 1 needs a document-structure pass that does not exist. Defects 2 and 3
need passes that *do* exist — `UrlCitationService` (Jina.ai enrichment) and
`dedupeByUrlService` (URL consolidation) — but which the paste path never
calls. The parser is behaving correctly within its contract in all three
cases; the contract is just narrower than what the command's name promises a
user.

A useful reframing: **Paste LLM Content should be a pipeline of passes, not a
single transform.** Normalize structure → convert citations → dedupe by URL →
enrich metadata. Three of those four already exist as code.

## Proposed direction

### For Defect 1 — a provider-gated normalizer, before the parser

Add `src/services/llmContentNormalizerService.ts`, running on the pasted
buffer *before* `transform()`. Pure TypeScript, same testability contract as
the parser, same CLI harness. Dispatch on the modal's existing `provider`
value.

Google AI Overview ruleset, in order:

1. Strip trailing whitespace from every line.
2. `• ` → `- `, then bold a `Lead-in:` prefix into `**Lead-in:**`.
3. Promote heading candidates: a line that is short (≲ 60 chars), has no
   terminal punctuation, is not a bullet, and is followed by a blank line or
   a bullet block → `## `.
4. Drop known boilerplate — `AI responses may include mistakes.` and the
   trailing `Are you …?` conversational offer.
5. Flag (do not drop) a promoted heading with no body beneath it.

Rule 3 is the risky one and should be the first thing tested against a corpus
of real pastes — a short declarative sentence with no period is a plausible
false positive. Consider gating heading promotion behind a modal checkbox
until confidence is earned.

### For Defect 2 — fetch the metadata; wire the enrichment that already exists

The metadata has to come off the live page. Two mechanisms, and they compose
rather than compete:

**Tier 1 — deterministic fetch (build first).**
`UrlCitationService.extractCitationFromUrl()` already fetches title, author,
publish date, and site name via Jina.ai Reader, and `formatCitation()`
already emits the canonical shape. Nothing new needs building; it needs
calling. This handles the common case cheaply, offline-testably, and with no
token spend.

**Tier 2 — LLM fallback for what the fetch can't resolve.** Reader output is
thin or wrong for a meaningful slice of sources: YouTube watch pages, PDF
landing pages, JS-rendered docs sites, and any page whose author sits in
prose rather than a meta tag. For those, hand the fetched page text to a
model with the target format and let it extract author / publish date /
publisher. `lmstud-yo` (local LM Studio bridge) and `perplexed` are both in
this plugin family already, so a local-model path exists that costs nothing
per call.

The routing rule should be **fetch first, model only on gaps** — never
model-first. A deterministic fetch that finds `article:published_time` is
strictly better than a model inferring a date, and cheaper. The model earns
its place exactly where the meta tags are absent.

Whatever the tier, the extracted fields must land in the user's configured
template rather than a hardcoded shape — see the companion issue on
user-definable citation templates.

Shape it as a **separate, opt-in pass** rather than folding it into paste:

- A checkbox in the modal ("Fetch metadata for bare-URL citations"), and/or
- a standalone command, *Enrich link-only citations*, that scans the active
  file for `[^hex]: [url](url)` reference defs and upgrades them in place.

Reasons to keep it separate rather than inline-on-paste:

- **Cost and latency.** The real paste in this report carried 14 URLs. That
  is 14 sequential network calls before the user sees any text land.
- **Rate limits.** Jina.ai Reader throttles unauthenticated traffic;
  `jinaApiKey` exists on the service but the paste path never sets it.
- **Offline and failure degradation.** Paste must keep working with no
  network. A separate pass fails loudly without blocking the primary action.
- **Idempotence.** A standalone command can be re-run over a file to pick up
  references that failed the first time, which an on-paste hook cannot.

The self-link form `[^hex]: [url](url)` is a clean, unambiguous detection
target for that scan — it never occurs in hand-authored content.

### For Defect 3 — run the dedupe that already exists, before hex assignment

`dedupeByUrlService` already consolidates citations by URL. Two things need
deciding:

1. **Order matters.** Dedupe must run *before* hex codes are minted,
   otherwise two hexes exist and every inline marker for the loser has to be
   rewritten. Normalizing URLs first (strip `utm_*`, trailing slash, `#`
   fragment, `www.`) catches near-duplicates that differ only in tracking
   params — Google's reference blocks are full of these.
2. **Uncited references need a policy.** Drop, keep, or keep-under-a-
   subheading. Recommend keep-and-mark: they are the reading list Google
   actually consulted, and silently dropping sources is the wrong default for
   a citation tool. Surfacing the parser's existing `orphan-refdef` flags in
   the modal before insert would let the user decide per paste.

## Open questions

1. **Field order drifts from the spec.** The spec's canonical shape is
   `date. Author. [Title](url). Publisher.`, but
   `urlCitationService.formatCitation()` emits
   `date. "[Title | Site](url)". Author. [Site](siteUrl).` — title and author
   swapped, title quoted, site name folded into the title link. The live
   implementation matches current practice; the spec text does not. One of
   the two should move. Not blocking either fix, but it determines what an
   enriched reference definition should actually look like.
2. **Should normalization be undoable independently of the paste?** If a
   heading promotion guesses wrong, the user's only recourse today is
   Ctrl-Z over the whole insert.
3. **Do YouTube URLs deserve a special path?** Four of the fourteen sources
   here are YouTube. Jina.ai Reader on a watch URL returns a thin result;
   the oEmbed endpoint would give a real title and channel.
4. **Does the post-hoc *Convert LLM Citations* command need the same
   normalizer?** It shares the parser and therefore Defect 2 exactly. Defect
   1 is murkier — by then the content is already in the vault and a user may
   have hand-edited structure that a normalizer would stomp.

## Files implicated

| File | Role |
|---|---|
| `src/modals/PasteLlmContentModal.ts:164-167` | Insert path; where a normalizer pass would be inserted |
| `src/modals/PasteLlmContentModal.ts:63-66` | The inert `provider` selector this work would make load-bearing |
| `src/services/llmCitationParserService.ts:547-561` | `reformatRefDefBodyAsMarkdownLink()` — the `!titleText` self-link branch |
| `src/services/llmCitationParserService.ts:274-287` | Reference-def transform branch that calls it |
| `src/services/urlCitationService.ts` | Existing Jina.ai enrichment, currently unreachable from the paste path |
| `src/services/dedupeByUrlService.ts` | Existing URL consolidation, likewise unreachable from the paste path |
| `scripts/parse-llm-citations.mjs` | CLI harness used to confirm the defects live in the parser, not the host |
| `/Users/mpstaton/content-md/lossless/YANG Data Modeling Language.md` | Live artifact; primary evidence for all three defects |

## Reference

- [[Lossless-Citation-Spec]] — canonical reference-definition format
- [[Modal-for-Pasting-LLM-Native-Content]] — the spec this command was built from
- [[Parse-Common-Citation-Formats]] — provider-shape catalog the normalizer would extend
- [[User-Definable-Citation-Format-Templates]] — companion issue; the enriched
  output shape from Defect 2 must be user-configurable, not hardcoded to the
  Lossless house style
