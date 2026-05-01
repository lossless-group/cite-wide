# Lossless Citation Standards: Academic, Market Analyst, and Web Ready. 

We are influenced by three different communities of practice handling citations, and want to have the versatility to serve all of them with the same citation system.

We should show examples of each style below, and the requirements our system must meet:

## Academic Style

## Market Analyst Style

## Web Ready Style

## Obsidian Style

# Publisher and Publication Types

- Academic Journal
- Content Marketing Report
- Research Firm Report
- Data as a Service Provider (e.g. SimilarWeb, Preqin, Traxn, Crunchbase, etc.)
- Think Tank Report
- Individual Researcher Blog
- Social Media Post (Linkedin, Twitter, etc.)
- UGC Community Post / Discussion (Quora, Reddit, etc.)
- Content Marketing Post (Hubspot, etc.)


# Requirements

```yaml
internal_uuid: "uuid-123"
reference_hexcode: "abc123" # Unique identifier for the citation, used in URLs and file names
default_slug: "example-slug"
date_published: 2024-10-15 # Can be parsed into year, month, day. Missing days are common and should be elegantly handled. Missing months are possible but rare, should also be elegantly handled.
publisher: "Example Publisher" # Used for books, magazines, journals, etc.
publisher_url: "https://example.com"
accessed_at_url: "https://example.com/article"
title: "Example Title"
subtitle: "Example Subtitle" # Often used in academic and market analyst styles, as well as books.
lede: "Example Lede" # Magazine-style lede is similar to subtitle, often used in web publishing
edition_or_version: "1.0" # || Second Edition, Version 2.0, etc. Used for books, journals, reports, etc.
publisher_favicon_url: "https://example.com/favicon.ico"
piece_og_image: "https://example.com/article/og-image.jpg"
piece_thumbnail_url: "https://example.com/article/thumbnail.jpg"
api_provider_url: "https://api.example.com"
api_provider_name: "Example API Provider"
api_source_url: "https://api.example.com/article"
authors:
  - "Author One"
  - "Author Two"
publisher_type: # This is not an Enum. Obsidan handles auto-completion so we don't need to enforce it here. This is for reference.
  - "Academic"
  - "Market-Research-Organization"
  - "Think-Tank"
  - "Government-Agency"
  - "Consulting-Firm"
  - "Industry-Media"
  - "Individual-Researcher"
  - "Content-Creator"
  - "Social-Media-User"
  - "Data-as-a-Service-Provider"
  - "Other"
date_accessed: 2024-10-15
date_added: 2024-10-15
cited_in_files:
  - "file1.md"
  - "file2.md"
tags: # Tags flexibly can serve as categories, topics, or any other classification system and we worry about that at the consumer / client level
  - "Tag-One"
  - "Tag-Two"
downloaded_content_path: "/path/to/downloaded/content" # Ideally same naming conventions as this file, the source, and the structured data file. We have before used Jina.ai to pull raw html, and we always download PDFs if we can. Ebooks possible but havent done it.
structured_data_path: "/path/to/structured/data" # We have before used OpenAI to extract structured data from downloaded content.
---




