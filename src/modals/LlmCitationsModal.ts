import { App, Modal, Notice, Editor } from 'obsidian';
import {
    llmCitationParserService,
    type ParseResult,
    type CitationToken,
    type ParseFlag,
} from '../services/llmCitationParserService';

interface RowData {
    /** The numeric ID (e.g. "12") that's being proposed for conversion. */
    number: string;
    /** Pre-computed hex code that will replace this numeric on Apply. */
    proposedHex: string;
    /** The reference-definition token for this numeric. */
    refDef: CitationToken;
    /** All inline tokens that include this numeric (single, multi-comma, adjacent). */
    inlineOccurrences: CitationToken[];
}

export class LlmCitationsModal extends Modal {
    private editor: Editor;
    private content: string;
    private parseResult: ParseResult;
    private mapping: Map<string, string>;
    private rows: RowData[] = [];
    /** Per-numeric-ID toggle state. Default true. */
    private selected: Map<string, boolean> = new Map();

    constructor(app: App, editor: Editor) {
        super(app);
        this.editor = editor;
        this.content = editor.getValue();
        this.parseResult = llmCitationParserService.parse(this.content);
        this.mapping = llmCitationParserService.proposeHexMapping(this.parseResult);
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

        this.rows = this.buildRows();
        // Initialize selection state on first render only — re-renders preserve.
        for (const row of this.rows) {
            if (!this.selected.has(row.number)) this.selected.set(row.number, true);
        }

        this.renderInner(contentEl);
    }

    private renderInner(contentEl: HTMLElement): void {
        // Wipe whatever's there from a prior render and rebuild.
        contentEl.empty();
        contentEl.addClass('cite-wide-modal');

        const totalNumeric = this.parseResult.numericRefs.size;
        const totalInlineNumeric = this.parseResult.inlineNumeric.length;

        if (this.rows.length === 0) {
            const note = totalNumeric === 0 && totalInlineNumeric === 0
                ? 'No numeric citations found in this file.'
                : 'No transformable citations found (everything is already-Lossless, orphan, or in a collision).';
            contentEl.createEl('p', { text: note });
            this.renderFlagsSection(contentEl);
            return;
        }

        const container = contentEl.createDiv('cite-wide-container');
        const header = container.createDiv('cite-wide-header');

        const selectedCount = [...this.selected.values()].filter(Boolean).length;
        header.createEl('h2', {
            text: `Parse LLM Citations (${selectedCount} of ${this.rows.length} selected)`,
            cls: 'cite-wide-title',
        });

        const buttonContainer = header.createDiv('cite-wide-header-buttons');

        const selectAllBtn = buttonContainer.createEl('button', {
            text: 'Select All',
            cls: 'mod-cta cite-wide-convert-all-btn',
        });
        selectAllBtn.addEventListener('click', () => this.setAllAndRerender(contentEl, true));

        const unselectAllBtn = buttonContainer.createEl('button', {
            text: 'Unselect All',
            cls: 'cite-wide-convert-all-btn',
        });
        unselectAllBtn.addEventListener('click', () => this.setAllAndRerender(contentEl, false));

        const applyBtn = buttonContainer.createEl('button', {
            text: 'Apply',
            cls: 'mod-cta cite-wide-save-all-hex-btn',
        });
        applyBtn.addEventListener('click', () => {
            void this.applySelected();
        });

        for (const row of this.rows) {
            this.renderRow(container, row);
        }

        this.renderFlagsSection(container);
    }

    private buildRows(): RowData[] {
        const rows: RowData[] = [];
        const sorted = [...this.mapping.keys()].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
        for (const num of sorted) {
            const refDef = this.parseResult.numericRefs.get(num);
            const proposedHex = this.mapping.get(num);
            if (!refDef || !proposedHex) continue;
            const inlineOccurrences = this.parseResult.inlineNumeric.filter(t => t.numbers.includes(num));
            rows.push({ number: num, proposedHex, refDef, inlineOccurrences });
        }
        return rows;
    }

    private renderRow(container: HTMLElement, row: RowData): void {
        const groupEl = container.createDiv('cite-wide-group');
        const headerEl = groupEl.createDiv('cite-wide-group-header');
        const headerContent = headerEl.createDiv('cite-wide-group-header-content');

        const checkbox = headerContent.createEl('input', { type: 'checkbox' });
        checkbox.checked = this.selected.get(row.number) === true;
        checkbox.style.marginRight = '0.5rem';
        checkbox.addEventListener('change', () => {
            this.selected.set(row.number, checkbox.checked);
        });
        checkbox.addEventListener('click', e => e.stopPropagation());

        headerContent.createEl('h3', {
            text: `[${row.number}] → [^${row.proposedHex}]`,
            cls: 'cite-wide-group-title',
        });

        const inlineCount = row.inlineOccurrences.length;
        headerContent.createEl('span', {
            text: inlineCount === 0
                ? '(orphan ref — no inline citation)'
                : `${inlineCount} inline occurrence${inlineCount === 1 ? '' : 's'}`,
            cls: 'cite-wide-source-link',
        });

        const content = groupEl.createDiv('cite-wide-group-content');
        content.style.display = 'block';

        // Reference definition row
        const refRow = content.createDiv('cite-wide-instance cite-wide-reference-source');
        const refInfo = refRow.createDiv('cite-wide-line-info');
        refInfo.createEl('span', { text: 'Reference', cls: 'cite-wide-badge cite-wide-badge-reference' });
        refInfo.createEl('span', { text: ' • ' });
        const refLink = refInfo.createEl('a', {
            text: `Line ${row.refDef.line}`,
            cls: 'cite-wide-line-number',
            href: '#',
        });
        refLink.addEventListener('click', e => {
            e.preventDefault();
            this.scrollToLine(row.refDef.line);
        });
        refInfo.createEl('span', { text: ': ' });
        const refBody = (row.refDef.refDefBody ?? '').trim();
        const refPreview = refBody.length > 140 ? `${refBody.substring(0, 140)}…` : refBody;
        refInfo.createEl('span', { text: refPreview, cls: 'cite-wide-line-preview' });

        // Inline occurrence rows
        for (const occ of row.inlineOccurrences) {
            const occRow = content.createDiv('cite-wide-instance');
            const occInfo = occRow.createDiv('cite-wide-line-info');
            const kindLabel =
                occ.kind === 'inline-numeric-multi-comma' ? 'multi'
                : occ.kind === 'inline-numeric-multi-adjacent' ? 'adjacent'
                : 'single';
            occInfo.createEl('span', {
                text: `${kindLabel}: ${occ.raw}`,
                cls: 'cite-wide-badge',
            });
            occInfo.createEl('span', { text: ' • ' });
            const occLink = occInfo.createEl('a', {
                text: `Line ${occ.line}`,
                cls: 'cite-wide-line-number',
                href: '#',
            });
            occLink.addEventListener('click', e => {
                e.preventDefault();
                this.scrollToLine(occ.line);
            });
            occInfo.createEl('span', { text: ': ' });
            const lineContent = this.editor.getLine(occ.line - 1).trim();
            const linePreview = lineContent.length > 140 ? `${lineContent.substring(0, 140)}…` : lineContent;
            occInfo.createEl('span', { text: linePreview, cls: 'cite-wide-line-preview' });
        }
    }

    private renderFlagsSection(container: HTMLElement): void {
        const flags = this.parseResult.flags;
        if (flags.length === 0) return;

        const flagsEl = container.createDiv('cite-wide-group');
        const headerEl = flagsEl.createDiv('cite-wide-group-header');
        const headerContent = headerEl.createDiv('cite-wide-group-header-content');
        headerContent.createEl('h3', {
            text: `Flags (${flags.length})`,
            cls: 'cite-wide-group-title',
        });
        headerContent.createEl('span', {
            text: 'orphans + collisions — context only, not actionable here',
            cls: 'cite-wide-source-link',
        });

        const content = flagsEl.createDiv('cite-wide-group-content');
        content.style.display = 'block';

        const byCode = new Map<string, ParseFlag[]>();
        for (const f of flags) {
            const arr = byCode.get(f.code) ?? [];
            arr.push(f);
            byCode.set(f.code, arr);
        }

        for (const [code, list] of byCode) {
            const codeRow = content.createDiv('cite-wide-instance');
            const info = codeRow.createDiv('cite-wide-line-info');
            const sev = list[0]?.severity ?? 'info';
            info.createEl('span', { text: sev, cls: 'cite-wide-badge' });
            info.createEl('span', { text: ' • ' });
            info.createEl('span', {
                text: `${code} (${list.length})`,
                cls: 'cite-wide-line-preview',
            });

            // Show up to 5 example messages, with line links where available.
            for (const f of list.slice(0, 5)) {
                const exRow = content.createDiv('cite-wide-instance');
                const exInfo = exRow.createDiv('cite-wide-line-info');
                if (f.line !== undefined) {
                    const link = exInfo.createEl('a', {
                        text: `Line ${f.line}`,
                        cls: 'cite-wide-line-number',
                        href: '#',
                    });
                    const targetLine = f.line;
                    link.addEventListener('click', e => {
                        e.preventDefault();
                        this.scrollToLine(targetLine);
                    });
                    exInfo.createEl('span', { text: ': ' });
                }
                exInfo.createEl('span', { text: f.message, cls: 'cite-wide-line-preview' });
            }
            if (list.length > 5) {
                const moreRow = content.createDiv('cite-wide-instance');
                moreRow.createDiv('cite-wide-line-info').createEl('span', {
                    text: `…and ${list.length - 5} more`,
                    cls: 'cite-wide-line-preview',
                });
            }
        }
    }

    private setAllAndRerender(contentEl: HTMLElement, value: boolean): void {
        for (const row of this.rows) {
            this.selected.set(row.number, value);
        }
        this.renderInner(contentEl);
    }

    private async applySelected(): Promise<void> {
        const selectedNumbers = new Set<string>();
        for (const [num, checked] of this.selected) {
            if (checked) selectedNumbers.add(num);
        }
        if (selectedNumbers.size === 0) {
            new Notice('No citations selected to convert.');
            return;
        }

        const result = llmCitationParserService.transform(this.content, this.parseResult, {
            selectedNumbers,
            mapping: this.mapping,
        });

        const file = this.app.workspace.getActiveFile();
        if (!file) {
            new Notice('No active file to write to.');
            return;
        }

        await this.app.vault.modify(file, result.content);
        const warnings = result.flags.filter(f => f.severity === 'warning').length;
        new Notice(
            `Converted ${result.stats.numericCitationsConverted} inline + ${result.stats.refDefsConverted} ref def(s).` +
            (warnings > 0 ? ` ${warnings} warning(s) — see console.` : '')
        );
        if (result.flags.length > 0) console.log('Cite Wide LLM citation flags:', result.flags);
        this.close();
    }

    private scrollToLine(lineNumber: number): void {
        try {
            const line0 = Math.max(0, lineNumber - 1);
            const pos = { line: line0, ch: 0 };
            this.editor.setCursor(pos);
            this.editor.scrollIntoView({
                from: { line: Math.max(0, line0 - 2), ch: 0 },
                to: { line: line0 + 2, ch: 0 },
            }, true);
            this.editor.focus();
            setTimeout(() => this.close(), 100);
        } catch (error) {
            console.error('Error scrolling to line:', error);
            this.close();
        }
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
