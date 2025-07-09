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

    private extractCitations(content: string): CitationGroup[] {
        const citationPattern = /\[(\d+)\]/g;
        const matches: CitationMatch[] = [];
        const lines = content.split('\n');
        
        // Find all citation matches
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i] || '';
            let match;
            
            while ((match = citationPattern.exec(line)) !== null) {
                if (match[1]) {
                    const index = content.indexOf(match[0], content.indexOf(line) + match.index);
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

        // First, sort all matches by their position in the document
        const allMatches = Array.from(matches).sort((a, b) => a.index - b.index);
        const lastOccurrences = new Map<string, CitationMatch>();
        
        // Find the last occurrence of each citation number
        for (const match of allMatches) {
            lastOccurrences.set(match.number, match);
        }
        
        // Mark the last occurrence of each citation as the reference
        for (const [number, group] of groups.entries()) {
            const lastMatch = lastOccurrences.get(number);
            
            if (lastMatch) {
                // Find this match in our group's matches
                const groupMatch = group.matches.find(m => m.index === lastMatch.index);
                if (groupMatch) {
                    groupMatch.isReference = true;
                    groupMatch.isReferenceSource = true;
                    
                    // Extract reference text (everything after the citation)
                    const lineContent = groupMatch.lineContent;
                    const citationPos = lineContent.indexOf(`[${number}]`);
                    if (citationPos !== -1) {
                        group.referenceText = lineContent.substring(citationPos + number.length + 2).trim();
                    }
                }
            }
        }

        return Array.from(groups.values());
    }

    /**
     * Convert all citations in the content to use hex IDs
     */
    public convertAllCitations(content: string): ConversionResult {
        const citationGroups = this.extractCitations(content);
        if (citationGroups.length === 0) {
            return {
                content,
                changed: false,
                stats: { citationsConverted: 0 }
            };
        }

        let updatedContent = content;
        let citationsConverted = 0;

        // Process each citation group
        for (const group of citationGroups) {
            const hexId = this.generateHexId();
            
            // Process in reverse order to avoid position shifting
            const sortedMatches = [...group.matches].sort((a, b) => b.index - a.index);
            
            for (const match of sortedMatches) {
                const before = updatedContent.substring(0, match.index);
                const after = updatedContent.substring(match.index + match.original.length);
                
                if (match.isReference && group.referenceText) {
                    // This is the reference, add colon and reference text
                    updatedContent = `${before}[^${hexId}]: ${group.referenceText}${after}`;
                } else {
                    // Regular citation
                    updatedContent = `${before}[^${hexId}]${after}`;
                }
                
                citationsConverted++;
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
            
            if (match.isReference && group.referenceText) {
                // This is the reference, add colon and reference text
                updatedContent = `${before}[^${hexId}]: ${group.referenceText}${after}`;
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
     * Handles multiple citations before punctuation in a single pass.
     */
    /**
     * Moves citations that appear before punctuation (like commas or periods) to after the punctuation.
     */
    public moveCitationsBehindPunctuation(content: string): string {
        const lines = content.split('\n');
        
        return lines.map(line => {
            // Handle citations before punctuation
            return line.replace(/(\[[^\]]+\])([.,;:!?])/g, '$2$1');
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
