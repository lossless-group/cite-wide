// cite-wide/src/modals/CitationModal.ts
import { App, Modal, Notice, Editor } from 'obsidian';
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
        const { contentEl, modalEl } = this;
        contentEl.empty();

        // Attach styling class to the OUTER modal element so width rules
        // actually take effect (see context-v reminder
        // "Widen-Modals-in-Obsidian-using-CSS").
        modalEl.addClass('cite-wide-modal');

        // Extract all citation groups
        this.citationGroups = citationService.extractCitations(this.content);

        if (this.citationGroups.length === 0) {
            const empty = contentEl.createDiv('cite-wide-empty');
            empty.createEl('h2', { text: 'Citations in Document', cls: 'cite-wide-title' });
            empty.createEl('p', {
                text: 'No citations found in the current document.',
                cls: 'cite-wide-empty-message',
            });
            return;
        }

        const numericCount = this.citationGroups.filter((g) => !g.number.startsWith('hex_')).length;
        const hexCount = this.citationGroups.filter((g) => g.number.startsWith('hex_')).length;
        const totalInstances = this.citationGroups.reduce((sum, g) => sum + g.matches.length, 0);

        // Header: title, meta, primary actions
        const header = contentEl.createDiv('cite-wide-header');

        const titleBlock = header.createDiv('cite-wide-title-block');
        titleBlock.createEl('h2', { text: 'Citations in Document', cls: 'cite-wide-title' });
        const meta = titleBlock.createDiv('cite-wide-meta');
        meta.createEl('span', {
            text: `${this.citationGroups.length} ${this.citationGroups.length === 1 ? 'citation' : 'citations'}`,
            cls: 'cite-wide-meta-pill',
        });
        meta.createEl('span', {
            text: `${totalInstances} ${totalInstances === 1 ? 'instance' : 'instances'}`,
            cls: 'cite-wide-meta-pill',
        });
        if (numericCount > 0) {
            meta.createEl('span', {
                text: `${numericCount} numeric`,
                cls: 'cite-wide-meta-pill cite-wide-meta-numeric',
            });
        }
        if (hexCount > 0) {
            meta.createEl('span', {
                text: `${hexCount} hex`,
                cls: 'cite-wide-meta-pill cite-wide-meta-hex',
            });
        }

        const actions = header.createDiv('cite-wide-header-actions');
        if (numericCount > 0) {
            const convertAllBtn = actions.createEl('button', {
                text: `Convert All Numeric (${numericCount})`,
                cls: 'mod-cta cite-wide-convert-all-btn',
            });
            convertAllBtn.addEventListener('click', () => {
                void this.convertAllCitations();
            });
        }
        if (hexCount > 0) {
            const saveAllHexBtn = actions.createEl('button', {
                text: `Save All Hex (${hexCount})`,
                cls: 'mod-cta cite-wide-save-all-hex-btn',
            });
            saveAllHexBtn.addEventListener('click', () => {
                void this.saveAllHexCitations();
            });
        }

        // Body: responsive grid of citation cards
        const grid = contentEl.createDiv('cite-wide-grid');
        for (const group of this.citationGroups) {
            this.renderCitationGroup(grid, group);
        }

        // Footer
        const footer = contentEl.createDiv('cite-wide-footer');
        const closeBtn = footer.createEl('button', {
            text: 'Close',
            cls: 'cite-wide-close-btn',
        });
        closeBtn.addEventListener('click', () => this.close());
    }

    private async saveAllHexCitations(): Promise<void> {
        try {
            const activeFile = this.app.workspace.getActiveFile();
            const sourceFile = activeFile ? activeFile.path : '';
            const result = await citationFileService.saveAllHexCitationsFromContent(this.content, sourceFile);

            if (result.saved === 0 && result.updated === 0 && result.errors === 0) {
                new Notice('No hex citations found in this document.');
                return;
            }
            const parts: string[] = [];
            if (result.saved > 0) parts.push(`saved ${result.saved}`);
            if (result.updated > 0) parts.push(`updated ${result.updated}`);
            if (result.errors > 0) parts.push(`${result.errors} error${result.errors === 1 ? '' : 's'}`);
            new Notice(`Citations: ${parts.join(', ')}.`);
            this.close();
        } catch (error) {
            console.error('Error saving hex citations:', error);
            new Notice('Error saving hex citations. See console for details.');
        }
    }

    private async saveSingleHexCitation(group: CitationGroup): Promise<void> {
        try {
            const activeFile = this.app.workspace.getActiveFile();
            const sourceFile = activeFile ? activeFile.path : '';
            const outcome = await citationFileService.saveHexCitationGroup(group, sourceFile);
            const hexId = group.number.replace('hex_', '');
            if (outcome === 'saved') new Notice(`Citation saved: ${hexId}.md`);
            else if (outcome === 'updated') new Notice(`Citation already existed; usage updated: ${hexId}`);
            else new Notice('Failed to save citation.');
        } catch (error) {
            console.error('Error saving citation:', error);
            new Notice('Error saving citation. See console for details.');
        }
    }

    private renderCitationGroup(container: HTMLElement, group: CitationGroup) {
        const isHex = group.number.startsWith('hex_');
        const displayNumber = isHex ? `^${group.number.replace('hex_', '')}` : group.number;
        const inlineMatches = group.matches.filter((m) => m.isReferenceSource !== true);
        const referenceMatch = group.matches.find((m) => m.isReferenceSource === true);

        const card = container.createDiv(`cite-wide-card ${isHex ? 'cite-wide-card-hex' : 'cite-wide-card-numeric'}`);

        // Card header: number badge + counts + format kind
        const cardHeader = card.createDiv('cite-wide-card-header');
        const numberBadge = cardHeader.createDiv('cite-wide-number-badge');
        numberBadge.createEl('span', { text: `[${displayNumber}]` });

        const cardMeta = cardHeader.createDiv('cite-wide-card-meta');
        cardMeta.createEl('span', {
            text: `${inlineMatches.length} inline`,
            cls: 'cite-wide-meta-chip',
        });
        cardMeta.createEl('span', {
            text: isHex ? 'hex' : 'numeric',
            cls: `cite-wide-format-chip ${isHex ? 'is-hex' : 'is-numeric'}`,
        });

        // Reference preview (if we know the reference line / URL)
        const referenceText = group.referenceText?.trim() ?? referenceMatch?.lineContent.trim() ?? '';
        if (referenceText || group.url) {
            const refBlock = card.createDiv('cite-wide-card-reference');
            if (referenceText) {
                refBlock.createEl('div', {
                    text: this.truncate(referenceText, 220),
                    cls: 'cite-wide-card-reference-text',
                });
            }
            if (group.url) {
                refBlock.createEl('a', {
                    href: group.url,
                    text: this.shortenUrl(group.url),
                    cls: 'cite-wide-card-source-link',
                    attr: { target: '_blank', rel: 'noopener noreferrer' },
                });
            }
        }

        // Line-number chips: clicking jumps to the line
        if (inlineMatches.length > 0) {
            const chipsLabel = card.createDiv('cite-wide-chips-label');
            chipsLabel.setText('Appears on lines');
            const chips = card.createDiv('cite-wide-chips');
            inlineMatches.forEach((match: CitationMatch) => {
                const chip = chips.createEl('button', {
                    text: `L${match.lineNumber}`,
                    cls: 'cite-wide-chip',
                    attr: { title: this.truncate(match.lineContent.trim(), 140) },
                });
                chip.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.scrollToLine(match.lineNumber);
                });
            });
        }

        // Card actions
        const cardActions = card.createDiv('cite-wide-card-actions');
        if (isHex) {
            const saveBtn = cardActions.createEl('button', {
                text: 'Save to Citations',
                cls: 'mod-cta cite-wide-card-primary-btn',
            });
            saveBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.saveSingleHexCitation(group);
            });
        } else {
            const convertBtn = cardActions.createEl('button', {
                text: 'Convert to Hex',
                cls: 'mod-cta cite-wide-card-primary-btn',
            });
            convertBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.convertCitationGroup(group);
            });
        }
        if (inlineMatches.length > 0 && inlineMatches[0]) {
            const firstMatch = inlineMatches[0];
            const jumpBtn = cardActions.createEl('button', {
                text: 'Jump to first',
                cls: 'cite-wide-card-secondary-btn',
            });
            jumpBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.scrollToLine(firstMatch.lineNumber);
            });
        }
    }

    private truncate(text: string, max: number): string {
        if (text.length <= max) return text;
        return `${text.substring(0, max - 1).trimEnd()}…`;
    }

    private shortenUrl(url: string): string {
        try {
            const u = new URL(url);
            const path = u.pathname.length > 30 ? `${u.pathname.substring(0, 29)}…` : u.pathname;
            return `${u.hostname}${path}`;
        } catch {
            return this.truncate(url, 60);
        }
    }

    private async convertCitationGroup(group: CitationGroup) {
        try {
            const result = citationService.convertCitation(this.content, group.number);

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

    private async convertAllCitations() {
        try {
            let updatedContent = this.content;
            let totalConverted = 0;

            for (const group of this.citationGroups) {
                const result = citationService.convertCitation(updatedContent, group.number);

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
            const lineContent = this.editor.getLine(lineNumber);
            const citationMatch = lineContent.match(/\[(\d+)\]/);

            if (citationMatch) {
                const citationText = citationMatch[0];
                const startPos = citationMatch.index || 0;
                const endPos = startPos + citationText.length;

                const from = { line: lineNumber, ch: startPos };
                const to = { line: lineNumber, ch: endPos };

                this.editor.setCursor(from);
                this.editor.setSelection(from, to);

                const fromLine = Math.max(0, lineNumber - 2);
                const toLine = lineNumber + 2;

                const contextRange = {
                    from: { line: fromLine, ch: 0 },
                    to: { line: toLine, ch: 0 },
                };

                this.editor.scrollIntoView(contextRange, true);
                this.editor.scrollIntoView({ from, to }, true);
                this.editor.focus();
            } else {
                const pos = { line: lineNumber, ch: 0 };
                this.editor.setCursor(pos);

                const contextRange = {
                    from: { line: Math.max(0, lineNumber - 2), ch: 0 },
                    to: { line: lineNumber + 2, ch: 0 },
                };

                this.editor.scrollIntoView(contextRange, true);
                this.editor.focus();
            }

            setTimeout(() => {
                this.close();
            }, 100);
        } catch (error) {
            console.error('Error scrolling to line:', error);
            this.close();
        }
    }

    onClose() {
        const { contentEl, modalEl } = this;
        modalEl.removeClass('cite-wide-modal');
        contentEl.empty();
    }
}
