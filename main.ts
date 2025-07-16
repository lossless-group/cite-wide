import { Notice, Plugin, Editor } from 'obsidian';
import { citationService } from './src/services/citationService';
import { CitationModal } from './src/modals/CitationModal';
import { cleanReferencesSectionService } from './src/services/cleanReferencesSectionService';
import { formatLinksInSelection } from './src/services/linkSyntaxService';
import { urlCitationService } from './src/services/urlCitationService';
import { citationFileService, initializeCitationFileService } from './src/services/citationFileService';
import { CiteWideSettingTab, DEFAULT_SETTINGS, type CiteWideSettings } from './src/settings/CiteWideSettings';
import { Modal, ButtonComponent } from 'obsidian';
import { TFile } from 'obsidian';

export default class CiteWidePlugin extends Plugin {
    settings!: CiteWideSettings;

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

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
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
                    
                    // Use the convertAllCitations method which handles all citations at once
                    const result = citationService.convertAllCitations(content);
                    
                    if (result.changed) {
                        editor.setValue(result.content);
                        new Notice(`Updated ${result.stats.citationsConverted} citations`);
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
            editorCallback: async (editor: Editor) => {
                try {
                    const cursor = editor.getCursor();
                    const hexId = citationService.getNewHexId();
                    
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

    private registerUrlCitationCommands(): void {
        // Command to extract citation from highlighted URL
        this.addCommand({
            id: 'extract-citation-from-url',
            name: 'Extract Citation from URL',
            editorCallback: async (editor: Editor) => {
                try {
                    const selection = editor.getSelection();
                    
                    if (!selection) {
                        new Notice('Please select a URL first');
                        return;
                    }

                    // Check if the selection looks like a citation reference with URL
                    const cleanSelection = selection.trim();
                    
                    const citationWithUrlRegex = /"?\[\^([a-zA-Z0-9]+)\]:\s*(https?:\/\/[^\s]+)"?/;
                    let citationMatch = cleanSelection.match(citationWithUrlRegex);
                    
                    // If the first regex doesn't work, try a more flexible one
                    if (!citationMatch) {
                        const flexibleRegex2 = /"?\[\^([a-zA-Z0-9]+)\]:\s*(https?:\/\/[^)\s]+)"?/;
                        citationMatch = cleanSelection.match(flexibleRegex2);
                    }
                    
                    let hexId: string;
                    let url: string;
                    
                    if (citationMatch && citationMatch[1] && citationMatch[2]) {
                        // This is a citation reference with URL - use existing hex ID
                        hexId = citationMatch[1];
                        url = citationMatch[2];
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
                        hexId = citationService.getNewHexId();
                    }

                    // Check for duplicate citation by URL
                    const existingCitation = await citationFileService.findCitationByUrl(url);
                    if (existingCitation) {
                        // Show modal to user: Use existing or create new?
                        const modal = new ConfirmDuplicateCitationModal(this.app, existingCitation, async (useExisting: boolean) => {
                            if (useExisting) {
                                // Get the full citation text from the existing citation file
                                const citationText = await citationFileService.getCitationText(existingCitation.hexId);
                                console.log('citationText', citationText);
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
                                        await this.app.vault.delete(oldFile);
                                        console.log(`Deleted old citation file: ${oldFilename}`);
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
        // Create citation file for Dataview integration
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

// Modal for confirming duplicate citation usage
class ConfirmDuplicateCitationModal extends Modal {
    private existingCitation: any;
    private onDecision: (useExisting: boolean) => void;
    constructor(app: any, existingCitation: any, onDecision: (useExisting: boolean) => void) {
        super(app);
        this.existingCitation = existingCitation;
        this.onDecision = onDecision;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Duplicate Citation Detected' });
        contentEl.createEl('p', { text: `A citation with the same URL already exists (hex ID: ${this.existingCitation.hexId}).` });
        const btnContainer = contentEl.createDiv('modal-button-container');
        new ButtonComponent(btnContainer)
            .setButtonText('Use Existing')
            .onClick(() => {
                this.onDecision(true);
                this.close();
            });
        new ButtonComponent(btnContainer)
            .setButtonText('Create New')
            .setCta()
            .onClick(() => {
                this.onDecision(false);
                this.close();
            });
    }
}