---
title: "Users need to define their own citation format — the Lossless house style is hardcoded"
lede: >-
  Cite Wide hardcodes one house style across four services. Templating is the feature; centralizing the format is the prerequisite.
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
applies_to: "Every command that writes a reference definition or a citation file — Extract citation from URL, Paste LLM Content, Convert LLM Citations, Save citation to file"
related:
  - "[[Lossless-Citation-Spec]]"
  - "[[Paste-LLM-Content-Drops-Structure-And-Emits-Link-Only-Citations]]"
  - "[[Maximize-Data-Collection-on-Cannonical-Sources]]"
  - "[[Citation-Field-Acquisition-Guide]]"
tags:
  - Issue-Resolution
  - Cite-Wide
  - Citation-Templates
  - Obsidian-Plugin-Settings
  - Extensibility
site_uuid: 3d22b1f3-0650-427c-aea8-c1c907d18035
hex_code: qnf5g6
date_authored_initial_draft: 2026-08-08
date_authored_current_draft: 2026-08-08
---

# Users need to define their own citation format

## The problem

Cite Wide currently emits exactly one citation shape:

```markdown
[^01f3ut]: 2022, Apr 28. "[GMV Retention | Andreessen Horowitz](https://a16z.com/…)". Olivia Moore. [Andreessen Horowitz](https://a16z.com).
```

That is The Lossless Group's house style. It is a good style. It is also
**one person's style**, hardcoded into a plugin published to the Obsidian
community marketplace, where the median user wants APA or Chicago or
whatever their department mandates — and where a citation tool that silently
imposes a house format is a citation tool they uninstall.

The same reasoning that makes hex codes user-agnostic (they render as
sequential numbers, so nobody has to adopt our identifier scheme) should
apply to the reference-definition body. Right now it doesn't.

## Where the format is hardcoded

It is not in one place, and that is the real finding. Four services each
concatenate their own version of the format:

| Location | What it hardcodes |
|---|---|
| `src/services/urlCitationService.ts:184-209` `formatCitation()` | Field order, `. ` separators, the `"[Title \| Site](url)"` quoting, the trailing period |
| `src/utils/citationDate.ts` | `YYYY, Mon DD` — comma placement, three-letter month, zero-padded day |
| `src/services/llmCitationParserService.ts:547-561` | The bare-URL fallback shape |
| `src/services/citationFileService.ts:276,294` | Citation-file frontmatter keys and the body reference line |

Change the house style today and you edit four files and hope you found them
all. That is a maintenance problem before it is a user-facing one — and it
means **step one is centralizing the formatter, which is worth doing whether
or not templating ever ships.**

## What has to be true before templating is useful

A template can only render fields that were actually captured. Today the
acquisition path (`UrlCitationService` → Jina.ai Reader) reliably yields
`title`, `url`, `siteName`, and sometimes `date` and `author`. That is enough
for the Lossless style and **not** enough for APA, which needs author,
year, title, publisher, and often DOI.

So field acquisition is upstream of templating, and the two want to be
designed together:

- [[Maximize-Data-Collection-on-Cannonical-Sources]] already argues for
  capturing maximal metadata regardless of what the current format uses.
  Templating is the payoff that justifies that work.
- [[Citation-Field-Acquisition-Guide]] is where the per-field sourcing rules
  belong.
- A template referencing a field the acquisition layer never captures must
  degrade visibly, not silently emit an empty segment.

## Design questions to settle

### 1. Roll our own, or adopt CSL?

**Citation Style Language** is the actual standard here — XML, ~10,000
published styles, and the engine behind Zotero, Mendeley, and Pandoc. Adopting
it means every style a user could ask for already exists.

It also means shipping an XML-driven CSL processor inside an Obsidian plugin
whose entire value proposition is being lightweight, and mapping our
field vocabulary onto CSL's item types. `citeproc-js` is roughly 500KB.

Recommendation: **roll a small template layer, design its field vocabulary to
be CSL-compatible**, and leave a CSL adapter as a later option for users who
need real academic styles. Most Obsidian users writing notes want "author,
year, title, link" in an order they picked — not conformance to APA 7th.

Before committing either way, this is a textbook case for the
`study-repos-first` discipline: pin `citation-style-language/styles` and
`citeproc-js` into a study and read what the standard actually requires.

### 2. Template syntax — placeholders alone won't survive missing fields

The naive version:

```
{{date}}. "[{{title}} | {{siteName}}]({{url}})". {{author}}. [{{siteName}}]({{siteUrl}}).
```

This breaks the moment a field is absent, which is the common case — Jina.ai
returns no author for most pages. Render that template with no author and you
get `… )". . [Site](url).` — a stranded period and a double space.

Handling it with inline conditionals gets unreadable fast:

```
{{#author}}{{author}}. {{/author}}
```

**Recommended alternative — a segment list.** Each segment carries its own
template and its own required fields, and a segment whose required fields are
missing is dropped whole, separator included:

```yaml
citation_template:
  separator: ". "
  terminator: "."
  segments:
    - template: "{{date:YYYY, Mon DD}}"
      requires: [date]
    - template: '"[{{title}} | {{siteName}}]({{url}})"'
      requires: [title, url]
    - template: "{{author}}"
      requires: [author]
    - template: "[{{siteName}}]({{siteUrl}})"
      requires: [siteName]
```

This is legible in a settings textarea, it degrades correctly by
construction, and it is close enough to CSL's `group` + `delimiter` semantics
that a later adapter is plausible. It also makes the "drop the whole segment"
rule explicit rather than emergent.

### 3. Date formatting needs its own mini-language

`YYYY, Mon DD` is one of many. Users will want `YYYY-MM-DD`, `MMMM D, YYYY`,
`D MMM YYYY`, or bare `YYYY`. A `{{date:FORMAT}}` token with a small
documented set of pattern letters covers it without pulling in a date
library.

Note the existing precision rule in `citationDate.ts` must survive: a source
that published `2025-04` renders `2025, Apr`, not a fabricated day. The
formatter has to know a date's *precision*, not just its value — so the
internal date representation should carry precision alongside the timestamp
rather than being a formatted string.

### 4. Scope — where does a template live?

Options, roughly in order of increasing power:

1. **Vault-wide setting** — one template in `CiteWideSettings`. Simplest,
   covers the stated need, ships first.
2. **Named presets** — ship Lossless / APA-ish / MLA-ish / IEEE-ish /
   minimal, user picks one and can fork it. Low cost, high perceived value,
   and the presets double as documentation of the syntax.
3. **Per-folder** — a different style for `/academic` than for `/notes`.
   There is prior art in the family for per-directory profiles.
4. **Per-note frontmatter override** — `citation_template: apa` in a note's
   frontmatter.

Recommend shipping 1 + 2 together and treating 3 and 4 as demand-driven.

### 5. What templating does NOT cover

Worth stating explicitly so scope doesn't creep:

- **Inline markers stay `[^hex]`.** They are structural, they render as
  sequential numbers, and they are not a style choice.
- **The `[^hex]: ` prefix stays.** That is markdown footnote syntax, not
  house style.
- **Spacing rules around inline citations stay enforced.** Per
  [[Lossless-Citation-Spec]], exact spacing is what makes Obsidian's hover
  preview and click-to-jump work. That is a correctness constraint, not a
  preference.

Templating governs the reference-definition **body** and the citation-file
frontmatter. Nothing else.

### 6. Migration

Changing the template must not silently rewrite existing citations — a user
with 4,000 reference definitions should not have them all churn on a settings
save. But a deliberate *Reformat all citations to current template* command
is clearly wanted, and it is only safely possible if reference definitions
can be **parsed back** into fields, not just written out.

That round-trip requirement is a real design constraint on the template
language: an arbitrarily free-form template is not invertible. Options are to
accept one-way rendering and reformat only from canonical citation files
(where the fields live in frontmatter), or to constrain templates enough to
stay parseable. **The citation-file-as-source-of-truth route is the sound
one** — it is already where [[Citation-Acquisition-Pipeline]] was heading.

## Proposed direction

Sequenced so each step is useful on its own:

1. **Centralize.** Extract one `citationFormatterService` that every
   write path calls. Behavior-preserving; the Lossless format becomes the
   hardcoded default in exactly one place. *This is worth doing this week
   regardless of everything below.*
2. **Parameterize.** Move the format into a settings-backed segment list with
   the current style as the shipped default. No UI beyond a textarea.
3. **Preset.** Add named presets and a picker. Presets document the syntax
   better than docs will.
4. **Round-trip.** Add *Reformat all citations*, sourced from canonical
   citation files.
5. **Consider CSL.** Only if users actually ask for real academic styles.

## Open questions

1. Does the citation-file frontmatter schema get templated too, or is it
   fixed so Dataview queries stay portable across users? (Leaning fixed —
   a queryable schema is worth more than cosmetic freedom.)
2. Should a template be shareable as a file in the vault, so a team can
   commit one house style to a repo? That would suit the Lossless content
   team directly.
3. How does an LLM-based extraction pass (see the companion issue) learn the
   target shape — is it handed the rendered template as a few-shot example,
   or does it always emit canonical fields that the formatter then renders?
   (Strongly prefer the latter: models should produce data, not formatting.)
4. What is the fallback when a template references a field no acquisition
   path ever populates? Silent drop, visible placeholder, or a settings-time
   validation warning?

## Reference

- [[Lossless-Citation-Spec]] — the current, soon-to-be-default-not-mandatory format
- [[Maximize-Data-Collection-on-Cannonical-Sources]] — why capture exceeds current need
- [[Citation-Field-Acquisition-Guide]] — per-field sourcing rules
- [[Citation-Acquisition-Pipeline]] — canonical citation files as source of truth
- [[Paste-LLM-Content-Drops-Structure-And-Emits-Link-Only-Citations]] — companion issue; its enrichment output must render through whatever this issue lands on
