import { Notice, Plugin, Editor } from 'obsidian';
import { citationService } from './src/services/citationService';
import { CitationModal } from './src/modals/CitationModal';
import { cleanReferencesSectionService } from './src/services/cleanReferencesSectionService';
import { urlCitationService } from './src/services/urlCitationService';
import { CiteWideSettingTab, DEFAULT_SETTINGS, type CiteWideSettings } from './src/settings/CiteWideSettings';

export default class CiteWidePlugin extends Plugin {
    settings!: CiteWideSettings;

    async onload(): Promise<void> {
        // Load settings
        await this.loadSettings();
        
        // Configure URL citation service with API key
        urlCitationService.setApiKey(this.settings.jinaApiKey);
        
        // Load CSS
        // this.loadStyles();
        
        // Register commands
        this.registerCitationCommands();
        this.registerReferenceCleanupCommands();
        this.registerCitationFormattingCommands();
        this.registerUrlCitationCommands();
        
        // Add settings tab
        this.addSettingTab(new CiteWideSettingTab(this.app, this));
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

                    // Check if the selection looks like a URL
                    const urlRegex = /https?:\/\/[^\s]+/;
                    const urlMatch = selection.match(urlRegex);
                    
                    if (!urlMatch) {
                        new Notice('Selected text does not appear to be a valid URL');
                        return;
                    }

                    const url = urlMatch[0];
                    
                    // Show loading notice
                    new Notice('Extracting citation from URL...');
                    
                    // Show rate limit notice if no API key is configured
                    if (!urlCitationService.hasApiKey()) {
                        new Notice('Tip: Adding a Jina.ai API key in settings can avoid rate limits');
                    }
                    
                    // Extract citation using Jina.ai
                    const result = await urlCitationService.extractCitationFromUrl(url);
                    
                    if (!result.success) {
                        new Notice(`Error: ${result.error}`);
                        return;
                    }

                    if (!result.citation || !result.hexId) {
                        new Notice('Failed to extract citation data');
                        return;
                    }

                    // Check if this URL is already in a footnote
                    const content = editor.getValue();
                    const footnoteRegex = /\[\^([a-f0-9]+)\]:\s*@?https?:\/\/[^\s]+/g;
                    let match;
                    let foundFootnote = false;
                    
                    while ((match = footnoteRegex.exec(content)) !== null) {
                        const footnoteUrl = match[0].match(/https?:\/\/[^\s]+/)?.[0];
                        if (footnoteUrl === url) {
                            // Found existing footnote with this URL, update it
                            const hexId = match[1];
                            const newFootnote = `[^${hexId}]: ${result.citation.replace(/^\[\^[a-f0-9]+\]:\s*/, '')}`;
                            
                            const updatedContent = content.replace(match[0], newFootnote);
                            editor.setValue(updatedContent);
                            
                            new Notice(`Updated existing footnote: ${hexId}`);
                            foundFootnote = true;
                            break;
                        }
                    }
                    
                    if (!foundFootnote) {
                        // No existing footnote found, create new one
                        const citationReference = `[^${result.hexId}]`;
                        editor.replaceSelection(citationReference);
                        
                        // Add the citation definition to the footnotes section
                        const footnoteSection = this.ensureFootnoteSection(content);
                        
                        // Add the citation definition
                        const updatedContent = content.replace(
                            footnoteSection.marker,
                            `${footnoteSection.marker}\n${result.citation}`
                        );
                        
                        editor.setValue(updatedContent);
                        
                        new Notice(`Citation extracted successfully: ${result.hexId}`);
                    }
                    
                } catch (error) {
                    console.error('Error extracting citation from URL:', error);
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    new Notice(`Error extracting citation: ${errorMsg}`);
                }
            }
        });
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
}