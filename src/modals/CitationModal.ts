// cite-wide/src/modals/CitationModal.ts
import { App, Modal, Notice, Editor, TFile } from 'obsidian';
import { citationService } from '../services/citationService';
import type { CitationGroup, CitationMatch } from '../services/citationService';
import { citationFileService } from '../services/citationFileService';

export class CitationModal extends Modal {
    private editor: Editor;
    private content: string;
    private citationGroups: CitationGroup[] = [];

    constructor(app: App, editor: Editor) {
        super(app);
        this.editor = editor;
        this.content = editor.getValue();
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        // Make the modal wider
        const modalContainer = contentEl.closest('.modal-container') as HTMLElement;
        const modalContent = contentEl.closest('.modal-content') as HTMLElement;
        
        if (modalContainer && modalContent) {
            // Set the modal container to be very wide
            modalContainer.style.width = '95vw';
            modalContainer.style.maxWidth = 'none';
            
            // Ensure the content takes full width
            modalContent.style.width = '100%';
            modalContent.style.maxWidth = 'none';
        }
        
        contentEl.addClass('cite-wide-modal');

        // Extract all citation groups
        this.citationGroups = citationService.extractCitations(this.content);

        if (this.citationGroups.length === 0) {
            contentEl.createEl('p', { 
                text: 'No citations found in the current document.' 
            });
            return;
        }

        // Create a container for citation groups
        const container = contentEl.createDiv('cite-wide-container');
        
        // Create header with title and convert all button
        const header = container.createDiv('cite-wide-header');
        
        // Add title on the left
        header.createEl('h2', { 
            text: 'Citations in Document',
            cls: 'cite-wide-title'
        });
        
        // Count numeric and hex citations
        const numericCitationCount = this.citationGroups.filter(group => !group.number.startsWith('hex_')).length;
        const hexCitationCount = this.citationGroups.filter(group => group.number.startsWith('hex_')).length;
        
        // Create button container for multiple buttons
        const buttonContainer = header.createDiv('cite-wide-header-buttons');
        
        // Add convert all button (only if there are numeric citations)
        if (numericCitationCount > 0) {
            const convertAllBtn = buttonContainer.createEl('button', {
                text: `Convert All (${numericCitationCount})`,
                cls: 'mod-cta cite-wide-convert-all-btn'
            });
            convertAllBtn.addEventListener('click', () => this.convertAllCitations());
        }
        
        // Add save all hex citations button (only if there are hex citations)
        if (hexCitationCount > 0) {
            const saveAllHexBtn = buttonContainer.createEl('button', {
                text: `Save All Hex (${hexCitationCount})`,
                cls: 'mod-cta cite-wide-save-all-hex-btn'
            });
            saveAllHexBtn.addEventListener('click', () => this.saveAllHexCitations());
        }

        // Add each citation group
        for (const group of this.citationGroups) {
            this.renderCitationGroup(container, group);
        }
    }

    private renderCitationGroup(container: HTMLElement, group: CitationGroup) {
        const groupEl = container.createDiv('cite-wide-group');
        const header = groupEl.createDiv('cite-wide-group-header');
        
        // Create a collapsible header
        const headerContent = header.createDiv('cite-wide-group-header-content');

        if (group.url) {
            headerContent.createEl('a', {
                href: group.url,
                text: 'Source',
                cls: 'cite-wide-source-link',
                attr: { target: '_blank' }
            });
        }

        // Add convert button only for numeric citations (not hex citations)
        if (!group.number.startsWith('hex_')) {
            const convertBtn = header.createEl('button', {
                text: 'Convert to Hex',
                cls: 'mod-cta cite-wide-convert-btn'
            });

            convertBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.convertCitationGroup(group);
            });
        } else {
            // Add save button for hex citations
            const saveBtn = header.createEl('button', {
                text: 'Save to Citations',
                cls: 'mod-cta cite-wide-save-btn'
            });

            saveBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const result = await this.saveHexCitationToFile(group);
                if (result === 'saved') {
                    new Notice(`Citation saved to Citations folder: ${group.number.replace('hex_', '')}.md`);
                } else if (result === 'updated') {
                    new Notice(`Citation ${group.number.replace('hex_', '')} already exists and usage updated`);
                } else if (result === 'error') {
                    new Notice('Failed to save citation file');
                }
            });
        }

        // Create collapsible content
        const content = groupEl.createDiv('cite-wide-group-content');
        content.style.display = 'none'; // Start collapsed

        // Toggle content on header click
        header.addEventListener('click', () => {
            content.style.display = content.style.display === 'none' ? 'block' : 'none';
        });

        // Add each citation instance
        group.matches.forEach((match: CitationMatch, matchIndex: number) => {
            const isRefSource = match.isReferenceSource === true;
            const instanceEl = content.createDiv(`cite-wide-instance ${isRefSource ? 'cite-wide-reference-source' : ''}`);
            
            // Show line number and preview
            const lineInfo = instanceEl.createDiv('cite-wide-line-info');
            
            // Add a special badge for reference sources
            if (isRefSource) {
                lineInfo.createEl('span', {
                    text: 'Reference',
                    cls: 'cite-wide-badge cite-wide-badge-reference'
                });
                lineInfo.createEl('span', { text: ' • ' });
            }
            
            lineInfo.createEl('span', { 
                text: `Line ${match.lineNumber}: `,
                cls: 'cite-wide-line-number'
            });

            // Create a preview of the line content
            const preview = match.lineContent.trim();
            const previewText = preview.length > 100 
                ? `${preview.substring(0, 100)}...` 
                : preview;
                
            lineInfo.createEl('span', {
                text: previewText,
                cls: 'cite-wide-line-preview'
            });

            // Add view and convert buttons
            const btnContainer = instanceEl.createDiv('cite-wide-instance-actions');
            
            // Only add view/convert buttons for non-reference entries
            if (!isRefSource) {
                const viewBtn = btnContainer.createEl('button', {
                    text: 'View',
                    cls: 'mod-cta-outline cite-wide-view-btn'
                });

                viewBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.scrollToLine(match.lineNumber);
                });
            }

            // Only add convert button for non-reference entries and numeric citations (not hex citations)
            if (!isRefSource && !group.number.startsWith('hex_')) {
                const convertBtn = btnContainer.createEl('button', {
                    text: 'Convert',
                    cls: 'mod-cta cite-wide-convert-btn'
                });

                convertBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await this.convertCitationInstance(group, matchIndex);
                });
            }
        });
    }

    private async convertCitationGroup(group: CitationGroup) {
        try {
            const result = citationService.convertCitation(
                this.content,
                group.number
            );

            if (result.changed) {
                await this.saveChanges(result.content);
                new Notice(`Converted citation [${group.number}] to hex format`);
                this.close();
            } else {
                new Notice('No changes were made to the document');
            }
        } catch (error) {
            console.error('Error converting citation:', error);
            new Notice('Error converting citation. See console for details.');
        }
    }

    private async convertCitationInstance(group: CitationGroup, _matchIndex: number) {
        try {
            // Use the same approach as convertCitationGroup to ensure footnote conversion
            const result = citationService.convertCitation(
                this.content,
                group.number
            );

            if (result.changed) {
                await this.saveChanges(result.content);
                
                // Update the content for future operations
                this.content = result.content;
                
                // Display the original citation format in the notice
                const displayNumber = group.number.startsWith('hex_') 
                    ? `^${group.number.replace('hex_', '')}` 
                    : group.number;
                    
                new Notice(`Converted citation [${displayNumber}] to hex format`);
                this.close();
            } else {
                new Notice('No changes were made to the document');
            }
        } catch (error) {
            console.error('Error converting citation instance:', error);
            new Notice('Error converting citation. See console for details.');
        }
    }

    private async convertAllCitations() {
        try {
            let updatedContent = this.content;
            let totalConverted = 0;

            // Process each group, but only numeric citations (not hex citations)
            for (const group of this.citationGroups) {
                // Skip hex citations that are already converted
                if (group.number.startsWith('hex_')) {
                    continue;
                }
                
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
                await this.saveChanges(updatedContent);
                new Notice(`Converted ${totalConverted} citations to hex format`);
                this.close();
            } else {
                new Notice('No citations were converted');
            }
        } catch (error) {
            console.error('Error converting citations:', error);
            new Notice('Error converting citations. See console for details.');
        }
    }

    private async saveAllHexCitations() {
        try {
            // Get the current file path for tracking
            const activeFile = this.app.workspace.getActiveFile();
            const sourceFile = activeFile ? activeFile.path : '';

            // Use the shared service method
            const result = await citationFileService.saveAllHexCitationsFromContent(this.content, sourceFile);

            if (result.saved > 0 || result.updated > 0) {
                let message = '';
                if (result.saved > 0) {
                    message += `Saved ${result.saved} new citation(s)`;
                }
                if (result.updated > 0) {
                    if (message) message += ', ';
                    message += `Updated ${result.updated} existing citation(s)`;
                }
                new Notice(message);
            } else {
                new Notice('No hex citations were saved');
            }
        } catch (error) {
            console.error('Error saving hex citations:', error);
            new Notice('Error saving hex citations. See console for details.');
        }
    }

    private async saveChanges(newContent: string) {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            throw new Error('No active file');
        }

        await this.app.vault.modify(activeFile, newContent);
    }

    private scrollToLine(lineNumber: number) {
        try {
            // Get the line content
            const lineContent = this.editor.getLine(lineNumber);
            
            // Find the citation pattern in the line (matches [1], [2], etc.)
            const citationMatch = lineContent.match(/\[(\d+)\]/);
            
            if (citationMatch) {
                const citationText = citationMatch[0];
                const startPos = citationMatch.index || 0;
                const endPos = startPos + citationText.length;
                
                // Create positions for the citation
                const from = { line: lineNumber, ch: startPos };
                const to = { line: lineNumber, ch: endPos };
                
                // Set cursor to the start of the citation and select it
                this.editor.setCursor(from);
                this.editor.setSelection(from, to);
                
                // Scroll to make the citation visible with some context
                const fromLine = Math.max(0, lineNumber - 2);
                const toLine = lineNumber + 2;
                
                // Create a range for the context area
                const contextRange = {
                    from: { line: fromLine, ch: 0 },
                    to: { line: toLine, ch: 0 }
                };
                
                // Scroll to show the context area
                this.editor.scrollIntoView(contextRange, true);
                
                // Then scroll to show the selection
                this.editor.scrollIntoView({ from, to }, true);
                
                // Focus the editor to show the selection
                this.editor.focus();
                
            } else {
                // Fallback to just scrolling to the line if no citation pattern is found
                const pos = { line: lineNumber, ch: 0 };
                this.editor.setCursor(pos);
                
                // Create a range for the context area
                const contextRange = {
                    from: { line: Math.max(0, lineNumber - 2), ch: 0 },
                    to: { line: lineNumber + 2, ch: 0 }
                };
                
                this.editor.scrollIntoView(contextRange, true);
                this.editor.focus();
            }
            
            // Close the modal after a short delay to ensure the selection is visible
            setTimeout(() => {
                this.close();
            }, 100);
            
        } catch (error) {
            console.error('Error scrolling to line:', error);
            this.close();
        }
    }

    private async saveHexCitationToFile(group: CitationGroup): Promise<'saved' | 'updated' | 'error' | null> {
        try {
            // Extract the hex ID from the group number
            const hexId = group.number.replace('hex_', '');
            
            // Check if citation file already exists
            const filename = `${hexId}.md`;
            const filepath = `${citationFileService.getCitationsFolder()}/${filename}`;
            const existingFile = this.app.vault.getAbstractFileByPath(filepath);
            
            if (existingFile instanceof TFile) {
                // File already exists - just update usage
                const activeFile = this.app.workspace.getActiveFile();
                const sourceFile = activeFile ? activeFile.path : '';
                await citationFileService.updateCitationUsage(existingFile, sourceFile);
                return 'updated';
            }
            
            // Find the reference source (the actual citation text)
            const referenceMatch = group.matches.find(match => match.isReferenceSource);
            
            if (!referenceMatch) {
                return 'error';
            }
            
            // Extract the reference text (everything after the [^hexId]: part)
            const referenceText = referenceMatch.lineContent.replace(/^\s*\[\^[a-z0-9]+\]:\s*/, '').trim();
            
            // Extract URL from the reference text if it exists
            let url: string | undefined;
            const urlMatch = referenceText.match(/https?:\/\/[^\s\)]+/);
            if (urlMatch) {
                url = urlMatch[0];
            }
            
            // Get the current file path for tracking
            const activeFile = this.app.workspace.getActiveFile();
            const sourceFile = activeFile ? activeFile.path : '';
            
            // Create the citation file
            const result = await citationFileService.createCitationFile(
                hexId,
                referenceText,
                url,
                sourceFile
            );
            
            if (result) {
                return 'saved';
            } else {
                return 'error';
            }
            
        } catch (error) {
            console.error('Error saving hex citation to file:', error);
            return 'error';
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}