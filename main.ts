import { App, Notice, Plugin, Editor, Modal, ButtonComponent, TFile } from 'obsidian';
import { citationService } from './src/services/citationService';
import { tableCitationService } from './src/services/tableCitationService';
import { CitationModal } from './src/modals/CitationModal';
import { DedupeByUrlModal } from './src/modals/DedupeByUrlModal';
import { cleanReferencesSectionService } from './src/services/cleanReferencesSectionService';
import { formatLinksInSelection } from './src/services/linkSyntaxService';
import { urlCitationService } from './src/services/urlCitationService';
import { citationFileService, initializeCitationFileService, type CitationMetadata } from './src/services/citationFileService';
import { LlmCitationsModal } from './src/modals/LlmCitationsModal';
import { PasteLlmContentModal } from './src/modals/PasteLlmContentModal';
import { CiteWideSettingTab, DEFAULT_SETTINGS, type CiteWideSettings } from './src/settings/CiteWideSettings';

export default class CiteWidePlugin extends Plugin {
    // Obsidian 1.13 declares `settings?: unknown` on Plugin; initialize here
    // so the field is typed and never undefined before loadSettings() runs.
    settings: CiteWideSettings = { ...DEFAULT_SETTINGS };

    async onload(): Promise<void> {
        // Load settings
        await this.loadSettings();
        
        // Configure services
        urlCitationService.setApiKey(this.settings.jinaApiKey);
        initializeCitationFileService(this.app);
        citationFileService.setCitationsFolder(this.settings.citationsFolder || 'Citations');
        
        // Load CSS
        // this.loadStyles();
        
        // Register commands
        this.registerCitationCommands();
        this.registerReferenceCleanupCommands();
        this.registerCitationFormattingCommands();
        this.registerUrlCitationCommands();
        
        // Add settings tab
        this.addSettingTab(new CiteWideSettingTab(this.app, this));
        this.registerLinkFormattingCommands();
        
        // Add ribbon icon
        const ribbonIconEl = this.addRibbonIcon(
            'quote-glyph', // You can change this to any Lucide icon name
            'Add citation', // Tooltip text
            () => {
                // Open citation modal when clicked
                const activeEditor = this.app.workspace.activeEditor?.editor;
                if (activeEditor) {
                    new CitationModal(this.app, activeEditor).open();
                } else {
                    new Notice('Please open a note to add citations');
                }
            }
        );
        
        // Optional: Add a class for custom styling
        ribbonIconEl.addClass('cite-wide-ribbon-icon');
    }

    async loadSettings(): Promise<void> {
        const data: unknown = await this.loadData();
        const stored = (data !== null && typeof data === 'object' ? data : {}) as Partial<CiteWideSettings>;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }
    
    // private async loadStyles() {
    //     try {
    //         const cssPath = this.manifest.dir + '/styles.css';
    //         const response = await fetch(cssPath);
    //         if (!response.ok) throw new Error('Failed to load CSS');
            
    //         const css = await response.text();
    //         const styleEl = document.createElement('style');
    //         styleEl.id = 'cite-wide-styles';
    //         styleEl.textContent = css;
    //         document.head.appendChild(styleEl);
    //     } catch (error) {
    //         console.error('Error loading styles:', error);
    //     }
    // }

    private registerCitationCommands(): void {
        // Command to show citations in current file
        this.addCommand({
            id: 'show-citations',
            name: 'Show citations in current file',
            editorCallback: (editor: Editor) => {
                new CitationModal(this.app, editor).open();
            }
        });

        // Command to dedupe citations that share the same URL
        this.addCommand({
            id: 'dedupe-citations-by-url',
            name: 'Dedupe citations by URL',
            editorCallback: (editor: Editor) => {
                new DedupeByUrlModal(this.app, editor).open();
            }
        });

        // Command to convert LLM-tool citation outputs (Google AI's [1, 2, 3] form,
        // Perplexity's [1][2] adjacent form, plus their `[N] [Title](url)` reference
        // definitions) into the Lossless hex format. Opens a modal so the user can
        // preview every proposed [N] → [^hex] transformation, jump to line numbers
        // via clickable links, and selectively opt in/out per-numeric.
        this.addCommand({
            id: 'parse-llm-citations',
            name: 'Parse LLM citations in current file',
            editorCallback: (editor: Editor) => {
                new LlmCitationsModal(this.app, editor).open();
            }
        });

        // Command to paste raw LLM output into a buffer, convert citations
        // on-the-fly, and insert at the cursor — preventing the colliding-
        // numerics problem at its source rather than fixing it post-hoc.
        this.addCommand({
            id: 'paste-llm-content',
            name: 'Paste LLM content (convert citations on insert)',
            editorCallback: (editor: Editor) => {
                new PasteLlmContentModal(this.app, editor).open();
            }
        });

        // Command to save all hex citations in the active file as canonical citation files
        this.addCommand({
            id: 'save-all-hex-citations',
            name: 'Save all hex citations to citation files',
            editorCallback: async (editor: Editor) => {
                try {
                    const content = editor.getValue();
                    const activeFile = this.app.workspace.getActiveFile();
                    const sourceFile = activeFile ? activeFile.path : '';
                    const result = await citationFileService.saveAllHexCitationsFromContent(content, sourceFile);

                    if (result.saved === 0 && result.updated === 0 && result.errors === 0) {
                        new Notice('No hex citations found in this document.');
                        return;
                    }
                    const parts: string[] = [];
                    if (result.saved > 0) parts.push(`saved ${result.saved}`);
                    if (result.updated > 0) parts.push(`updated ${result.updated}`);
                    if (result.errors > 0) parts.push(`${result.errors} error${result.errors === 1 ? '' : 's'}`);
                    new Notice(`Citations: ${parts.join(', ')}.`);
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    new Notice('Error saving hex citations: ' + msg);
                }
            }
        });

        // Command to convert all citations to hex format
        this.addCommand({
            id: 'convert-all-citations',
            name: 'Convert all citations to hex format',
            editorCallback: async (editor: Editor) => {
                try {
                    await this.convertAllCitations(editor);
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    new Notice('Error processing citations: ' + errorMsg);
                }
            }
        });

        // Command to insert a new citation
        this.addCommand({
            id: 'insert-hex-citation',
            name: 'Insert hex citation',
            editorCallback: async (editor: Editor) => {
                try {
                    const cursor = editor.getCursor();
                    const hexId = citationService.generateHexId();
                    
                    // Get current file path for citation tracking
                    const activeFile = this.app.workspace.getActiveFile();
                    const sourceFile = activeFile ? activeFile.path : '';
                    
                    // Insert the citation reference at cursor
                    editor.replaceRange(`[^${hexId}]`, cursor);
                    
                    // Add the footnote definition at the end
                    const content = editor.getValue();
                    const footnotePosition = {
                        line: content.split('\n').length,
                        ch: 0 
                    };
                    
                    editor.replaceRange(`\n\n[^${hexId}]: `, footnotePosition);
                    
                    // Create citation file for Dataview integration
                    await citationFileService.createCitationFile(hexId, undefined, undefined, sourceFile);
                    
                    // Position cursor after the inserted citation
                    const newPos = {
                        line: footnotePosition.line + 2, // +2 for the two newlines
                        ch: `[^${hexId}]: `.length
                    };
                    editor.setCursor(newPos);
                    
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    new Notice('Error inserting citation: ' + errorMsg);
                }
            }
        });

        // Command to convert selected citation to hex format
        this.addCommand({
            id: 'convert-selected-citation-to-hex',
            name: 'Convert selected citation to hex',
            editorCallback: (editor: Editor) => {
                const selection = editor.getSelection();
                if (!selection) {
                    new Notice('Please select a citation reference first (e.g., "[1]: content")');
                    return;
                }
                
                const result = citationService.convertSelectedCitationToHex(selection);
                
                if (result.changed) {
                    editor.replaceSelection(result.content);
                    // Extract the hex ID from the converted content for the notice
                    const hexMatch = result.content.match(/\[\^([a-zA-Z0-9]+)\]/);
                    const hexId = hexMatch ? hexMatch[1] : 'unknown';
                    new Notice(`Converted citation to hex format: [^${hexId}]`);
                } else {
                    new Notice('Selected text does not appear to be a valid citation reference');
                }
            }
        });
    }

    private registerReferenceCleanupCommands(): void {
        // Command to clean up references section
        this.addCommand({
            id: 'clean-references-section',
            name: 'Add colon to footnote references in selection',
            editorCallback: (editor: Editor) => {
                const selection = editor.getSelection();
                if (!selection) {
                    new Notice('Please select some text first');
                    return;
                }
                
                const processed = cleanReferencesSectionService.addColonSyntaxWhereNone(selection);
                editor.replaceSelection(processed);
                new Notice('References cleaned up successfully');
            }
        });

        // Command to convert citation section to footnotes
        this.addCommand({
            id: 'convert-citation-section-to-footnotes',
            name: 'Convert citation section to footnotes',
            editorCallback: (editor: Editor) => {
                const selection = editor.getSelection();
                if (!selection) {
                    new Notice('Please select a citation section first');
                    return;
                }
                
                this.convertCitationSectionToFootnotes(editor, selection);
            }
        });
    }

    private registerCitationFormattingCommands(): void {
        // Command to format citations by moving them after punctuation and ensuring proper spacing
        this.addCommand({
            id: 'format-citations-punctuation',
            name: 'Assure spacing for anchor link behavior',
            editorCallback: (editor: Editor) => {
                // Process the entire document content
                const content = editor.getValue();
                
                // First move citations after punctuation, then ensure proper spacing
                let processed = citationService.moveCitationsBehindPunctuation(content);
                processed = citationService.assureSpacingBetweenCitations(processed);
                
                // Only update if there were changes
                if (processed !== content) {
                    editor.setValue(processed);
                    new Notice('Formatted citations in document');
                } else {
                    new Notice('No citations needed formatting');
                }
            }
        });

        // Obsidian won't render a footnote marker inside a table cell, so
        // citations written into tables are inert. This lifts them out into a
        // "Sources for Table:" line beneath each table. Idempotent — safe to
        // run repeatedly on the same document.
        this.addCommand({
            id: 'lift-table-citations',
            name: 'Lift table citations below table',
            editorCallback: (editor: Editor) => {
                const content = editor.getValue();
                const result = tableCitationService.liftTableCitations(content);

                if (!result.changed) {
                    new Notice(
                        result.stats.tablesFound === 0
                            ? 'No tables found in this document'
                            : 'No table citations needed lifting'
                    );
                    return;
                }

                editor.setValue(result.content);
                const { citationsLifted, tablesModified, uniqueSourcesEmitted } = result.stats;
                new Notice(
                    `Lifted ${citationsLifted} citation${citationsLifted === 1 ? '' : 's'} ` +
                    `from ${tablesModified} table${tablesModified === 1 ? '' : 's'} ` +
                    `(${uniqueSourcesEmitted} unique)`
                );
            }
        });
    }

    private registerUrlCitationCommands(): void {
        // Command to extract citation from highlighted URL
        this.addCommand({
            id: 'extract-citation-from-url',
            name: 'Extract citation from URL',
            editorCallback: async (editor: Editor) => {
                try {
                    const selection = editor.getSelection();
                    
                    if (!selection) {
                        new Notice('Please select a URL first');
                        return;
                    }

                    // Check if the selection looks like a citation reference with URL
                    const cleanSelection = selection.trim();
                    
                    // First, try to match citation with markdown link format: [^hexId]: [title](url)
                    const citationWithMarkdownLinkRegex = /\[\^([a-zA-Z0-9]+)\]:\s*\[([^\]]+)\]\(([^)]+)\)/;
                    let citationMatch = cleanSelection.match(citationWithMarkdownLinkRegex);
                    
                    // If that doesn't work, try direct URL format: [^hexId]: url
                    if (!citationMatch) {
                        const citationWithUrlRegex = /"?\[\^([a-zA-Z0-9]+)\]:\s*(https?:\/\/[^\s]+)"?/;
                        citationMatch = cleanSelection.match(citationWithUrlRegex);
                    }
                    
                    // If the first regex doesn't work, try a more flexible one
                    if (!citationMatch) {
                        const flexibleRegex2 = /"?\[\^([a-zA-Z0-9]+)\]:\s*(https?:\/\/[^)\s]+)"?/;
                        citationMatch = cleanSelection.match(flexibleRegex2);
                    }
                    
                    let hexId: string;
                    let url: string;
                    
                    if (citationMatch && citationMatch[1]) {
                        // This is a citation reference - use existing hex ID
                        hexId = citationMatch[1];
                        
                        // Check if it's markdown link format (3 groups: hexId, title, url)
                        if (citationMatch[3]) {
                            // Markdown link format: [^hexId]: [title](url)
                            url = citationMatch[3];
                        } else if (citationMatch[2]) {
                            // Direct URL format: [^hexId]: url
                            url = citationMatch[2];
                        } else {
                            new Notice('Could not extract URL from citation reference');
                            return;
                        }
                        
                        // Check if this citation file already exists
                        const filename = `${hexId}.md`;
                        const filepath = `${citationFileService.getCitationsFolder()}/${filename}`;
                        const existingFile = this.app.vault.getAbstractFileByPath(filepath);
                        
                        
                        if (existingFile instanceof TFile) {
                            // Citation file already exists - just update usage and notify
                            const activeFile = this.app.workspace.getActiveFile();
                            const sourceFile = activeFile ? activeFile.path : '';
                            await citationFileService.updateCitationUsage(existingFile, sourceFile);
                            new Notice(`Citation ${hexId} already exists and usage updated`);
                            return;
                        }
                    } else {
                        // Check if it's just a URL
                        const urlRegex = /https?:\/\/[^\s]+/;
                        const urlMatch = selection.match(urlRegex);
                        
                        if (!urlMatch) {
                            new Notice('Selected text does not appear to be a valid URL or citation reference');
                            return;
                        }
                        
                        url = urlMatch[0];
                        // Generate new hex ID for plain URL
                        hexId = citationService.generateHexId();
                    }

                    // Check for duplicate citation by URL
                    const existingCitation = citationFileService.findCitationByUrl(url);
                    if (existingCitation) {
                        // Show modal to user: Use existing or create new?
                        const modal = new ConfirmDuplicateCitationModal(this.app, existingCitation, async (useExisting: boolean) => {
                            if (useExisting) {
                                // Get the full citation text from the existing citation file
                                const citationText = citationFileService.getCitationText(existingCitation.hexId);
                                if (citationText) {
                                    // Replace the selected text with the full citation text
                                    editor.replaceSelection(citationText);
                                    
                                    // Replace all references to the old hex ID with the new hex ID throughout the file
                                    const content = editor.getValue();
                                    const oldHexId = hexId; // This is the hex ID from the selected citation
                                    const newHexId = existingCitation.hexId; // This is the existing citation's hex ID
                                    
                                    // Replace all citation references [^oldHexId] with [^newHexId]
                                    const updatedContent = content.replace(
                                        new RegExp(`\\[\\^${oldHexId}\\]`, 'g'), 
                                        `[^${newHexId}]`
                                    );
                                    
                                    // Update the editor with the modified content
                                    editor.setValue(updatedContent);
                                    
                                    // Delete the old citation file if it exists
                                    const oldFilename = `${oldHexId}.md`;
                                    const oldFilepath = `${citationFileService.getCitationsFolder()}/${oldFilename}`;
                                    const oldFile = this.app.vault.getAbstractFileByPath(oldFilepath);
                                    if (oldFile instanceof TFile) {
                                        await this.app.fileManager.trashFile(oldFile);
                                    }
                                    
                                    // Increment usage count for the existing citation
                                    const filename = `${existingCitation.hexId}.md`;
                                    const filepath = `${citationFileService.getCitationsFolder()}/${filename}`;
                                    const existingFile = this.app.vault.getAbstractFileByPath(filepath);
                                    if (existingFile instanceof TFile) {
                                        const activeFile = this.app.workspace.getActiveFile();
                                        const sourceFile = activeFile ? activeFile.path : '';
                                        await citationFileService.updateCitationUsage(existingFile, sourceFile);
                                    }
                                    
                                    new Notice(`Used existing citation: ${existingCitation.hexId}`);
                                } else {
                                    // Fallback: just insert the hex ID reference
                                    editor.replaceSelection(`[^${existingCitation.hexId}]`);
                                    new Notice(`Used existing citation: ${existingCitation.hexId}`);
                                }
                            } else {
                                // Proceed as normal (extract and create new citation)
                                await this.extractAndInsertCitation(editor, url, hexId);
                            }
                        });
                        modal.open();
                        return;
                    }

                    // No duplicate found, proceed as normal
                    await this.extractAndInsertCitation(editor, url, hexId);
                } catch (error) {
                    console.error('Error extracting citation from URL:', error);
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    new Notice(`Error extracting citation: ${errorMsg}`);
                }
            }
        });
    }

    // Helper to extract and insert citation, and create citation file
    private async extractAndInsertCitation(editor: Editor, url: string, hexId: string) {
        // Show loading notice
        new Notice('Extracting citation from URL...');
        // Show rate limit notice if no API key is configured
        if (!urlCitationService.hasApiKey()) {
            new Notice('Tip: Adding a Jina.ai API key in settings can avoid rate limits');
        }
        // Extract citation using Jina.ai
        const result = await urlCitationService.extractCitationFromUrl(url, hexId);
        if (!result.success) {
            new Notice(`Error: ${result.error}`);
            return;
        }
        if (!result.citation || !result.hexId) {
            new Notice('Failed to extract citation data');
            return;
        }
        // Replace the URL with the full formatted citation
        editor.replaceSelection(result.citation);

        // Create citation file for Dataview integration only when auto-save is enabled.
        // Default is off — users canonicalize specific citations explicitly via the
        // "Save All Hex Citations" command or the per-citation Save button in the modal.
        if (!this.settings.autoSaveUrlCitations) {
            new Notice(`Citation extracted: ${result.hexId} (not saved — use "Save All Hex Citations" to canonicalize)`);
            return;
        }
        const activeFile = this.app.workspace.getActiveFile();
        const sourceFile = activeFile ? activeFile.path : '';
        if (result.citationData) {
            await citationFileService.createCitationFileWithData(
                result.hexId,
                result.citationData,
                sourceFile
            );
        } else {
            await citationFileService.createCitationFile(
                result.hexId,
                result.citation,
                url,
                sourceFile
            );
        }
        new Notice(`Citation extracted successfully: ${result.hexId}`);
    }

    /**
     * Convert all citations to hex format - shared logic for both command and modal
     */
    private async convertAllCitations(editor: Editor): Promise<void> {
        const content = editor.getValue();
        let updatedContent = content;
        let totalConverted = 0;

        // Extract all citation groups
        const citationGroups = citationService.extractCitations(content);

        // Process each group
        for (const group of citationGroups) {
            const result = citationService.convertCitation(
                updatedContent,
                group.number
            );

            if (result.changed) {
                updatedContent = result.content;
                totalConverted += result.stats.citationsConverted;
            }
        }

        if (totalConverted > 0) {
            editor.setValue(updatedContent);
            new Notice(`Converted ${totalConverted} citations to hex format`);
        } else {
            new Notice('No citations were converted');
        }
    }

    /**
     * Convert a citation section to proper Obsidian footnotes
     * Creates footnote references in the text and moves definitions to the bottom
     * Handles both numeric citations [1]: and hex citations [^hexId]:, converting numeric to hex
     */
    private convertCitationSectionToFootnotes(editor: Editor, selection: string): void {
        const lines = selection.split('\n').filter(line => line.trim());
        const footnotes: string[] = [];
        const references: string[] = [];
    
        // Process each line to extract citations
        lines.forEach(line => {
            // Match both hex citations [^hexId]: and numeric citations [1]:
            const hexCitationRegex = /^(\[\^[a-zA-Z0-9]+\])\s*(.+)$/;
            const numericCitationRegex = /^(\[\d+\]):\s*(.+)$/;
            
            let match = line.match(hexCitationRegex);
            let isHexCitation = true;
            
            if (!match) {
                match = line.match(numericCitationRegex);
                isHexCitation = false;
            }
    
            if (match && match[1] && match[2]) {
                const citationId = match[1]; // [^hexId] or [1]
                const content = match[2]; // rest of the line
    
                if (isHexCitation) {
                    // For hex citations, keep the original format
                    references.push(citationId);
                    footnotes.push(`${citationId}: ${content}`);
                } else {
                    // For numeric citations, convert to hex format
                    const hexId = citationService.generateHexId();
                    references.push(`[^${hexId}]`);
                    footnotes.push(`[^${hexId}]: ${content}`);
                }
            }
        });
    
        if (footnotes.length === 0) {
            new Notice('No valid citations found in selection');
            return;
        }
    
        // Remove the selected text from the document
        const start = editor.getCursor('from'); // selection start
        const end = editor.getCursor('to');     // selection end
        editor.replaceRange('', start, end);    // removes selection in editor
    
        // Get the updated content after removal
        const newContent = editor.getValue();
    
        // Create footnotes section
        const footnotesSection = '\n\n# Footnotes\n\n' + footnotes.join('\n\n');
    
        // Append footnotes section to the updated content
        const updatedContent = newContent + footnotesSection;
    
        editor.setValue(updatedContent);
        new Notice(`Created ${footnotes.length} footnotes`);
    }
    

    private registerLinkFormattingCommands(): void {
        // Command to format links in the selected text
        this.addCommand({
            id: 'format-reference-links',
            name: 'Format reference links in selection',
            editorCallback: (editor: Editor) => {
                formatLinksInSelection(editor);
            }
        });
    }
}

// Modal for confirming duplicate citation usage
class ConfirmDuplicateCitationModal extends Modal {
    private existingCitation: CitationMetadata;
    private onDecision: (useExisting: boolean) => Promise<void>;
    constructor(app: App, existingCitation: CitationMetadata, onDecision: (useExisting: boolean) => Promise<void>) {
        super(app);
        this.existingCitation = existingCitation;
        this.onDecision = onDecision;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Duplicate citation detected' });
        contentEl.createEl('p', { text: `A citation with the same URL already exists (hex ID: ${this.existingCitation.hexId}).` });
        const btnContainer = contentEl.createDiv('modal-button-container');
        new ButtonComponent(btnContainer)
            .setButtonText('Use existing')
            .onClick(() => {
                void this.onDecision(true);
                this.close();
            });
        new ButtonComponent(btnContainer)
            .setButtonText('Create new')
            .setCta()
            .onClick(() => {
                void this.onDecision(false);
                this.close();
            });
    }
}
