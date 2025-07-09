// cite-wide/src/services/citationService.ts
import crypto from 'crypto';

export type CitationType = 'perplexity' | 'reference' | 'footnote' | 'numeric';

export interface CitationMatch {
    type: CitationType;
    number: string;
    original: string;
    url?: string | undefined;  // Explicitly optional URL property
    index: number;
    lineContent: string;
    lineNumber: number;
    isReferenceSource?: boolean;  // Flag to indicate if this is a reference source entry
}

export interface CitationGroup {
    number: string;
    matches: CitationMatch[];
    url?: string;  // Optional URL property
}

export interface ConversionResult {
    content: string;
    changed: boolean;
    stats: {
        citationsConverted: number;
    };
}

export class CitationService {
    /**
     * Find the reference source text for a given citation number in footnotes or references section
     * @param content The full content to search in
     * @param number The citation number to find
     * @returns The reference text or undefined if not found
     */
    private findReferenceSourceInFootnotes(content: string, number: string): string | undefined {
        // Split content into lines and find the References/Footnotes section
        const lines = content.split('\n');
        let inReferencesSection = false;
        
        // Look for the References or Footnotes section
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]?.trim() || '';
            
            // Check for section headers
            if (line.match(/^##?\s+(References|Footnotes|Sources)\s*$/i)) {
                inReferencesSection = true;
                continue;
            }
            
            // If we're in the references section, look for numbered items
            if (inReferencesSection) {
                // Skip empty lines or other section headers
                if (!line || line.startsWith('##')) {
                    if (line.match(/^##?\s+[^\s]+/)) {
                        // Found another section, stop searching
                        break;
                    }
                    continue;
                }
                
                // Check for numbered list items (e.g., "1. " or "1) ")
                const match = line.match(/^(\d+)[.)]\s+(.+)/);
                if (match && match[1] && match[2]) {
                    if (match[1] === number) {
                        return match[2].trim();
                    }
                }
            }
        }
        
        return undefined;
    }

    /**
     * Find all citations in the content
     */
    public findCitations(content: string): CitationGroup[] {
        const matches: CitationMatch[] = [];
        const lines = content.split('\n');
        let currentPosition = 0;
        
        // Find all reference numbers and their sources
        const referenceNumbers = new Set<string>();
        const referenceSources = new Map<string, string>();
        
        // Collect all citation numbers that have reference sources
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]?.trim() || '';
            const citationMatch = line.match(/\[(\d+)\]/g);
            if (citationMatch) {
                citationMatch.forEach(match => {
                    const number = match.replace(/[\[\]]/g, '');
                    referenceNumbers.add(number);
                });
            }
        }
        
        for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
            const line = lines[lineNumber] || '';
            // 1. Check for Perplexity-style footnotes (e.g., "1. [https://...]")
            const perplexityMatch = line.match(/^(\d+)\.\s+\[(https?:\/\/[^\]]+)\]/);
            if (perplexityMatch?.[1] && perplexityMatch[0]) {
                const matchNumber = perplexityMatch[1];
                const url = referenceSources.get(matchNumber);
                // Create base match without URL
                const matchBase = {
                    type: 'perplexity' as const,
                    number: matchNumber,
                    original: perplexityMatch[0],
                    index: currentPosition + line.indexOf(perplexityMatch[0]),
                    lineContent: line,
                    lineNumber: lineNumber
                };
                
                // Add URL if it exists
                const match: CitationMatch = url 
                    ? { ...matchBase, url }
                    : matchBase;
                matches.push(match);
            }
            
            // 2. Find standard footnote references [^1]
            const footnoteRegex = /\[\^(\d+)\]/g;
            let footnoteMatch;
            while ((footnoteMatch = footnoteRegex.exec(line)) !== null) {
                if (footnoteMatch[1]) {
                    // Create base match without URL
                    const matchBase = {
                        type: 'footnote' as const,
                        number: footnoteMatch[1],
                        original: footnoteMatch[0],
                        index: currentPosition + (footnoteMatch.index || 0),
                        lineContent: line,
                        lineNumber: lineNumber
                    };
                    matches.push(matchBase);
                }
            }

            // 3. Find standard numeric citations [1] but skip if in footnotes/references section
            const isInFootnotesSection = content.substring(currentPosition).includes('## Footnotes') || 
                                       content.substring(currentPosition).includes('## References');
        
            if (!isInFootnotesSection) {
                const citationRegex = /\[(\d+)\]/g;
                let citationMatch;
                while ((citationMatch = citationRegex.exec(line)) !== null) {
                    // Skip if this is part of a markdown link [text](url) or footnote [^1]
                    const nextChar = line[citationMatch.index + citationMatch[0].length];
                    if (nextChar !== '(' && nextChar !== '^') {
                        // Create base match without URL
                        if (citationMatch[1]) {  // Ensure we have a valid number
                            const matchBase = {
                                type: 'numeric' as const,
                                number: citationMatch[1],
                                original: citationMatch[0],
                                index: currentPosition + (citationMatch.index || 0),
                                lineContent: line,
                                lineNumber: lineNumber,
                                isReferenceSource: false
                            };
                            matches.push(matchBase);
                        }
                    }
                }
            }

            // Update position for the next line
            currentPosition += line.length + 1; // +1 for the newline character
        }

        // Group matches by number and attach reference sources
        const groups = new Map<string, CitationGroup>();
        
        // Add reference sources to the groups and ensure they're valid strings
        referenceNumbers.forEach(number => {
            // Only process reference sources that are in the footnotes/references section
            const lines = content.split('\n');
            let inFootnotesSection = false;
            let lastReferenceLine = -1;
            
            // Find the last occurrence of this number in the footnotes/references section
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i]?.trim() || '';
                
                // Check for section headers
                if (line.match(/^##\s*(?:References|Footnotes)\s*$/i)) {
                    inFootnotesSection = true;
                    continue;
                } else if (line.startsWith('##') && inFootnotesSection) {
                    // Found another section, stop searching
                    break;
                }
                
                // Look for the reference line in the footnotes section
                if (inFootnotesSection) {
                    const match = line.match(new RegExp(`^${number}\\.\\s+(.+)$`));
                    if (match && match[1]) {
                        lastReferenceLine = i;
                        referenceSources.set(number, match[1].trim());
                    }
                }
            }
            
            // If we found a reference line, add it as a special match
            if (lastReferenceLine !== -1) {
                const source = referenceSources.get(number);
                if (source) {
                    const lineContent = `${number}. ${source}`;
                    const lineStartPos = content.split('\n').slice(0, lastReferenceLine).join('\n').length + 1; // +1 for newline
                    
                    matches.push({
                        type: 'reference',
                        number,
                        original: lineContent,
                        index: content.indexOf(lineContent, lineStartPos - 1) || 0,
                        lineContent: lineContent,
                        lineNumber: lastReferenceLine + 1,
                        isReferenceSource: true
                    });
                }
            }
        });
        
        // Sort matches by line number for better grouping
        matches.sort((a, b) => a.lineNumber - b.lineNumber);
        
        // Create citation groups with proper URL handling
        matches.forEach(match => {
            if (!groups.has(match.number)) {
                const groupUrl = referenceSources.get(match.number);
                const newGroup: CitationGroup = {
                    number: match.number,
                    matches: []
                };
                if (groupUrl) {
                    newGroup.url = groupUrl;
                }
                groups.set(match.number, newGroup);
            }
            
            // Create a clean match object without undefined URL
            const cleanMatch: CitationMatch = {
                ...match,
                url: match.url ? String(match.url) : undefined
            };
            
            groups.get(match.number)?.matches.push(cleanMatch);
        });

        return Array.from(groups.values());
    }

    /**
     * Preprocess content to clean up URL links after citations
     * This handles cases like [1][text](url) or [1](url) and removes the URL part
     */
    private preprocessCitations(content: string): string {
        // First pass: Handle [number][text](url) pattern
        let result = content.replace(
            /\[(\d+)\]\s*\[[^\]]+\]\([^)]+\)/g,
            '[$1]'  // Keep just the [number] part
        );

        // Second pass: Handle [number](url) pattern
        result = result.replace(
            /\[(\d+)\]\([^)]+\)/g,
            '[$1]'  // Keep just the [number] part
        );

        return result;
    }

    /**
     * Convert a specific citation to hex format
     */
    public convertCitation(
        content: string, 
        citationNumber: string, 
        hexId?: string,
        matchIndex: number = -1
    ): ConversionResult {
        // Generate or use provided hex ID
        const targetHexId = hexId || this.generateHexId();
        let updatedContent = content;
        let citationsConverted = 0;
        
        // First, handle the reference source in the footnotes section if it exists
        const refSource = this.findReferenceSourceInFootnotes(content, citationNumber);
        if (refSource) {
            // Format the reference source with the hex ID and colon
            const footnoteDef = `[^${targetHexId}]: ${refSource}`;
            const footnoteSection = this.ensureFootnoteSection(content);
            
            // Remove the original reference line but keep the content
            updatedContent = content.replace(
                new RegExp(`^${citationNumber}\\.\\s+${refSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
                ''
            ).replace(/\n{3,}/g, '\n\n').trim();
            
            // Add the new footnote definition if it doesn't already exist
            if (!footnoteSection.content.includes(`[^${targetHexId}]:`)) {
                // If we're in the references section, add it there, otherwise add to footnotes
                if (content.includes('## References')) {
                    updatedContent = updatedContent.replace(
                        /(## References\n+)(?=[^#])/,
                        `$1${footnoteDef}\n`
                    );
                } else {
                    updatedContent = updatedContent.replace(
                        footnoteSection.marker,
                        `${footnoteSection.marker}\n${footnoteDef}`
                    );
                }
            }
            
            citationsConverted++;
        }
        
        // Then process other citations
        const preprocessedContent = this.preprocessCitations(updatedContent);
        const groups = this.findCitations(preprocessedContent);
        const group = groups.find(g => g.number === citationNumber);
        
        if (!group) {
            return { 
                content: citationsConverted > 0 ? updatedContent : preprocessedContent, 
                changed: citationsConverted > 0, 
                stats: { citationsConverted } 
            };
        }
        
        updatedContent = preprocessedContent;

        // If a specific match index is provided, only convert that one
        const matchesToProcess = matchIndex >= 0 && matchIndex < group.matches.length 
            ? [group.matches[matchIndex]] 
            : [...group.matches].sort((a, b) => b.index - a.index);
        
        // Process matches in reverse order to avoid position shifting
        for (const match of matchesToProcess) {
            if (!match) continue;
            
            const before = updatedContent.substring(0, match.index);
            const after = updatedContent.substring(match.index + match.original.length);
            
            // Replace with hex reference
            updatedContent = `${before}[^${targetHexId}]${after}`;
            citationsConverted++;
            
            // If this was a Perplexity-style citation, clean up the URL part
            if (match.type === 'perplexity' && match.url) {
                // Match the URL pattern that might follow the citation
                const urlPattern = new RegExp(
                    `\\[${citationNumber}\\]\\s*\\[[^\]]+\\]\([^)]+\)`
                );
                const urlMatch = updatedContent.match(urlPattern);
                
                if (urlMatch) {
                    const urlStart = updatedContent.indexOf(urlMatch[0]);
                    const urlEnd = urlStart + urlMatch[0].length;
                    updatedContent = updatedContent.substring(0, urlStart) + 
                                   updatedContent.substring(urlEnd);
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
     * Ensure the document has a footnotes section
     */
    private ensureFootnoteSection(content: string): { content: string; marker: string } {
        const footnoteMarker = '\n\n# Footnotes\n';
        
        if (content.includes(footnoteMarker)) {
            return { content, marker: footnoteMarker };
        }

        const altMarker = '\n## Footnotes\n';
        if (content.includes(altMarker)) {
            return { content, marker: altMarker };
        }

        // Add a new footnotes section at the end
        return { 
            content: content + footnoteMarker, 
            marker: footnoteMarker 
        };
    }

    /**
     * Generate a consistent hex ID for a given URL
     */
    private generateHexId(length: number = 6): string {
        return crypto
            .randomBytes(Math.ceil(length / 2))
            .toString('hex')
            .slice(0, length);
    }

    /**
     * Generate a new hex ID for citations
     * @returns A new unique hex ID
     */
    public getNewHexId(): string {
        return this.generateHexId();
    }

    /**
     * Moves citations that appear before punctuation (like commas or periods) to after the punctuation.
     * Handles multiple citations before punctuation in a single pass.
     * Example: "text[^1][^2]." becomes "text.[^1] [^2]"
     * @param content The content to process
     * @returns The processed content with citations moved behind punctuation
     */
    public moveCitationsBehindPunctuation(content: string): string {
        // Split content into lines to process them individually
        const lines = content.split('\n');
        const processedLines = [];
        
        for (const line of lines) {
            // Skip lines that are part of the references section
            if (line.trim().match(/^\[\^[^\]]+\]:/)) {
                processedLines.push(line);
                continue;
            }
            
            let processedLine = line;
            
            // First, ensure there's a space between multiple citations
            processedLine = processedLine.replace(/(\[\^[^\]]+\])(?=\[\^)/g, '$1 ');
            
            // Handle citations before periods or commas
            // This matches text, followed by citations, followed by punctuation
            const citationsBeforePunctuation = /([^\s\[\]]+)((?:\[\^[^\]]+\](?:\s+)?)+)([.,])/g;
            
            // Process each match in the line
            processedLine = processedLine.replace(citationsBeforePunctuation, (_match, text, citations, punctuation) => {
                // Clean up the citations while preserving internal spacing
                const cleanCitations = citations.replace(/\s+/g, ' ').trim();
                // Move the punctuation after the citations
                return `${text}${punctuation} ${cleanCitations}`;
            });
            
            // Clean up any double spaces that might have been introduced
            processedLine = processedLine.replace(/\s+/g, ' ').replace(/([.,]) \[/g, '$1 [');
            
            processedLines.push(processedLine);
        }
        
        return processedLines.join('\n');
    }

    /**
     * Ensures there is exactly one space between multiple citations
     * Example: "[^1][^2]" becomes "[^1] [^2]"
     * @param content The content to process
     * @returns The processed content with proper spacing between citations
     */
    public assureSpacingBetweenCitations(content: string): string {
        // Match two or more citations with optional whitespace between them
        const multipleCitations = /(\[\^[^\]]+\])(\s*)(?=\[\^[^\]]+\])/g;
        
        // Replace with a single space between citations
        return content.replace(multipleCitations, (_match, citation, _whitespace) => {
            return `${citation} `;
        });
    }
}

// Export a singleton instance
export const citationService = new CitationService();