// cite-wide/src/modals/CitationModal.ts
import { App, Modal, Notice, Editor } from 'obsidian';
import { citationService } from '../services/citationService';
import type { CitationGroup, CitationMatch } from '../services/citationService';

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
        
        // Add convert all button on the right
        const convertAllBtn = header.createEl('button', {
            text: 'Convert All',
            cls: 'mod-cta cite-wide-convert-all-btn'
        });
        convertAllBtn.addEventListener('click', () => this.convertAllCitations());

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
        // Display the original citation format instead of the internal group number
        const displayNumber = group.number.startsWith('hex_') 
            ? `^${group.number.replace('hex_', '')}` 
            : group.number;
            
        headerContent.createEl('h3', { 
            text: `Citation [${displayNumber}] (${group.matches.length} instances)`,
            cls: 'cite-wide-group-title'
        });

        if (group.url) {
            headerContent.createEl('a', {
                href: group.url,
                text: 'Source',
                cls: 'cite-wide-source-link',
                attr: { target: '_blank' }
            });
        }

        // Add convert button
        const convertBtn = header.createEl('button', {
            text: 'Convert to Hex',
            cls: 'mod-cta cite-wide-convert-btn'
        });

        convertBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.convertCitationGroup(group);
        });

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

            // Only add convert button for non-reference entries
            if (!isRefSource) {
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

    private async convertCitationInstance(group: CitationGroup, matchIndex: number) {
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

            // Process each group
            for (const group of this.citationGroups) {
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

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}