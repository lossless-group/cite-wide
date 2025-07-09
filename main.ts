import { Notice, Plugin, Editor } from 'obsidian';
import { citationService } from './src/services/citationService';
import { CitationModal } from './src/modals/CitationModal';
import { cleanReferencesSectionService } from './src/services/cleanReferencesSectionService';
import { formatLinksInSelection } from './src/services/linkSyntaxService';

export default class CiteWidePlugin extends Plugin {
    async onload(): Promise<void> {
        // Load CSS
        this.loadStyles();
        
        // Register commands
        this.registerCitationCommands();
        this.registerReferenceCleanupCommands();
        this.registerCitationFormattingCommands();
        this.registerLinkFormattingCommands();
        
        // Add ribbon icon
        const ribbonIconEl = this.addRibbonIcon(
            'quote-glyph', // You can change this to any Lucide icon name
            'Add Citation', // Tooltip text
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
    
    private async loadStyles() {
        try {
            const cssPath = this.manifest.dir + '/styles.css';
            const response = await fetch(cssPath);
            if (!response.ok) throw new Error('Failed to load CSS');
            
            const css = await response.text();
            const styleEl = document.createElement('style');
            styleEl.id = 'cite-wide-styles';
            styleEl.textContent = css;
            document.head.appendChild(styleEl);
        } catch (error) {
            console.error('Error loading styles:', error);
        }
    }

    private registerCitationCommands(): void {
        // Command to show citations in current file
        this.addCommand({
            id: 'show-citations',
            name: 'Show Citations in Current File',
            editorCallback: (editor: Editor) => {
                new CitationModal(this.app, editor).open();
            }
        });

        // Command to convert all citations to hex format
        this.addCommand({
            id: 'convert-all-citations',
            name: 'Convert All Citations to Hex Format',
            editorCallback: async (editor: Editor) => {
                try {
                    const content = editor.getValue();
                    // Get all citation groups
                    const groups = citationService.findCitations(content);
                    let totalConverted = 0;
                    let updatedContent = content;
                    
                    // Convert each citation group
                    for (const group of groups) {
                        const result = citationService.convertCitation(updatedContent, group.number);
                        if (result.changed) {
                            updatedContent = result.content;
                            totalConverted += result.stats.citationsConverted;
                        }
                    }
                    
                    if (totalConverted > 0) {
                        editor.setValue(updatedContent);
                        new Notice(`Updated ${totalConverted} citations`);
                    } else {
                        new Notice('No citations needed conversion');
                    }
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    new Notice('Error processing citations: ' + errorMsg);
                }
            }
        });

        // Command to insert a new citation
        this.addCommand({
            id: 'insert-hex-citation',
            name: 'Insert Hex Citation',
            editorCallback: (editor: Editor) => {
                try {
                    const cursor = editor.getCursor();
                    const hexId = citationService.getNewHexId();
                    
                    // Insert the citation reference at cursor
                    editor.replaceRange(`[^${hexId}]`, cursor);
                    
                    // Add the footnote definition at the end
                    const content = editor.getValue();
                    const footnotePosition = {
                        line: content.split('\n').length,
                        ch: 0 
                    };
                    
                    editor.replaceRange(`\n\n[^${hexId}]: `, footnotePosition);
                    
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
    }

    private registerReferenceCleanupCommands(): void {
        // Command to clean up references section
        this.addCommand({
            id: 'clean-references-section',
            name: 'Add Colon to Footnote References in Selection',
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
    }

    private registerCitationFormattingCommands(): void {
        // Command to format citations by moving them after punctuation and ensuring proper spacing
        this.addCommand({
            id: 'format-citations-punctuation',
            name: 'Move Citations after Punctuation',
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
    }

    private registerLinkFormattingCommands(): void {
        // Command to format links in the selected text
        this.addCommand({
            id: 'format-reference-links',
            name: 'Format Reference Links in Selection',
            editorCallback: (editor: Editor) => {
                formatLinksInSelection(editor);
            }
        });
    }
}