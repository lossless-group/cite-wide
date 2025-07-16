
![Cite Wide Obsidian Plugin Banner Image](https://i.imgur.com/FjH00G6.png)
***
# Cite Wide Obsidian Plugin

An Obsidian plugin for rigorous, vault-wide citation management. Converts numeric footnotes into unique hex-codes, logs unique hex codes and their reference information into a base, assures consistent hex codes per reference.

## Features

### 🔢 **Unique Hex Code Generation**
- Converts numeric citations `[1]` into unique hex codes `[^a1b2c3]`
- Consistent algorithm ensures the same reference always generates the same hex code
- Maintains vault-wide consistency across all documents

### 🌐 **Automatic URL Citation Extraction**
- Extract properly formatted citations from URLs using Jina.ai Reader API
- Highlights a URL and automatically generates citation in the format:
  ```
  [^1b34df]: 2016, May. "[Originals, by Adam Grant | Bob's Books](https://bobsbeenreading.com/2016/05/08/originals-by-adam-grant/)" schoultz. [Bob's Books](https://bobsbeenreading.com/).
  ```
- Updates existing footnotes or creates new ones
- Works without API key, but adding one can avoid rate limits

### 📚 **Citation Management**
- Supports multiple citation formats: numeric `[1]`, footnotes `[^1]`, Perplexity-style `1. [https://...]`
- Automatic detection and grouping of citation instances
- Intelligent reference source tracking

### 🎨 **Smart Formatting**
- Moves citations after punctuation (e.g., `text[1].` → `text.[1]`)
- Ensures proper spacing between multiple citations
- Maintains clean, readable document structure

### 📊 **Dataview Integration**
- Automatically creates citation files in a dedicated folder for Dataview queries
- Rich metadata including title, author, URL, usage count, and file tracking
- Comprehensive frontmatter for powerful Dataview queries and organization

### Command: Convert to Hex Modal

![Command: Convert to Hex](https://i.imgur.com/dBMKnV7.gif)

### Command: Clean Reference Section

![Command: Clean Reference Section](https://i.imgur.com/usdcU1p.gif)

### Command: Move Citations after Punctuation

![Command: Move Citations after Punctuation](https://i.imgur.com/xbzDnPT.gif)

### Command: Extract Citation from URL

![Command: Extract Citation from URL](https://i.imgur.com/J6JZLNK.png)

# Getting Started

```
pnpm install
pnpm add -D esbuild @types/node builtin-modules
pnpm build
pnpm dev
```

## Make it show up in Obsidian

Create a symbolic link into the plugins directory:

Here is my example, but you will need to use your own path structure:
```bash
ln -s /Users/mpstaton/code/lossless-monorepo/cite-wide /Users/mpstaton/content-md/lossless/.obsidian/plugins/cite-wide
```

## Configuration

### Citations Folder Setup

The plugin automatically creates citation files for Dataview integration:

1. Open Obsidian Settings → Community Plugins → Cite Wide
2. Set your preferred citations folder (default: "Citations")
3. Citation files will be created automatically when you use citation commands

### Jina.ai API Key Setup (Optional)

The URL citation extraction feature works without an API key, but adding one can help avoid rate limits:

1. Get a Jina.ai API key from [https://jina.ai/](https://jina.ai/)
2. Open Obsidian Settings → Community Plugins → Cite Wide
3. Enter your API key in the settings (optional)
4. Save the settings

**Note**: The feature works perfectly without an API key, but you may encounter rate limits with heavy usage.

### Using URL Citation Extraction

1. Highlight a URL in your document
2. Run the "Extract Citation from URL" command (Ctrl/Cmd + P)
3. The URL will be replaced with a citation reference like `[^a1b2c3]`
4. A properly formatted citation will be added to the Footnotes section

**Example:**
- **URL:** `https://bobsbeenreading.com/2016/05/08/originals-by-adam-grant/`
- **Becomes:** `[^1b34df]: 2016, May. "[Originals, by Adam Grant | Bob's Books](https://bobsbeenreading.com/2016/05/08/originals-by-adam-grant/)" schoultz. [Bob's Books](https://bobsbeenreading.com/).`

**For existing footnotes:**
- **Before:** `[^028ee3]: @https://bobsbeenreading.com/2016/05/08/originals-by-adam-grant/`
- **After:** `[^028ee3]: 2016, May. "[Originals, by Adam Grant | Bob's Books](https://bobsbeenreading.com/2016/05/08/originals-by-adam-grant/)" schoultz. [Bob's Books](https://bobsbeenreading.com/).`

## Dataview Integration

The plugin automatically creates citation files with rich metadata for powerful Dataview queries. Each citation file includes:

### Citation File Structure
```yaml
---
hexId: "a1b2c3"
title: "Article Title"
author: "Author Name"
url: "https://example.com/article"
date: "2024"
source: "example.com"
tags: []
created: "2024-01-15T10:30:00.000Z"
lastModified: "2024-01-15T10:30:00.000Z"
referenceText: "Full reference text"
usageCount: 1
filesUsedIn: ["path/to/file.md"]
---
```

### Example Dataview Queries

**Basic citation table:**
```dataview
TABLE title, author, date, usageCount
FROM "Citations"
SORT created DESC
```

**Most used citations:**
```dataview
TABLE title, author, source, filesUsedIn
FROM "Citations"
WHERE usageCount > 1
SORT usageCount DESC
```

**Citations by author:**
```dataview
TABLE title, date, usageCount, url
FROM "Citations"
WHERE author
SORT author ASC, date DESC
```

See `examples/dataview-citations-examples.md` for comprehensive Dataview query examples.




