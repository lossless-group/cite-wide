export interface ConversionResult {
    content: string;
    changed: boolean;
    stats: {
        citationsConverted: number;
    };
}

export interface CitationMatch {
    number: string;
    original: string;
    index: number;
    lineNumber: number;
    lineContent: string;
    isReference: boolean;
    isReferenceSource?: boolean;
}

export interface CitationGroup {
    number: string;
    matches: CitationMatch[];
    referenceText?: string;
    url?: string;
};

export class CitationService {
    private usedHexIds: Set<string> = new Set();

    /**
     * @deprecated Use generateHexId instead
     */
    public getNewHexId(): string {
        return this.generateHexId();
    }

    private generateHexId(): string {
        let hexId: string;
        do {
            // Use base 36 (0-9, a-z) for more character variety
            const num = Math.floor(Math.random() * Math.pow(36, 6));
            hexId = num.toString(36).padStart(6, '0');
            // Ensure we have at least one letter and one number
            // Base 36 gives us a-z letters, much more variety than hex a-f
        } while (this.usedHexIds.has(hexId) || !/[a-z]/.test(hexId) || !/\d/.test(hexId));
        
        this.usedHexIds.add(hexId);
        return hexId;
    }

    /**
     * Extract all citations from the content
     */
    /**
     * Find all citations in the content
     * @deprecated Use extractCitations instead
     */
    public findCitations(content: string): CitationGroup[] {
        return this.extractCitations(content);
    }

    public extractCitations(content: string): CitationGroup[] {
        console.log('Debug: Starting extractCitations');
        // Match both numeric citations [1] and hex citations [^1]
        const numericCitationPattern = /\[(\d+)\](?!:)/g;
        const hexCitationPattern = /\[\^([a-f0-9]+)\](?!:)/g;
        const matches: CitationMatch[] = [];
        const lines = content.split('\n');
        
        console.log('Debug: Processing', lines.length, 'lines');
        
        // Find all citation matches (both numeric and hex)
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (!line) continue;
            
            console.log('Debug: Processing line', i + 1, ':', line.trim());
            
            // Skip lines that are reference definitions
            if (/^\s*\[\d+\]:/.test(line) || /^\s*\[\^[a-f0-9]+\]:/.test(line)) {
                console.log('Debug: Skipping reference definition line:', line.trim());
                continue;
            }
            
            // Find numeric citations
            let match;
            while ((match = numericCitationPattern.exec(line)) !== null) {
                if (match[1]) {
                    if (match[0] && match[1]) {
                        const lineIndex = content.indexOf(line);
                        const matchIndex = lineIndex >= 0 ? lineIndex + (match.index || 0) : 0;
                        const index = content.indexOf(match[0], matchIndex);
                        
                        if (index >= 0) {
                            matches.push({
                                number: match[1],
                                original: match[0],
                                index,
                                lineContent: line,
                                lineNumber: i + 1,
                                isReference: false
                            });
                        }
                    }
                }
            }
            
            // Find hex citations
            while ((match = hexCitationPattern.exec(line)) !== null) {
                if (match[1]) {
                    if (match[0] && match[1]) {
                        const lineIndex = content.indexOf(line);
                        const matchIndex = lineIndex >= 0 ? lineIndex + (match.index || 0) : 0;
                        const index = content.indexOf(match[0], matchIndex);
                        
                        if (index >= 0) {
                            console.log('Debug: Found hex citation:', match[0], 'with number:', match[1]);
                            matches.push({
                                number: `hex_${match[1]}`, // Prefix to distinguish from numeric
                                original: match[0],
                                index,
                                lineContent: line,
                                lineNumber: i + 1,
                                isReference: false
                            });
                        }
                    }
                }
            }
        }

        // Group matches by number
        const groups = new Map<string, CitationGroup>();
        
        for (const match of matches) {
            if (!groups.has(match.number)) {
                groups.set(match.number, {
                    number: match.number,
                    matches: []
                });
            }
            groups.get(match.number)?.matches.push(match);
        }

        // Find actual reference definitions (lines that start with [number]: or [^hex]:)
        const referenceDefinitions = new Map<string, CitationMatch>();
        
        console.log('Debug: Looking for reference definitions');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            
            console.log('Debug: Checking line', i + 1, 'for reference definition:', line.trim());
            
            // Check for numeric reference definitions [1]: text
            let refMatch = line.match(/^\s*\[(\d+)\]\s*:?\s*(.*)/);
            if (refMatch && refMatch[1]) {
                console.log('Debug: Found numeric reference definition:', refMatch[0]);
                const number = refMatch[1];
                
                // Find the corresponding citation group
                const group = groups.get(number);
                if (group && refMatch[0]) {
                    // Create a reference match
                    const refCitationMatch: CitationMatch = {
                        number,
                        original: refMatch[0],
                        index: content.indexOf(line) + line.indexOf(refMatch[0]),
                        lineContent: line,
                        lineNumber: i + 1,
                        isReference: true,
                        isReferenceSource: true
                    };
                    
                    referenceDefinitions.set(number, refCitationMatch);
                    group.matches.push(refCitationMatch);
                }
            }
            
            // Check for hex reference definitions [^hex]: text
            refMatch = line.match(/^\s*\[\^([a-f0-9]+)\]\s*:?\s*(.*)/);
            if (refMatch && refMatch[1]) {
                console.log('Debug: Found hex reference definition:', refMatch[0], 'with hex ID:', refMatch[1]);
                const hexId = refMatch[1];
                const number = `hex_${hexId}`; // Use the same prefix as in citation detection
                
                // Find the corresponding citation group
                const group = groups.get(number);
                if (group && refMatch[0]) {
                    console.log('Debug: Found corresponding citation group for hex reference:', number);
                    // Create a reference match
                    const refCitationMatch: CitationMatch = {
                        number,
                        original: refMatch[0],
                        index: content.indexOf(line) + line.indexOf(refMatch[0]),
                        lineContent: line,
                        lineNumber: i + 1,
                        isReference: true,
                        isReferenceSource: true
                    };
                    
                    referenceDefinitions.set(number, refCitationMatch);
                    group.matches.push(refCitationMatch);
                } else {
                    console.log('Debug: No corresponding citation group found for hex reference:', number);
                }
            } else {
                // Debug: Check if the line looks like a hex reference but didn't match
                if (line.trim().match(/^\[\^[a-f0-9]+\]/)) {
                    console.log('Debug: Line looks like hex reference but didn\'t match:', line);
                }
            }
        }

        console.log('Debug: Final citation groups:', Array.from(groups.values()).map(g => ({
            number: g.number,
            matchCount: g.matches.length,
            references: g.matches.filter(m => m.isReference).length
        })));
        
        return Array.from(groups.values());
    }

    /**
     * Convert all citations in the content to use hex IDs
     */
    public convertAllCitations(content: string): ConversionResult {
        // First, extract citations from the original content to get reference text
        const citationGroups = this.extractCitations(content);
        
        // Start with the original content - we'll transform it in place
        let updatedContent = content;
        
        if (citationGroups.length === 0) {
            return {
                content,
                changed: false,
                stats: { citationsConverted: 0 }
            };
        }

        let citationsConverted = 0;
        const hexIdMap = new Map<string, string>();

        // First pass: replace all citations with hex IDs (but not reference definitions)
        for (const group of citationGroups) {
            const hexId = this.generateHexId();
            hexIdMap.set(group.number, hexId);
            
            for (const match of group.matches) {
                // Skip reference definitions - we'll handle them separately
                if (match.isReference) {
                    continue;
                }
                
                const before = updatedContent.substring(0, match.index);
                const after = updatedContent.substring(match.index + match.original.length);
                updatedContent = `${before}[^${hexId}]${after}`;
                citationsConverted++;
            }
        }

        // Second pass: transform reference definitions - replace [1]: or [^oldhex]: with [^newhexid]: 
        for (const group of citationGroups) {
            const hexId = hexIdMap.get(group.number);
            if (hexId) {
                if (group.number.startsWith('hex_')) {
                    // This is a hex citation - replace [^oldhex]: with [^newhexid]: 
                    const oldHexId = group.number.replace('hex_', '');
                    // Use a more careful approach to preserve spacing
                    const lines = updatedContent.split('\n');
                    const updatedLines = lines.map(line => {
                        const refMatch = line.match(/^(\s*)\[\^([a-f0-9]+)\]\s*:?\s*(.*)/);
                        if (refMatch && refMatch[2] === oldHexId) {
                            const [, leadingSpaces, , restOfLine] = refMatch;
                            return `${leadingSpaces}[^${hexId}]: ${restOfLine}`;
                        }
                        return line;
                    });
                    updatedContent = updatedLines.join('\n');
                } else {
                    // This is a numeric citation - replace [1]: with [^hexid]: 
                    // Use a more careful approach to preserve spacing
                    const lines = updatedContent.split('\n');
                    const updatedLines = lines.map(line => {
                        const refMatch = line.match(/^(\s*)\[(\d+)\]\s*:?\s*(.*)/);
                        if (refMatch && refMatch[2] === group.number) {
                            const [, leadingSpaces, , restOfLine] = refMatch;
                            return `${leadingSpaces}[^${hexId}]: ${restOfLine}`;
                        }
                        return line;
                    });
                    updatedContent = updatedLines.join('\n');
                }
            }
        }

        return {
            content: updatedContent,
            changed: citationsConverted > 0,
            stats: { citationsConverted }
        };
    }
    
    /**
     * Convert a single citation by its number
     */
    public convertCitation(
        content: string, 
        citationNumber: string
    ): ConversionResult {
        const citationGroups = this.extractCitations(content);
        const group = citationGroups.find(g => g.number === citationNumber);
        
        if (!group) {
            return {
                content,
                changed: false,
                stats: { citationsConverted: 0 }
            };
        }
        
        // Process just this citation group
        const hexId = this.generateHexId();
        let updatedContent = content;
        let citationsConverted = 0;
        
        // Process in reverse order to avoid position shifting
        const sortedMatches = [...group.matches].sort((a, b) => b.index - a.index);
        
        for (const match of sortedMatches) {
            const before = updatedContent.substring(0, match.index);
            const after = updatedContent.substring(match.index + match.original.length);
            
            if (match.isReference) {
                // This is a reference line - use the same careful approach as convertAllCitations
                if (group.number.startsWith('hex_')) {
                    // This is a hex citation - replace [^oldhex]: with [^newhexid]: 
                    const oldHexId = group.number.replace('hex_', '');
                    const lines = updatedContent.split('\n');
                    const updatedLines = lines.map(line => {
                        const refMatch = line.match(/^(\s*)\[\^([a-f0-9]+)\]\s*:?\s*(.*)/);
                        if (refMatch && refMatch[2] === oldHexId) {
                            const [, leadingSpaces, , restOfLine] = refMatch;
                            return `${leadingSpaces}[^${hexId}]: ${restOfLine}`;
                        }
                        return line;
                    });
                    updatedContent = updatedLines.join('\n');
                } else {
                    // This is a numeric citation - replace [1]: with [^hexid]: 
                    const lines = updatedContent.split('\n');
                    const updatedLines = lines.map(line => {
                        const refMatch = line.match(/^(\s*)\[(\d+)\]\s*:?\s*(.*)/);
                        if (refMatch && refMatch[2] === group.number) {
                            const [, leadingSpaces, , restOfLine] = refMatch;
                            return `${leadingSpaces}[^${hexId}]: ${restOfLine}`;
                        }
                        return line;
                    });
                    updatedContent = updatedLines.join('\n');
                }
            } else {
                // Regular citation
                updatedContent = `${before}[^${hexId}]${after}`;
            }
            
            citationsConverted++;
        }

        return {
            content: updatedContent,
            changed: citationsConverted > 0,
            stats: { citationsConverted }
        };
    }

    /**
     * Moves citations that appear before punctuation (like commas or periods) to after the punctuation.
     * Ensures proper spacing between punctuation and citations, and between multiple citations.
     * Avoids modifying the references/sources/footnotes section.
     */
    public moveCitationsBehindPunctuation(content: string): string {
        const lines = content.split('\n');
        let inReferencesSection = false;
        
        return lines.map(line => {
            // Check if we're entering a references section
            if (/^#+\s*(References|Sources|Footnotes)\s*$/i.test(line.trim())) {
                inReferencesSection = true;
                return line;
            }
            
            // Check if we're in a references section and this line starts with a citation followed by colon
            if (inReferencesSection && /^\s*\[[^\]]+\]\s*:/.test(line)) {
                return line; // Don't modify reference definitions
            }
            
            // Reset references section flag if we hit a new section or non-reference content
            if (inReferencesSection && line.trim() && !/^\s*\[[^\]]+\]\s*:/.test(line) && !/^\*+\s*$/.test(line.trim())) {
                // Check if this is another header
                if (/^#+/.test(line.trim())) {
                    inReferencesSection = false;
                }
            }
            
            // Skip processing if we're in references section
            if (inReferencesSection) {
                return line;
            }
            
            // Process the line to move citations after punctuation
            let processedLine = line;
            
            // Handle multiple citations before punctuation (e.g., [^123][^456], -> , [^123] [^456])
            // This regex captures one or more citations followed by comma or period
            processedLine = processedLine.replace(/((?:\[[^\]]+\])+)([.,])/g, (_, citations, punctuation) => {
                // Split multiple citations and ensure proper spacing
                const citationMatches = citations.match(/\[[^\]]+\]/g) || [];
                const spacedCitations = citationMatches.join(' ');
                return `${punctuation} ${spacedCitations}`;
            });
            
            return processedLine;
        }).join('\n');
    }

    /**
     * Ensures proper spacing between citations
     */
    public assureSpacingBetweenCitations(content: string): string {
        // Ensure space between multiple citations
        return content.replace(/\](\s*)\[/g, '] $1[');
    }

    /**
     * @deprecated Use moveCitationsBehindPunctuation instead
     */
    public fixCitationPunctuation(content: string): string {
        return this.moveCitationsBehindPunctuation(content);
    }
}

// Singleton instance
export const citationService = new CitationService();
