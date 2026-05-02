
# Context

## Vision for Content
 The reasoning is that we all believe that developing a personal knowledge base, contributing that
  to an organizational knowledge base, and the principal that everyone can use content anywhere and
  all of our content belongs to all of us, communist style, means that we intend to use
  sub-tech-giant scale content but beyond-human-level scale content for things in the future that
  will only be possible if we have it.

  So, another project i am building an Investment Memo Orchestrator.  It does live searches every
  time.  But, if I had content like - transcripts from every meeting, every conference, even every
  youtube video, downloaded HTML files from every article I saved, etc.  I build up a knowledge base
   or second brain that can serve to feed a Vector Database, which can give me my own RAG/KAG
  pipeline and dramatically inform an Investment Memo.  We are imagining getting Claude to reason as
   we do, or maybe not Claude but some agent somewhere.  So, we are starting by treating our content
   as data we intend to keep, port, reuse, and continue to build out.

## Discipline with Restraint

  The rich schema is only applied to a few sources per piece of our content. So, if I was to generate
  and edit an investment memo, I might use 40+ sources.  But there will only be 1-5 that I want to prompopte 
  to a cannonical archive.  "Does this deserve to go into our Library of Congress?"
  These are sources we're consciously canonicalizing into the second brain -- and we want the personal 
  second brain and the organizational second brain to be aligned. Any person can take the organizational 
  second brain and make it their own, and leave us with it. That's the incentive for people to contribute 
  to the organizational second brain. It's a Second Brain Collective. The light Citations format we
  already have stays for ad-hoc pasted research. That's clean — and it maps onto the explicit-save
  flow we just shipped: the casual user clicks Save, the curating user clicks "Promote to Canonical
  Source" (a future button) which triggers the full agent pipeline.

## How this relates to Metadata Overkill

A `uuid` for everything:
A `uuid` is standard for identifying resources in large-scale systems, and can serve as the
  stable interop anchor that lets a citation move between systems without losing identity. UUID
  generation is mechanical, but the commitment to having one at capture time is architectural.
  Without it, the content can't ride from Obsidian → vector DB → Claude tool calls without
  entity-resolution heroics later.

  accessed_at_url is the deduplication key for content the same source serves at different display
  URLs (mirrors, AMP variants, paywall-bypassed copies). Pairs with internal_uuid as the two anchors
  that say "this content, regardless of where the file lives or what we titled it."

  structured_data_path is the contract that says "the JSON-y form of this source exists somewhere
  reachable." When the future Investment Memo Orchestrator wants to ask "what does this source say
  about Moat X," it ideally pulls from a structured shape, not by re-fetching HTML and re-extracting -- which may be unreliable, broken, or create slow friction in accessing data we already had the opportunity to extract and store.

  downloaded_content_path is the bit-preserving record — even if the publisher takes the page down,
  you still have the source you cited. Market Reports in particular have a way of showing up with hype
  and then disappearing within a few years. 


> We have converged on a style of reference definition that works for us now.  It has been stable for some time.  However, we know in future instances we may want to repurpose the same source metadata to render a different reference definition style (e.g. APA, MLA, Chicago, etc. just to name the academic ones.)

> We use Obsidian for content development and management, but we have switched before and we may switch again.  We need our cannonical source metadata/frontmatter needs be both robust and to be flexible enough to adapt to whatever tool we use.

# Mixed Influences and Audiences and Use Cases

We are influenced by three different communities of practice handling citations, and want to have the versatility to serve all of them with the same citation system.

We should show examples of each style below, and the requirements our system must meet:

## Academic Style

## Market Analyst Style

## Web Ready Style

## Obsidian Style


# Requirements

Sites must be able to render from
- the [Lossless Citation Spec](../reminders/Lossless-Citation-Spec.md)
- the [Lossless Citation Standards](./Lossless-Citation-Standards.md)

# Discussion:


  ┌─────────────────────────────────┬────────────────────────────────────────────────────────────┐
  │              Field              │                      Filling strategy                      │
  ├─────────────────────────────────┼────────────────────────────────────────────────────────────┤
  │ internal_uuid                   │ Deterministic — uuid library, no reasoning                 │
  ├─────────────────────────────────┼────────────────────────────────────────────────────────────┤
  │ reference_hexcode               │ Deterministic — already in use                             │
  ├─────────────────────────────────┼────────────────────────────────────────────────────────────┤
  │ default_slug                    │ Deterministic-ish — generate from title; AI to break ties  │
  │                                 │ or fix awkward slugs                                       │
  ├─────────────────────────────────┼────────────────────────────────────────────────────────────┤
  │ date_published, date_accessed,  │ Hybrid — extract from page metadata if present             │
  │ date_added                      │ (deterministic), otherwise AI parses page content          │
  ├─────────────────────────────────┼────────────────────────────────────────────────────────────┤
  │ accessed_at_url                 │ Deterministic — given                                      │
  ├─────────────────────────────────┼────────────────────────────────────────────────────────────┤
  │                                 │ Hybrid — meta tags first, then AI to (a) disambiguate      │
  │ title, subtitle, lede           │ which-is-which when meta is messy and (b) decide whether   │
  │                                 │ this source type uses lede or subtitle                     │
  ├─────────────────────────────────┼────────────────────────────────────────────────────────────┤
  │ publisher, publisher_url,       │ Hybrid — hostname → publisher name often works; AI to      │
  │ publisher_favicon_url           │ normalize ("nytimes.com" → "The New York Times"), find     │
  │                                 │ favicon URL, classify when host doesn't match brand        │
  ├─────────────────────────────────┼────────────────────────────────────────────────────────────┤
  │ piece_og_image,                 │ Deterministic — OG/Twitter card meta tags                  │
  │ piece_thumbnail_url             │                                                            │
  ├─────────────────────────────────┼────────────────────────────────────────────────────────────┤
  │ edition_or_version              │ AI-required — only present in some content; needs          │
  │                                 │ reasoning to extract from page text                        │
  ├─────────────────────────────────┼────────────────────────────────────────────────────────────┤
  │ api_provider_url,               │ AI-required — figuring out "this book has a Google Books   │
  │ api_provider_name,              │ API record" needs search                                   │
  │ api_source_url                  │                                                            │
  ├─────────────────────────────────┼────────────────────────────────────────────────────────────┤
  │ authors                         │ Hybrid — meta tags work for ~70%, AI for byline parsing on │
  │                                 │  the rest                                                  │
  ├─────────────────────────────────┼────────────────────────────────────────────────────────────┤
  │ publisher_type                  │ AI-required — pure classification task                     │
  ├─────────────────────────────────┼────────────────────────────────────────────────────────────┤
  │ tags                            │ AI-required — semantic categorization                      │
  ├─────────────────────────────────┼────────────────────────────────────────────────────────────┤
  │ cited_in_files                  │ Deterministic — already tried to support this, but may need
  |           |               to improve by using chron jobs, MCP or other tools to identify internal instances of the source being used           │
  ├─────────────────────────────────┼────────────────────────────────────────────────────────────┤
  │ downloaded_content_path,        │ Deterministic — file ops once content is downloaded; the   │
  │ structured_data_path            │ download decision is AI                                    │
  └─────────────────────────────────┴────────────────────────────────────────────────────────────┘
