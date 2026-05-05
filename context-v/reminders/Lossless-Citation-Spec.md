---
title: "The Lossless Citation Open Specification"
date_created: 2024-09-06
date_modified: 2025-04-22
publish: true
authors:
 - Michael Staton
tags:
 - Extended-Markdown
 - Markdown-Citations
 - Obsidian-Flavored-Markdown
---

# Always use the Lossless Citation Spec for Cite Wide.

## Disambiguation:

To make sure you understand the syntax choices in this spec:
- The `{}` brackets denote a variable declaration, and will not be part of the string output.
- When using `[^{id}]` the `{id}` is a variable that will be replaced with a value.
- When using `[^N]` where N is a number, this is a numeric citation.
- When using `[^{hexCode}]` where hexCode is a hex code, this is a hex code citation -- our goal and preference but not strictly enforced on our content team. (They develop a lot of content, many files will be in progress and not yet on the priority list to refine to Lossless standards.)
- Where `citation_id` or `id` could be either a hexCode or a numeric identifier. Our preference is for hex codes, but we may run some scripts to transform the content prior to full conversion to hexCodes, so numerica identifiers should not prevent the use of any script or command.

## Preference for Hex Codes, always use Hex Codes for Cannonical Sources saved into the Cannonical System
We will use good sources in many documents, and we will copy paste them from one to another.  So we cannot have numeric collisions due to carelessness. Content creators should not be spending their time scouting for collisions. So, we have Cite Wide as a plugin that can use scripts to automatically generate hex codes for citations and substitute numerics.

Hex Codes are then rendered as numeric citations in the order they appear by either a Markdown editing app like Obsidian, or on our various websites where we render markdown content.

Reference sections at the bottom of the file will also reorder to match the appearances of the rendered citations citations as integers, and do so in a pair-bonded fashion where all inline citations are tracked in memory/state and their corresponding reference sections are reordered accordingly.


## Inline Citations

Inline citations should use the reference_hexcode as the identifier, and use exact syntax ` [^{hexCode}]`. 
- A single space must stand between the content and the citation: ` [`.
- No space can come after the final inline citation. ` [^abc123]`
- The citation must always be outside/after the closing punctuation of the sentence or clause. `. [^{hexCode}]`, `, [^{hexCode}]` or `: [^{hexCode}]` or `; [^{hexCode}]`
- If multiple citations are used in sequence, they must be separated by a single space: ` [^{hexCode1}] [^{hexCode2}]`

## Prompt in context:
  I actually have a little usability bug fix for you that shouldn't be an issue.

  I ran the command in Obsidian to: `Move Citations after Punctuation` and it did it's job when it comes to moving citations after punctuation with enforcing `{punctuation-Char} [^` <-- However, it left out edge cases where the citation is right up against an alphanumeric character without a space.

  For example, in the file `/Users/mpstaton/content-md/lossless/Agent Standards.md`, you can see many instances where there is no space character between the final alphanumeric character of a word or phrase or bullet point, where no punctuation is used.

For context, exact spacing is required for Obsidian to properly render citations as clickable links that have the behavior: hovers over -> gets preview, user clicks -> jumps to reference definition. This is also true for all of our websites we maintain.  

> [!IMPORTANT] The expectation is that ALL the inline citations have the proper behavior on render.

  So, maybe two requests:
  - Add functionality to the parser that includes catching places in the file where the `[^` opening
   bracket has no space preceeding it, for both punctuation and alphanumeric characters.
  - Assure both are included in the script/transform operation
  - Rename the command to `Assure Spacing for Anchor Link behavavior`

  (Note: the command already properly assures a space between a series of citations inline, so `
  [^{id1}] [^{id2}]` and we need to keep that.)

  Example file I ran it on, you can see that there is no space character between the final
  alphanumeric character where no punctuation is used: `/Users/mpstaton/content-md/lossless/Agent Standards.md`

## Reference Sections

Reference sections must:
- citation identifiers must always start at the beginning of a new line with no space before them.
- always use a `: ` after the citation identifier (a colon and a single space): `[^{citation_id}]: `

Reference sections should:
- use the correct, paired reference hexCode as the identifier, and use `[^{hexCode}]: `. 
- use proper markdown links rather than raw links `[String, usually title or Accesibility detial](url)`
- Use Lossless standard reference formatting

## Lossless Standard Reference Formatting
```markdown
[^{hexcode}]: 2025, Jan 25. {Author Surname, First Name}. [Title of the source](url). Source Publisher Name || [Source Publisher Name](url). Accessed {Month Day, Year}.
```


***
CLAUDE CONSIDERATIONS
***

# Claude / Anthropic Citations API — Extension to the Spec

The Claude Messages API returns structured citations in two distinct ways depending on the source:

- **Web search** (`web_search_20260209` tool): citations are **always enabled** — no opt-in flag needed (and none accepted). The tool itself takes no `citations` parameter; per-claim citations arrive automatically as `web_search_result_location` entries on text blocks, and the underlying search results are also available verbatim in `web_search_tool_result` blocks.
- **Document sources** (PDF / plain-text / custom-content blocks): citations are **opt-in** — set `citations: { enabled: true }` on each document source block. "Currently, citations must be enabled on all or none of the documents within a request" (Anthropic citations docs). Per-claim citations arrive as `page_location` / `char_location` / `content_block_location` entries on text blocks.

Each entry references either a web search result or a position inside an attached document. This section maps that data onto the Lossless reference-definition format above.

The inline marker (`[^{hexcode}]`) is unchanged. All differences live in the reference-definition body. Hex-code generation, namespace, and pair-bonded reordering are all unchanged — Claude-sourced citations interleave with Perplexity-sourced ones in the same reference section.

## Web-Search Citations — current focus

This is the dominant case. Our research workflows go through web-search APIs and get back URLs; PDFs returned from those workflows are near-zero in practice. Document-grounded citations are documented further down for completeness but are not the immediate implementation target.

When Claude cites a web search result it returns per citation:

- `url` — the source URL
- `title` — the page title
- `cited_text` — the verbatim passage Claude is quoting

`url` and `title` map directly into the standard URL format above. The new addition is `cited_text`, appended as a trailing markdown blockquote on the same line:

```markdown
[^{hexcode}]: 2025, Jan 25. {Author Surname, First Name}. [Title](url). Publisher Name || [Publisher Name](url). Accessed {Mon Day, Year}. > {cited_text}
```

### Cited-text rules

- **No length cap.** Insert the verbatim passage Claude returned, full length. Verifiability matters more than file tidiness.
- **Web-side rendering**: the Lossless web renderer strips everything from the first `>` character onward in a reference-def body before publishing. The cited_text lives in the markdown for parser, audit, and verification use; it never reaches the published page. Markdown carries the full quote; web hides it.
- **Multi-line cited_text** from the API: collapse internal newlines to single spaces inside the reference def. Single-line refdefs are easier for the parser and for the trim-from-`>` web renderer to handle deterministically.

### Bibliographic metadata sourcing (author / date / publisher)

The standard reference format expects `{Year}, {Mon Day}`, `{Author}`, `{Publisher}`, `Accessed {Mon Day, Year}`. Where these come from depends on whether the citation has been promoted to canonical:

- **Canonical sources** (those promoted into the Citations folder with a full schema YAML file) — pull `authors[0]`, `date_published`, `publisher`, `date_recently_accessed` from the source's YAML frontmatter at render time. The reference def is generated from the canonical record, not the LLM response. Property-name variations across providers (`date` vs `date_published` vs `last_updated`) are mapped at this layer.
- **Ad-hoc sources** (citations not yet promoted) — use whatever the LLM provider returned. Claude returns `title` + `url` + `cited_text`; Perplexity's `search_results` returns `title` + `url` + `date` + `last_updated`. Author and publisher are commonly absent from API responses; emit the reference def with the fields you have and skip the unknown ones rather than fabricating.

### Multi-location citations

When the model returns multiple citation locations for the same cited passage — two URLs supporting one statement, or the same passage attributed to two attached documents — emit **one reference def per location with separate hex codes**. Inline, the markers appear in sequence with single-space separation: `... claim. [^a3f29c] [^b7e210]`. Do not collapse into a single multi-source refdef.

Rationale: separate hex codes preserve parser distinguishability and round-trip fidelity, and they let the pair-bonded reorderer handle the citations independently.

> **Open (parser-side):** When two refdefs share the same URL but cite different page or char ranges (rare; mostly relevant once document-grounded citations are wired up), the pagination value in the refdef body is the only thing distinguishing them. Duplicate-detection passes must compare the full body, not just the URL.

## Document-Grounded Citations — deferred / informative

> **Status:** Documented for completeness; not the current implementation focus. PDFs and plain-text uploads are extremely rare in our current workflows. The page / char / block reference shapes below will guide a future iteration when we add support for attaching documents to a Claude request end-to-end.

When Claude cites a position inside an attached document, the reference-def body uses a different shape: the link points at the local document, the position marker is page / char / block, and `cited_text` is the cited excerpt. The `cited_text` rules and bibliographic-metadata sourcing rules above still apply — only the link target and position marker change.

Default local-document path: `Citations/_attached/` (configurable via plugin setting).

### Page-located (PDF)

```markdown
[^{hexcode}]: {Year}, {Mon Day}. {Author Surname, First Name}. [{Document Title}]({local_path}). pp. {start_page}–{last_page}. > {cited_text}
```

- `last_page = end_page_number − 1` because Anthropic's `end_page_number` is exclusive.
- Single page collapses to `p. {page}`.
- En-dash (`–`, U+2013) between page numbers, not a hyphen.

### Character-located (plain-text source)

```markdown
[^{hexcode}]: [{Document Title}]({local_path}). chars {start_char}–{end_char}. > {cited_text}
```

`start_char_index` is 0-indexed inclusive; `end_char_index` is 0-indexed exclusive. Preserve API indices verbatim — downstream re-location tools need the original numbers.

### Block-located (custom multi-block source)

```markdown
[^{hexcode}]: [{Document Title}]({local_path}). blocks {start_block}–{end_block}. > {cited_text}
```

Same indexing convention as char ranges (0-indexed inclusive start, exclusive end).

## Field Mapping — Claude citation object → reference definition

| Claude API field | Renders as | Applies to |
|---|---|---|
| `cited_text` | trailing `> {text}` blockquote | all citation types |
| `url` | `(url)` in markdown link | web-search type (current focus) |
| `title` | `[Title]` link text | web-search type (current focus) |
| `document_title` | `{Document Title}` link text | document-grounded types (deferred) |
| `document_index` | resolved internally to a `local_path` | document-grounded types (deferred) |
| `start_page_number` / `end_page_number` | `pp. {start}–{end−1}` (or `p. {start}` collapsed) | `page_location` only |
| `start_char_index` / `end_char_index` | `chars {start}–{end}` | `char_location` only |
| `start_block_index` / `end_block_index` | `blocks {start}–{end}` | `content_block_location` only |

## What This Extension Does NOT Change

- **Inline citation placement**: still `[^{hexcode}]` with the same spacing rules.
- **Hex-code generation**: Claude-sourced citations get hex codes the same way Perplexity-sourced ones do; shared namespace, no collision risk.
- **Reference section ordering**: still pair-bonded — multiple inline citations may pair with the same reference definition — and reordered by appearance order. Claude refs and Perplexity refs intermix freely in the same Citations section.
- **The standard URL-based reference format**: remains the default. This extension adds the `cited_text` blockquote suffix, the multi-location → multi-refdef rule, and the deferred document-grounded body shapes.

## Companion Schema Note

When a citation is promoted to canonical (saved as a markdown file in the Citations folder with full YAML frontmatter), the corresponding YAML fields for document-grounded citations are defined in `context-v/blueprints/Lossless-Citation-Standards.md` under the "Document-grounded citation fields" section. Those fields apply only to citations that originated from an attached document; web-search citations don't populate them.
