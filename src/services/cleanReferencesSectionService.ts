/**
 * Service for cleaning up and normalizing references sections in markdown content
 */

/**
 * Adds colon syntax to footnote references that are missing it
 * @param text The text to process
 * @returns The processed text with colons added to footnote references
 */
export function addColonSyntaxWhereNone(text: string): string {
    if (!text) return text;
    
    // Split the text into lines and process each line
    return text.split('\n').map(line => {
        // Match footnote references that don't have a colon after the ID
        // Format: [^hexId] Text...
        const footnoteRegex = /^(\s*\[\^([a-z0-9]+)\])(?::?\s*)(.*)$/i;
        const match = line.match(footnoteRegex);
        
        if (match && match[1] && match[2] && match[3] !== undefined) {
            const leadingSpaceMatch = match[1].match(/^\s*/);
            const leadingSpace = leadingSpaceMatch ? leadingSpaceMatch[0] : '';
            const id = match[2];
            const content = match[3].trimStart();
            // Preserve leading space and ensure exactly one space after the colon
            return `${leadingSpace}[^${id}]: ${content}`;
        }
        
        return line;
    }).join('\n');
}

export const cleanReferencesSectionService = {
    addColonSyntaxWhereNone
};

export default cleanReferencesSectionService;
