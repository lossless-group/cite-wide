import { App, Modal, Notice, Editor } from 'obsidian';
import {
    dedupeByUrlService,
    type DuplicateGroup,
    type DuplicateOccurrence,
} from '../services/dedupeByUrlService';

export class DedupeByUrlModal extends Modal {
    private editor: Editor;
    private content: string;
    private groups: DuplicateGroup[] = [];
    private selected: Map<number, boolean> = new Map();

    constructor(app: App, editor: Editor) {
        super(app);
        this.editor = editor;
        this.content = editor.getValue();
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        const modalContainer = contentEl.closest('.modal-container');
        const modalContent = contentEl.closest('.modal-content');
        if (modalContainer instanceof HTMLElement && modalContent instanceof HTMLElement) {
            modalContainer.style.width = '95vw';
            modalContainer.style.maxWidth = 'none';
            modalContent.style.width = '100%';
            modalContent.style.maxWidth = 'none';
        }
        contentEl.addClass('cite-wide-modal');

        this.groups = dedupeByUrlService.findDuplicateUrlGroups(this.content);

        if (this.groups.length === 0) {
            contentEl.createEl('p', {
                text: 'No duplicate citations by URL were found in the current document.',
            });
            return;
        }

        const container = contentEl.createDiv('cite-wide-container');

        const header = container.createDiv('cite-wide-header');
        header.createEl('h2', {
            text: `Duplicate Citations by URL (${this.groups.length} group${this.groups.length === 1 ? '' : 's'})`,
            cls: 'cite-wide-title',
        });

        const applyBtn = header.createEl('button', {
            text: 'Apply Dedup',
            cls: 'mod-cta cite-wide-convert-all-btn',
        });
        applyBtn.addEventListener('click', () => {
            void this.applySelected();
        });

        this.groups.forEach((group, idx) => {
            this.selected.set(idx, true);
            this.renderGroup(container, group, idx);
        });
    }

    private renderGroup(container: HTMLElement, group: DuplicateGroup, idx: number): void {
        const groupEl = container.createDiv('cite-wide-group');
        const headerEl = groupEl.createDiv('cite-wide-group-header');
        const headerContent = headerEl.createDiv('cite-wide-group-header-content');

        const checkbox = headerContent.createEl('input', { type: 'checkbox' });
        checkbox.checked = true;
        checkbox.style.marginRight = '0.5rem';
        checkbox.addEventListener('change', () => {
            this.selected.set(idx, checkbox.checked);
        });
        checkbox.addEventListener('click', e => e.stopPropagation());

        headerContent.createEl('h3', {
            text: group.url,
            cls: 'cite-wide-group-title',
        });

        const removedList = group.duplicateHexIds.map(h => `[^${h}]`).join(', ');
        headerContent.createEl('span', {
            text: `Keep [^${group.canonicalHexId}], remove ${removedList}`,
            cls: 'cite-wide-source-link',
        });

        const content = groupEl.createDiv('cite-wide-group-content');
        content.style.display = 'block';

        for (const occ of group.occurrences) {
            this.renderOccurrence(content, occ, group);
        }
    }

    private renderOccurrence(content: HTMLElement, occ: DuplicateOccurrence, group: DuplicateGroup): void {
        const isCanonical = occ.hexId === group.canonicalHexId;
        const instanceEl = content.createDiv(
            `cite-wide-instance ${occ.isReference ? 'cite-wide-reference-source' : ''}`
        );

        const lineInfo = instanceEl.createDiv('cite-wide-line-info');

        if (occ.isReference) {
            lineInfo.createEl('span', {
                text: 'Reference',
                cls: 'cite-wide-badge cite-wide-badge-reference',
            });
            lineInfo.createEl('span', { text: ' • ' });
        }

        const hexLabel = lineInfo.createEl('span', {
            text: `[^${occ.hexId}]${isCanonical ? ' (keep)' : ''}`,
            cls: 'cite-wide-badge',
        });
        hexLabel.style.marginRight = '0.5rem';

        const lineLink = lineInfo.createEl('a', {
            text: `Line ${occ.lineNumber}`,
            cls: 'cite-wide-line-number',
            href: '#',
        });
        lineLink.addEventListener('click', e => {
            e.preventDefault();
            this.scrollToOccurrence(occ);
        });

        lineInfo.createEl('span', { text: ': ' });

        const preview = occ.lineContent.trim();
        const previewText = preview.length > 120 ? `${preview.substring(0, 120)}…` : preview;
        lineInfo.createEl('span', {
            text: previewText,
            cls: 'cite-wide-line-preview',
        });
    }

    private async applySelected(): Promise<void> {
        const groupsToDedupe = this.groups.filter((_, i) => this.selected.get(i) === true);
        if (groupsToDedupe.length === 0) {
            new Notice('No groups selected to dedupe.');
            return;
        }

        const { content, stats } = dedupeByUrlService.applyDedup(this.content, groupsToDedupe);
        const file = this.app.workspace.getActiveFile();
        if (!file) {
            new Notice('No active file to write back to.');
            return;
        }

        await this.app.vault.modify(file, content);
        new Notice(
            `Deduped ${stats.groupsDeduped} group(s); replaced ${stats.inlineReplacements} inline citation(s); removed ${stats.referenceLinesRemoved} reference line(s).`
        );
        this.close();
    }

    private scrollToOccurrence(occ: DuplicateOccurrence): void {
        try {
            const line0 = Math.max(0, occ.lineNumber - 1);
            const lineContent = this.editor.getLine(line0);
            const target = `[^${occ.hexId}]`;
            const found = lineContent.indexOf(target, Math.max(0, occ.indexInLine - 1));
            const startCh = found >= 0 ? found : 0;
            const endCh = found >= 0 ? found + target.length : 0;

            const from = { line: line0, ch: startCh };
            const to = { line: line0, ch: endCh };

            this.editor.setCursor(from);
            if (found >= 0) this.editor.setSelection(from, to);
            this.editor.scrollIntoView({ from, to }, true);
            this.editor.focus();

            setTimeout(() => this.close(), 100);
        } catch (error) {
            console.error('Error scrolling to occurrence:', error);
            this.close();
        }
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
