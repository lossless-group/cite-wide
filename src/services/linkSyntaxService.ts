import { Editor, Notice } from 'obsidian';

/**
 * Service for formatting links in markdown syntax
 */

/**
 * Formats markdown links in the reference section from plain text to markdown link syntax
 * @param content The markdown content to process
 * @returns The processed content with formatted links
 */
export function formatLinksInMarkdownSyntax(content: string): string {
    // Split content into lines for processing
    const lines = content.split('\n');
    const processedLines = [];

    for (const line of lines) {
        // Only process lines that look like reference definitions: [^id]: Title URL
        const referenceLine = line.trim().match(/^(\[\^[^\]]+\]:)\s+(.+?)\s+(https?:\/\/[^\s\]]+)/);
        
        if (referenceLine) {
            const [, prefix, title, url] = referenceLine;
            // Format as markdown link: [Title](URL)
            const formattedLine = `${prefix} [${title}](${url})`;
            processedLines.push(formattedLine);
        } else {
            // Keep the line as is if it doesn't match the pattern
            processedLines.push(line);
        }
    }

    return processedLines.join('\n');
}

/**
 * Formats links in the given markdown content
 * @param content The markdown content to process
 * @returns The processed content with formatted links
 */
export function formatLinksInMarkdownContent(content: string): string {
    return formatLinksInMarkdownSyntax(content);
}

/**
 * Creates a command to format links in the selected text
 * @param editor The editor instance
 * @returns void
 */
export function formatLinksInSelection(editor: Editor): boolean {
    const selection = editor.getSelection();
    if (!selection) {
        new Notice('Please select the text containing references to format');
        return false;
    }
    
    const processed = formatLinksInMarkdownSyntax(selection);
    if (processed !== selection) {
        editor.replaceSelection(processed);
        new Notice('Formatted links in selection');
        return true;
    }
    
    new Notice('No links needed formatting in selection');
    return false;
}
