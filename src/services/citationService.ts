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
        // Updated to match references with or without colons, and capture the entire reference text
        const referencePattern = /^\s*\[(\d+)\]:?\s*([\s\S]*?)(?=\n\s*\[\d+\]:|\n\s*$|$)/gm;
        
        const matches: CitationMatch[] = [];
        const referenceMap = new Map<string, string>();
        
        // First, extract all reference texts
        let refMatch;
        while ((refMatch = referencePattern.exec(content)) !== null) {
            const [_, number, refText] = refMatch;
            if (number) {
                // Preserve the reference text exactly as is, including any colons and whitespace
                const fullMatch = refMatch[0].trim();
                const refValue = fullMatch.includes(':') 
                    ? fullMatch.split(':', 2)[1].trim() 
                    : fullMatch.replace(/^\s*\[\d+\]\s*/, '').trim();
                referenceMap.set(number, refValue);
            }
        }

        // Then find all citation matches
        const lines = content.split('\n');
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
                const referenceText = referenceMap.get(match.number) || '';
                groups.set(match.number, {
                    number: match.number,
                    matches: [],
                    referenceText: referenceText
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
        // First, remove all existing references and citations
        const cleanedContent = content
            // Remove all reference definitions
            .replace(/\n\[\d+\]:.*$/gm, '')
            // Remove all citations
            .replace(/\[\d+\]/g, '')
            // Clean up any double newlines that might result
            .replace(/\n{3,}/g, '\n\n');
            
        const citationGroups = this.extractCitations(cleanedContent);
        
        if (citationGroups.length === 0) {
            return {
                content,
                changed: false,
                stats: { citationsConverted: 0 }
            };
        }

        let updatedContent = cleanedContent;
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

        // Second pass: add references at the end
        const references: string[] = [];
        for (const group of citationGroups) {
            const hexId = hexIdMap.get(group.number);
            if (hexId && group.referenceText) {
                // Format the reference with proper spacing after the colon
                references.push(`[^${hexId}]: ${group.referenceText.trim()}`);
            }
        }

        // Add all references at the end of the document
        if (references.length > 0) {
            updatedContent = `${updatedContent}\n\n## References\n\n${references.join('\n\n')}`;
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
