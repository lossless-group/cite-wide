---
title: "Issue: Footnote References Orphaned From Their Definitions Across 111 Content Files"
lede: "13% of the hex-code footnotes in the content repo point at nothing. The sources exist on the page, but the link between reference and source is gone."
summary: "Found 2026-11-17 while reviewing /market-categories/video-intelligence-for-manual-labor-with-data-labeling on lossless-site. 111 of 1,660 footnoted files in lossless-content have [^hexcode] references with no matching [^hexcode]: definition; 2,057 of 15,805 references are orphaned. In 50 files the sources are still listed as plain numbered [N]: lines that nothing points to; in 61 there are no definitions at all. Hex codes are random, so the mapping can't be derived or recovered from git. Records the evidence, the suspected converter bugs in citationService.convertAllCitations, the display stopgap shipped in lossless-site, and the full affected-file list for cleanup."
publish: true
date_created: 2026-11-17
date_modified: 2026-11-17
date_authored_initial_draft: 2026-11-17
date_authored_current_draft: 2026-11-17
date_authored_final_draft:
authors:
  - Michael Staton
augmented_with:
  - Claude Code on Claude Opus 5.5
at_semantic_version: 0.0.0.1
site_uuid: 08f57db4-19cb-4e9b-ac11-3ff9cf8514b9
hex_code: ssihcg
status: Open
tags:
  - Issue
  - Citations
  - Footnotes
  - Data-Integrity
  - Content-Repos
type: Issues
---

# Issue: Footnote References Orphaned From Their Definitions

## Why care?

A reader clicks a citation and nothing happens, or sees raw `[^fh0on7]` text in
the middle of a sentence. The claim is sourced, the source is even listed at the
bottom of the page, but the two are no longer connected. Across the content repo
that is 2,057 citations on 111 pages, including reference cards we lean on, like
OAuth 2.0, Crew AI and several Market Categories.

## What we found

Checked 2026-11-17 against `lossless-content` at `3a2b04c8`. For every markdown
file, each `[^label]` reference was matched against a `[^label]:` definition in
the same file.

| | Count |
|---|---:|
| Files with footnote references | 1,660 |
| Files with at least one orphaned reference | **111** |
| Orphaned references / all references | **2,057 / 15,805** (13%) |
| Orphaned files that still list sources as numbered `[N]:` lines | 50 |
| Orphaned files with no definitions for the orphans at all | 61 |

By folder: tooling 30, vocabulary 19, concepts 18, lost-in-public 9, sources 7,
organizations 5, client-content 5, Citations 5, essays 4, projects 3.

### The worked example

`concepts/Market-Categories/Video Intelligence for Manual Labor with Data Labeling.md`:

- 95 distinct hex references in the body.
- 50 lines under `# Sources`: 10 in the converted form
  (`[^0ywhiy]: [Data Collection And Labeling…](…)`) and 40 still numbered
  (`[2]: [Video Analytics Market Size…](…)`).
- So 40 sources sit unreferenced, and about 45 references have no source line of
  any kind.
- Every version of the file in git already has 173 hex references and no
  numeric ones. The broken state came in with the first commit, so the
  history can't restore it.

## Why we can't just relink them

- **Hex codes are random.** `CitationService.generateHexId()` uses
  `Math.random()`, so a code can't be recomputed from a URL or a number.
- **Order doesn't line up.** Tested on the example file: the 10 definitions that
  did convert sit at positions 1, 4, 9, 12, 16, 17, 19, 22, 35, 39, but their codes
  first appear in the body at ranks 13, 14, 17, 16, 87, 80, 9, 79, 78, 67. Numbering
  isn't first-use order, so position can't stand in for the mapping.
- **No record of the mapping exists.** The number→hex map lives only in memory
  for one run (`hexIdMap` in `convertAllCitations`).

Any guess-based relink would attach claims to the wrong sources, which is worse
than an unlinked marker.

## Suspected causes in cite-wide

Not yet confirmed by a test. Each is a lead to reproduce first.

1. **Stale positions in `convertAllCitations`.** The first pass replaces body
   citations at character offsets computed from the original text, front to
   back, per group. Each `[2]` → `[^xxxxxx]` swap lengthens the text by six
   characters or more, so every later offset is stale and the replacement lands
   in the wrong place. `convertCitation` sorts its matches in reverse "to avoid
   position shifting"; `convertAllCitations` doesn't.
   (`src/services/citationService.ts`, the "First pass" loop.)
2. **Re-running conversion re-mints every hex code.** `extractCitations` treats an
   existing `[^abc123]` as group `hex_abc123` and `convertAllCitations` gives it a
   *new* code. The body is rewritten by offset; the definition is rewritten only
   if a line starts with exactly `[^abc123]`. If the definition is numbered, or
   the body offset was stale, the two diverge.
3. **Definitions only convert when their number appears in the body.** Groups are
   built from body references only (definition lines are skipped), so a numbered
   `[N]:` line whose `[N]` never appears in the body is never converted.
4. **Pasted LLM output mixes formats.** Some sources arrive with `[N]` in the body
   and `[N]:` definitions, others with link-only citations. See
   [[Paste-LLM-Content-Drops-Structure-And-Emits-Link-Only-Citations]], which
   already notes one URL getting two hex codes.

## Stopgap shipped

lossless-site, 2026-11-17 (uncommitted at the time of writing):

- `src/utils/markdown/remark-footnote-numbers.ts` numbers footnotes on render, the
  LFM convention: cited definitions take 1…n by first reference, uncited ones
  continue the count and still render. Legacy `[N]:` source lines that GFM folds
  into the previous definition are split out into their own entries, so their
  stale numbers never collide with the new ones.
- `AstroMarkdown.astro` shows `[n]` inline and in Sources, and renders a
  reference with no definition as a faded, unlinked `[?]` (hex code in the
  tooltip) instead of raw text.

On the worked example: 13 linked references numbered [1]…, 50 sources listed
[1]–[50], 150 references faded, no broken anchors. This hides the symptom; the
orphaned claims still have no source.

## Cleanup plan

1. **Reproduce and fix the converter first,** so cleanup isn't undone by the next
   run. Write a test per suspected cause above: a file with 12+ numbered
   citations (two-digit numbers change length), a second run over an
   already-converted file, and a definition whose number never appears in the
   body.
2. **Add a check that fails loudly.** After any conversion, every `[^x]` in the
   body must have a `[^x]:` and every definition must be referenced; refuse to
   write the file otherwise. A content-repo lint over the same rule would catch
   regressions from any tool.
3. **Re-source the affected pages.** The mapping is gone, so each page needs its
   citations regenerated from the underlying research, or reattached by a person
   reading claim against source. Start with the worst pages (table below). For
   the 50 files with numbered `[N]:` lines, those sources are still good material
   for re-attaching by hand.
4. **Drop the stopgap's need.** Once the lint passes across the repo, the muted
   marker should never render; keep it as a safety net.

## Affected files

Generated 2026-11-17, sorted by orphaned references.

| File (under `content/`) | Unmatched | Total refs | Numbered `[N]:` defs |
|---|---:|---:|---:|
| `sources/Standards-and-Specs/OAuth 2.0.md` | 156 | 174 | 32 |
| `sources/Standards-and-Specs/Graphics Interchange Format.md` | 116 | 124 | 42 |
| `tooling/AI-Toolkit/Agentic AI/Agentic Workspaces/Crew AI.md` | 107 | 134 | 21 |
| `vocabulary/Agile Software Development.md` | 103 | 103 | 0 |
| `concepts/Market-Categories/Biometric Monitoring.md` | 95 | 107 | 38 |
| `essays/From Rags to Riches.md` | 93 | 93 | 0 |
| `concepts/Version Control.md` | 87 | 87 | 0 |
| `concepts/Market-Categories/Video Intelligence for Manual Labor with Data Labeling.md` | 85 | 95 | 40 |
| `tooling/AI-Toolkit/Agentic AI/Agentic Workspaces/Writer.md` | 83 | 129 | 5 |
| `sources/Books/Positioning.md` | 77 | 77 | 0 |
| `tooling/AI-Toolkit/AI Interfaces/AI Workspaces/Vertical Wrappers/Fin AI.md` | 73 | 112 | 11 |
| `tooling/AI-Toolkit/Agentic AI/Agentic Workspaces/Kestra.md` | 65 | 84 | 31 |
| `tooling/AI-Toolkit/Agentic AI/Agentic Workspaces/Synthflow.md` | 63 | 83 | 31 |
| `tooling/AI-Toolkit/Agentic AI/Agentic Workspaces/Dust.tt.md` | 59 | 86 | 24 |
| `tooling/Enterprise Jobs-to-be-Done/Mercury Bank.md` | 59 | 80 | 29 |
| `tooling/AI-Toolkit/Agentic AI/Agentic Workspaces/Mutiny.md` | 59 | 75 | 34 |
| `tooling/Software Development/Developer Experience/DevOps/Terraform.md` | 58 | 78 | 30 |
| `tooling/AI-Toolkit/Requesty.md` | 57 | 85 | 22 |
| `tooling/AI-Toolkit/Agentic AI/Agentic Workspaces/ThoughtSpot.md` | 57 | 84 | 24 |
| `tooling/AI-Toolkit/Agentic AI/Agentic Workspaces/Sintra.md` | 45 | 76 | 20 |
| `tooling/AI-Toolkit/Agentic AI/Zep.md` | 43 | 71 | 22 |
| `tooling/AI-Toolkit/Concentrate AI.md` | 39 | 58 | 31 |
| `tooling/AI-Toolkit/Agentic AI/Agentic Workspaces/Datagrid.md` | 39 | 48 | 42 |
| `tooling/Enterprise Jobs-to-be-Done/Scratchpad.md` | 27 | 35 | 42 |
| `concepts/Skeumorphism.md` | 27 | 27 | 0 |
| `tooling/AI-Toolkit/Knowledge AI/Supdata.md` | 23 | 47 | 26 |
| `organizations/HashiCorp.md` | 19 | 47 | 22 |
| `tooling/Creative/Canvid.md` | 13 | 29 | 35 |
| `concepts/Explainers for AI/Fine Tuning.md` | 10 | 10 | 0 |
| `projects/Content-Farm/Specs/Implement-a-Vault-Wide-Citations-Manager.md` | 9 | 16 | 0 |
| `tooling/Software Development/Frameworks/Web Frameworks/Fastify.md` | 9 | 9 | 0 |
| `tooling/AI-Toolkit/Agentic AI/Agentic Workspaces/Flint.md` | 8 | 30 | 11 |
| `tooling/Enterprise Jobs-to-be-Done/Lattice.md` | 8 | 23 | 3 |
| `sources/Events/Private Company Software & Internet Conference.md` | 8 | 8 | 0 |
| `lost-in-public/prompts/data-integrity/Refactored-Citations-Observer.md` | 7 | 12 | 0 |
| `vocabulary/Web Scraping.md` | 7 | 7 | 0 |
| `sources/Source Extracts/The Era of Open Innovation.md` | 7 | 7 | 0 |
| `tooling/Software Development/Programming Languages/Mojo Language.md` | 6 | 18 | 18 |
| `vocabulary/Bipartite Graphs.md` | 6 | 17 | 25 |
| `concepts/Event-Driven Architecture.md` | 5 | 30 | 6 |
| `lost-in-public/market-maps/Agentic AI in Medicine.md` | 5 | 10 | 0 |
| `vocabulary/Forked Repositories.md` | 5 | 5 | 0 |
| `vocabulary/3D Graphics.md` | 5 | 5 | 0 |
| `tooling/AI-Toolkit/AI Interfaces/AI Workspaces/Vertical Wrappers/Catio.md` | 5 | 5 | 0 |
| `sources/Books/Crossing the Chasm.md` | 5 | 5 | 0 |
| `concepts/Explainers for Tooling/Vertical Wrappers.md` | 5 | 5 | 0 |
| `concepts/Explainers for AI/AI Web Crawlers.md` | 5 | 5 | 0 |
| `concepts/Design Research.md` | 5 | 5 | 0 |
| `concepts/Demand Generation.md` | 5 | 5 | 0 |
| `concepts/Data Augmentation Workflows.md` | 5 | 5 | 0 |
| `client-content/Hypernova/Files/Portfolio/Ontra.md` | 5 | 5 | 0 |
| `client-content/Hypernova/Files/Portfolio/Blue Layer.md` | 5 | 5 | 0 |
| `tooling/Software Development/Cloud Infrastructure/Cloudflare.md` | 4 | 24 | 10 |
| `concepts/Explainers for AI/Agentic Observability.md` | 4 | 24 | 2 |
| `client-content/Water-Foundation/Regent Craft.md` | 4 | 11 | 8 |
| `vocabulary/Multi-Modal Databases.md` | 4 | 4 | 0 |
| `projects/Content-Farm/Specs/Integrate-Features-into-an-Obsidian-Plugin.md` | 3 | 3 | 0 |
| `essays/Web Security is about Preventing Naivety.md` | 3 | 3 | 0 |
| `vertical-toolkits/IndustrialTech/Spot AI.md` | 2 | 11 | 4 |
| `lost-in-public/prompts/data-integrity/Another-attempt-at-Citation-Processing.md` | 2 | 7 | 0 |
| `projects/Astro-Knots/Specs/Maintain-a-Proprietary-Extended-Markdown-Flavor-Rendering-Pipeline.md` | 2 | 2 | 0 |
| `lost-in-public/prompts/workflow/Implement-a-Specific-Task-as-Part-of-Larger-Specification.md` | 2 | 2 | 0 |
| `lost-in-public/prompts/data-integrity/Integrate-Citations-Format-Hex-into-Observer.md` | 2 | 2 | 0 |
| `lost-in-public/market-maps/Agentic AI in Fintech.md` | 1 | 101 | 0 |
| `concepts/Explainers for AI/Artificial Intelligence.md` | 1 | 57 | 4 |
| `vocabulary/Advanced Spreadsheets.md` | 1 | 49 | 12 |
| `vocabulary/Business Process Automation.md` | 1 | 43 | 18 |
| `vocabulary/Personalized Medicine.md` | 1 | 40 | 4 |
| `content-areas/Finance/Private-Markets/Concepts/Fund-of-Funds.md` | 1 | 37 | 24 |
| `sources/Books/Originals.md` | 1 | 37 | 0 |
| `vocabulary/Data Centers.md` | 1 | 34 | 0 |
| `concepts/Identity and Access Management.md` | 1 | 25 | 19 |
| `essays/The Geography of Innovation.md` | 1 | 22 | 6 |
| `lost-in-public/market-maps/AI Benchmarking and Leaderboards.md` | 1 | 20 | 0 |
| `tooling/Software Development/DevOps/Apache Flink.md` | 1 | 19 | 2 |
| `concepts/Explainers for Tooling/Vector Databases.md` | 1 | 19 | 1 |
| `essays/Load up on CARBS.md` | 1 | 18 | 6 |
| `vocabulary/Ambient Awareness.md` | 1 | 17 | 2 |
| `tooling/Enterprise Jobs-to-be-Done/Smartsheet.md` | 1 | 16 | 2 |
| `tooling/AI-Toolkit/Generative AI/Fish Audio.md` | 1 | 13 | 23 |
| `vocabulary/Workflow Automations.md` | 1 | 11 | 2 |
| `vocabulary/Butter FS.md` | 1 | 9 | 0 |
| `tooling/Creative/VEED.md` | 1 | 8 | 4 |
| `vocabulary/Layer 1.md` | 1 | 8 | 0 |
| `vocabulary/Affinity Networks.md` | 1 | 8 | 0 |
| `organizations/Deloitte.md` | 1 | 8 | 0 |
| `organizations/Sergey Brin Family Foundation.md` | 1 | 7 | 0 |
| `tooling/Enterprise Jobs-to-be-Done/Wix.md` | 1 | 6 | 7 |
| `vocabulary/Low-Code.md` | 1 | 6 | 2 |
| `client-content/Hypernova/Files/KearnyJackson_Memo.md` | 1 | 6 | 0 |
| `concepts/Product Lifecycle.md` | 1 | 5 | 0 |
| `organizations/NixOS.md` | 1 | 2 | 4 |
| `vocabulary/Large Language Models.md` | 1 | 2 | 0 |
| `tooling/AI-Toolkit/AI Programming Frameworks/Microsoft Copilot Studio.md` | 1 | 2 | 0 |
| `lost-in-public/explorations/Multi-Agent-Orchestration-for-Investment-Memo-Generation.md` | 1 | 2 | 0 |
| `concepts/Stack Compatibility.md` | 1 | 2 | 0 |
| `vocabulary/Content Materialization.md` | 1 | 1 | 0 |
| `vocabulary/Citations.md` | 1 | 1 | 0 |
| `organizations/Patchwork Collective.md` | 1 | 1 | 0 |
| `lost-in-public/prompts/workflow/Generate-Investment-Memo-for-Portfolio-Company.md` | 1 | 1 | 0 |
| `content-areas/AI-Factories-Datacenters/Organizations/NAFEMS.md` | 1 | 1 | 0 |
| `content-areas/AI-Factories-Datacenters/Organizations/Collen Construction.md` | 1 | 1 | 0 |
| `concepts/Visual Leadership.md` | 1 | 1 | 0 |
| `client-content/Link-Freedom-Group/Proposals/Lossless-Group-Projects-as-Community-Tools/v1/sections/05-lossless-flavored-markdown.md` | 1 | 1 | 0 |
| `changelog--code/2025-08-09_01.md` | 1 | 1 | 0 |
| `changelog--code/2025-03-27_01.md` | 1 | 1 | 0 |
| `Citations/v63nrm.md` | 1 | 1 | 0 |
| `Citations/su9e7c.md` | 1 | 1 | 0 |
| `Citations/enj8u7.md` | 1 | 1 | 0 |
| `Citations/d7dfnt.md` | 1 | 1 | 0 |
| `Citations/12x9ms.md` | 1 | 1 | 0 |

## See also

- [[Paste-LLM-Content-Drops-Structure-And-Emits-Link-Only-Citations]]
- [[Enriching-the-Lossless-Vault-Citations]]
- `src/services/citationService.ts`: `extractCitations`, `convertAllCitations`,
  `convertCitation`, `generateHexId`
