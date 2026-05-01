
# Always use the Lossless Citation Spec for Cite Wide.

## Disambiguation:

- The `{}` brackets denote a variable declaration, and will not be part of the string output.
- When using `[^N]` where N is a number, this is a numeric citation.
- When using `[^{hexCode}]` where hexCode is a hex code, this is a hex code citation -- our goal and preference but not strictly enforced on our content team. (They develop a lot of content, many files will be in progress and not yet on the priority list to refine to Lossless standards.)
- Where `citation_id` could be either a hexCode or a numeric identifier. Our preference is for hex codes, but we may run some scripts to transform the content prior to full conversion to hexCodes, so numerica identifiers should not prevent the use of any script or command.

## Preference for Hex Codes, always use Hex Codes for Cannonical Sources saved into the Cannonical System
We will use good sources in many documents, and we will copy paste them from one to another.  So we cannot have numeric collisions due to carelessness. Content creators should not be spending their time scouting for collisions. So, we have Cite Wide as a plugin that can use scripts to automatically generate hex codes for citations and substitute numerics.

Hex Codes are then rendered as numeric citations in the order they appear.

Reference sections at the bottom of the file will also reorder to match the appearances of the numeric citations, and do so in a pair-bonded fashion where all inline citations are tracked in memory/state and their corresponding reference sections are reordered accordingly.


## Inline Citations

Inline citations should use the reference_hexcode as the identifier, and use ` [^{hexCode}]`. 
- A single space must stand between the content and the citation: ` [`.
- No space can come after the final inline citation. ` [^abc123]`
- The citation must always be outside/after the closing punctuation of the sentence or clause. `. [^{hexCode}]`, `, [^{hexCode}]` or `: [^{hexCode}]` or `; [^{hexCode}]`
- If multiple citations are used in sequence, they must be separated by a single space: ` [^{hexCode1}] [^{hexCode2}]`

`[^abc123]`

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




