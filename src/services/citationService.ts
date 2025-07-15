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
            const num = Math.floor(Math.random() * 0x1000000);
            hexId = num.toString(16).padStart(6, '0');
            // Ensure we have at least one letter and one number
            if (!/[a-f]/.test(hexId) || !/\d/.test(hexId)) {
                continue;
            }
        } while (this.usedHexIds.has(hexId));
        
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
        const citationPattern = /\[(\d+)\](?!:)/g; // Only match citations, not references
        const matches: CitationMatch[] = [];
        const lines = content.split('\n');
        
        // We don't need to extract reference text - we'll transform in place

        // Then find all citation matches
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (!line) continue;
            
            // Skip lines that are reference definitions
            if (/^\s*\[\d+\]:/.test(line)) continue;
            
            let match;
            while ((match = citationPattern.exec(line)) !== null) {
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

        // Mark the last occurrence of each citation as the reference
        const allMatches = Array.from(matches).sort((a, b) => a.index - b.index);
        const lastOccurrences = new Map<string, CitationMatch>();
        
        for (const match of allMatches) {
            lastOccurrences.set(match.number, match);
        }
        
        for (const [number, group] of groups.entries()) {
            const lastMatch = lastOccurrences.get(number);
            if (lastMatch) {
                const groupMatch = group.matches.find(m => m.index === lastMatch.index);
                if (groupMatch) {
                    groupMatch.isReference = true;
                    groupMatch.isReferenceSource = true;
                }
            }
        }

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

        // First pass: replace all citations with hex IDs
        for (const group of citationGroups) {
            const hexId = this.generateHexId();
            hexIdMap.set(group.number, hexId);
            
            for (const match of group.matches) {
                const before = updatedContent.substring(0, match.index);
                const after = updatedContent.substring(match.index + match.original.length);
                // Check if the original match ends with a colon and preserve it
                const needsColon = match.original.endsWith(':');
                updatedContent = `${before}[^${hexId}]${needsColon ? ':' : ''}${after}`;
                citationsConverted++;
            }
        }

        // Transform reference lines in place - replace [1] with [^hexid] in reference lines
        for (const group of citationGroups) {
            const hexId = hexIdMap.get(group.number);
            if (hexId) {
                // Replace reference lines like [1] text or [1]: text with [^hexid]: text
                const refPattern = new RegExp(`^\\s*\\[${group.number}\\]\\s*:?\\s*`, 'gm');
                updatedContent = updatedContent.replace(refPattern, `[^${hexId}]: `);
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
                // This is a reference line - replace [1] with [^hexid]: 
                // The reference text is already in the content after the bracket
                const refPattern = new RegExp(`\\[${group.number}\\]\\s*:?\\s*`);
                const replacement = `[^${hexId}]: `;
                updatedContent = updatedContent.substring(0, match.index) + 
                    updatedContent.substring(match.index).replace(refPattern, replacement);
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
