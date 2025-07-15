# Citation Reference Duplication Analysis

## The Problem
Reference content is being duplicated:
```
[^dc65c1]: Top 250 Data Center Companies in the World as of 2024 - Dgtl Infra https://dgtlinfra.com/top-data-center-companies/ Top 250 Data Center Companies in the World as of 2024 - Dgtl Infra https://dgtlinfra.com/top-data-center-companies/
```

## Step-by-Step Code Analysis

### Step 1: Reference Text Extraction (Lines 68-79)
```typescript
const lines = content.split('\n');
for (const line of lines) {
    const refMatch = line.match(referencePattern); // /^\s*\[(\d+)\]:?\s*(.*)$/
    if (refMatch) {
        const [, number, refText] = refMatch;
        if (number && refText && refText.trim()) {
            referenceMap.set(number, refText.trim());
        }
    }
}
```

**Analysis:**
- Input line: `[1] Top 250 Data Center Companies...`
- `refMatch[1]` = "1" 
- `refMatch[2]` = "Top 250 Data Center Companies..." (FULL TEXT)
- `referenceMap.set("1", "Top 250 Data Center Companies...")`

### Step 2: Group Assignment (Lines 116-124)
```typescript
for (const match of matches) {
    if (!groups.has(match.number)) {
        const referenceText = referenceMap.get(match.number) || '';
        groups.set(match.number, {
            number: match.number,
            matches: [],
            referenceText: referenceText // STORES FULL TEXT
        });
    }
}
```

**Analysis:**
- `group.referenceText` = "Top 250 Data Center Companies..." (FULL TEXT)

### Step 3: Reference Line Transformation (Lines 186-194)
```typescript
for (const group of citationGroups) {
    const hexId = hexIdMap.get(group.number);
    if (hexId && group.referenceText) {
        const refPattern = new RegExp(`^\\s*\\[${group.number}\\]\\s*:?\\s*`, 'gm');
        updatedContent = updatedContent.replace(refPattern, `[^${hexId}]: `);
    }
}
```

**Analysis:**
- Original: `[1] Top 250 Data Center Companies...`
- Pattern: `/^\s*\[1\]\s*:?\s*/gm` (matches "[1] ")
- Replacement: `[^hexid]: `
- Result: `[^hexid]: Top 250 Data Center Companies...`

## HYPOTHESIS: The Duplication Source

The issue might be:

1. **Multiple processing passes** - The same content is being processed multiple times
2. **Regex pattern issue** - The pattern is not matching correctly and leaving original content
3. **Content concatenation** - Somewhere the reference text is being appended to itself
4. **Multiple citation groups** - The same citation number appears in multiple groups

## LIKELY CAUSE

Looking at the regex pattern `/^\s*\[(\d+)\]:?\s*(.*)$/`, the `(.*)` captures EVERYTHING after the citation number. If the original content already contains the full reference text, and we're just replacing the citation bracket part, we should get the correct result.

The duplication suggests that either:
1. The original content already has duplicated text
2. The replacement is happening multiple times
3. There's concatenation happening somewhere else in the code

## NEXT STEPS

Need to examine:
1. What the original input content looks like
2. Whether the replacement is happening multiple times
3. If there are other places where reference content is being assembled
