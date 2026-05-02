# Dataview Citations Examples

This file demonstrates how to use Dataview to display and query your citations created by the Cite Wide plugin.

## Basic Citation Table

Display all citations in a simple table:

```dataview
TABLE 
    title,
    author,
    date,
    usageCount,
    created
FROM "Citations"
SORT created DESC
```

## Detailed Citation Table

Show more comprehensive information about your citations:

```dataview
TABLE 
    title AS "Title",
    author AS "Author",
    date AS "Date",
    source AS "Source",
    usageCount AS "Usage Count",
    lastModified AS "Last Modified"
FROM "Citations"
SORT usageCount DESC
```

## Citations by Author

Group citations by author:

```dataview
TABLE 
    title,
    date,
    usageCount,
    url
FROM "Citations"
WHERE author
SORT author ASC, date DESC
```

## Most Used Citations

Find your most frequently cited sources:

```dataview
TABLE 
    title,
    author,
    source,
    filesUsedIn
FROM "Citations"
WHERE usageCount > 1
SORT usageCount DESC
```

## Recent Citations

Show recently created citations:

```dataview
TABLE 
    title,
    author,
    usageCount
FROM "Citations"
WHERE date(created) >= date(today) - dur(30 days)
SORT created DESC
```

## Citations with URLs

Show only citations that have associated URLs:

```dataview
TABLE 
    title,
    author,
    url,
    usageCount
FROM "Citations"
WHERE url
SORT usageCount DESC
```

## Citations by Source Domain

Group citations by their source domain:

```dataview
TABLE 
    title,
    author,
    usageCount
FROM "Citations"
WHERE source
SORT source ASC, usageCount DESC
```

## Citations Used in Specific Files

Find citations used in particular files (replace "YourFile" with actual file name):

```dataview
TABLE 
    title,
    author,
    usageCount
FROM "Citations"
WHERE contains(filesUsedIn, "YourFile")
SORT usageCount DESC
```

## Citations with Tags

Show citations that have tags:

```dataview
TABLE 
    title,
    author,
    tags,
    usageCount
FROM "Citations"
WHERE tags
SORT usageCount DESC
```

## Citation Statistics

Get an overview of your citation usage:

```dataview
LIST 
    "Total Citations: " + length(rows.file.link)
    + " | Total Usage: " + sum(rows.usageCount)
    + " | Average Usage: " + round(sum(rows.usageCount) / length(rows.file.link), 2)
FROM "Citations"
```

## Citations by Year

Group citations by year:

```dataview
TABLE 
    title,
    author,
    usageCount
FROM "Citations"
WHERE date
SORT date DESC
```

## Unused Citations

Find citations that haven't been used yet:

```dataview
TABLE 
    title,
    author,
    created
FROM "Citations"
WHERE usageCount = 1
SORT created DESC
```

## Citations with Notes

Show citations that have additional notes (files with more content):

```dataview
TABLE 
    title,
    author,
    file.size
FROM "Citations"
WHERE file.size > 500
SORT file.size DESC
```

## Advanced: Citations with Custom Properties

If you add custom properties to your citation files, you can query them too:

```dataview
TABLE 
    title,
    author,
    customProperty,
    usageCount
FROM "Citations"
WHERE customProperty
SORT usageCount DESC
```

## Advanced: Citations by Reference Text Length

Find citations with longer reference texts:

```dataview
TABLE 
    title,
    author,
    length(referenceText) AS "Ref Length"
FROM "Citations"
WHERE referenceText
SORT length(referenceText) DESC
```

## Tips for Using These Queries

1. **Customize the folder path**: If you've changed the citations folder in settings, update the `FROM "Citations"` part to match your folder name.

2. **Add filters**: Use `WHERE` clauses to filter results based on your needs.

3. **Sort results**: Use `SORT` to organize results by different criteria.

4. **Combine queries**: You can combine multiple conditions using `AND` and `OR`.

5. **Use in other notes**: You can embed these queries in any note to show relevant citations.

## Example: Research Project Citations

For a specific research project, you might use:

```dataview
TABLE 
    title,
    author,
    date,
    usageCount
FROM "Citations"
WHERE contains(filesUsedIn, "Research Project") OR contains(tags, "research")
SORT date DESC
```

## Example: Recent Literature Review

For tracking recent academic sources:

```dataview
TABLE 
    title,
    author,
    source,
    usageCount
FROM "Citations"
WHERE date >= date(today) - dur(90 days) AND contains(source, "academic")
SORT usageCount DESC
```

## Citation File Structure

Each citation file contains the following frontmatter:

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

This structure allows for powerful querying and organization of your citations using Dataview's query language. 