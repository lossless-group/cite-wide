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
        // Match both formats:
        // 1. [^id]: [PDF] Title URL
        // 2. [^id]: Title URL
        const referenceLine = line.trim().match(/^(\[\^[^\]]+\]:)\s+(?:\[(PDF|DOC|HTML)\]\s+)?(.+?)\s+(https?:\/\/[^\s\]]+)/i);
        
        if (referenceLine) {
            const [, prefix, format, title, url] = referenceLine;
            // Format as markdown link: [Title, FORMAT](URL) or [Title](URL) if no format
            const linkText = format ? `${title}, ${format}` : title;
            const formattedLine = `${prefix} [${linkText}](${url})`;
            processedLines.push(formattedLine);
        } else {
            // Keep the line as is if it doesn't match any pattern
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
