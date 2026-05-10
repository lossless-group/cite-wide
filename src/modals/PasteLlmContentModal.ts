import { App, Modal, Notice, Editor } from 'obsidian';
import { llmCitationParserService } from '../services/llmCitationParserService';

type Provider = 'google-ai' | 'perplexity';

/**
 * Paste-time citation conversion: rather than dropping raw LLM output into
 * a doc and then running the post-hoc parser, this modal lets the user
 * paste into a buffer, choose the source LLM provider, and insert the
 * converted form at the cursor in one step. Eliminates the manual two-step
 * dance and prevents the colliding-numerics problem at its source.
 *
 * The active document's hex namespace is collected and passed to the parser
 * as `additionalUsedHexes` so generated hex IDs never collide with citations
 * already in the host doc.
 */
export class PasteLlmContentModal extends Modal {
    private editor: Editor;
    private provider: Provider = 'google-ai';
    private textarea!: HTMLTextAreaElement;

    constructor(app: App, editor: Editor) {
        super(app);
        this.editor = editor;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        const modalContainer = contentEl.closest('.modal-container');
        const modalContent = contentEl.closest('.modal-content');
        if (modalContainer instanceof HTMLElement && modalContent instanceof HTMLElement) {
            modalContainer.style.width = '85vw';
            modalContainer.style.maxWidth = 'none';
            modalContent.style.width = '100%';
            modalContent.style.maxWidth = 'none';
        }
        contentEl.addClass('cite-wide-modal');

        const container = contentEl.createDiv('cite-wide-container');

        // Tight header — title only; action buttons live in the footer to
        // keep them next to the textarea.
        const header = container.createDiv('cite-wide-header');
        header.style.display = 'flex';
        header.style.flexDirection = 'row';
        header.style.alignItems = 'center';
        header.style.flexWrap = 'nowrap';
        header.style.marginBottom = '0.6rem';
        header.style.paddingBottom = '0.4rem';
        header.style.gap = '0.75rem';

        const title = header.createEl('h2', {
            text: 'Paste LLM Content (Convert Citations on Insert)',
            cls: 'cite-wide-title',
        });
        title.style.fontSize = '1.05rem';
        title.style.fontWeight = '600';
        title.style.margin = '0';
        title.style.padding = '0';
        title.style.borderBottom = 'none';
        title.style.flex = '1';
        title.style.minWidth = '0';

        // Provider selector. Carried as metadata for now — the parser already
        // auto-handles both Google AI multi-comma and Perplexity adjacent-multi
        // forms, so the selection is informational. Keeps the field for any
        // future provider-specific tweaks.
        const providerRow = container.createDiv();
        providerRow.style.marginBottom = '0.6rem';
        providerRow.style.display = 'flex';
        providerRow.style.alignItems = 'center';
        providerRow.style.gap = '1rem';
        providerRow.style.fontSize = '0.85rem';

        const providerLabel = providerRow.createEl('span', { text: 'Source:' });
        providerLabel.style.fontWeight = '500';
        providerLabel.style.opacity = '0.8';

        const providers: { value: Provider; label: string }[] = [
            { value: 'google-ai', label: 'Google AI Overviews' },
            { value: 'perplexity', label: 'Perplexity' },
        ];
        for (const { value, label } of providers) {
            const lbl = providerRow.createEl('label');
            lbl.style.display = 'inline-flex';
            lbl.style.alignItems = 'center';
            lbl.style.gap = '0.35rem';
            lbl.style.cursor = 'pointer';
            lbl.style.userSelect = 'none';
            const radio = lbl.createEl('input', { type: 'radio' });
            radio.name = 'cite-wide-provider';
            radio.value = value;
            radio.checked = this.provider === value;
            radio.addEventListener('change', () => {
                if (radio.checked) this.provider = value;
            });
            lbl.createEl('span', { text: label });
        }

        // Big textarea: where the user pastes the LLM output verbatim.
        this.textarea = contentEl.createEl('textarea');
        this.textarea.placeholder = 'Paste LLM output here. Inline citations like [1, 2, 3] (Google AI) or [1][2] (Perplexity) and reference lists like [1] [Title](url) will be converted to Lossless [^hex] format on Insert. Existing hex citations in the active document are accounted for so generated hex IDs never collide.';
        this.textarea.style.width = '100%';
        this.textarea.style.minHeight = '50vh';
        this.textarea.style.fontFamily = 'var(--font-monospace)';
        this.textarea.style.fontSize = '0.85rem';
        this.textarea.style.padding = '0.6rem';
        this.textarea.style.boxSizing = 'border-box';
        this.textarea.style.resize = 'vertical';
        this.textarea.style.border = '1px solid var(--background-modifier-border)';
        this.textarea.style.borderRadius = '4px';
        this.textarea.style.background = 'var(--background-primary)';
        this.textarea.style.color = 'var(--text-normal)';

        // Footer with action buttons.
        const footer = contentEl.createDiv();
        footer.style.display = 'flex';
        footer.style.justifyContent = 'flex-end';
        footer.style.alignItems = 'center';
        footer.style.gap = '0.5rem';
        footer.style.marginTop = '0.75rem';

        const cancelBtn = footer.createEl('button', { text: 'Cancel' });
        cancelBtn.style.padding = '0.35rem 0.8rem';
        cancelBtn.style.fontSize = '0.85rem';
        cancelBtn.addEventListener('click', () => this.close());

        const insertBtn = footer.createEl('button', {
            text: 'Parse and Insert',
            cls: 'mod-cta',
        });
        insertBtn.style.padding = '0.35rem 0.8rem';
        insertBtn.style.fontSize = '0.85rem';
        insertBtn.style.fontWeight = '500';
        insertBtn.addEventListener('click', () => {
            void this.parseAndInsert();
        });

        // Defer focus to next tick so the modal's own focus management runs first.
        setTimeout(() => this.textarea.focus(), 50);
    }

    private async parseAndInsert(): Promise<void> {
        const pasted = this.textarea.value;
        if (!pasted.trim()) {
            new Notice('Nothing to parse — textarea is empty.');
            return;
        }

        // Collect existing hex namespace from the active document so generated
        // hexes never collide with citations already in the host doc.
        const docContent = this.editor.getValue();
        const docParse = llmCitationParserService.parse(docContent);
        const existingHexes = new Set<string>([
            ...docParse.hexRefs.keys(),
            ...docParse.inlineHex
                .map(t => t.numbers[0])
                .filter((h): h is string => h !== undefined),
        ]);

        // Parse the pasted content, propose a mapping that excludes the host
        // doc's hex namespace, then transform end-to-end.
        const pasteParse = llmCitationParserService.parse(pasted);
        const mapping = llmCitationParserService.proposeHexMapping(pasteParse, existingHexes);
        const result = llmCitationParserService.transform(pasted, pasteParse, { mapping });

        // Insert at cursor / replace selection.
        this.editor.replaceSelection(result.content);

        const warnings = result.flags.filter(f => f.severity === 'warning').length;
        new Notice(
            `Inserted: ${result.stats.numericCitationsConverted} inline + ${result.stats.refDefsConverted} ref def(s).` +
            (warnings > 0 ? ` ${warnings} warning(s) — see console.` : '')
        );
        if (result.flags.length > 0) {
            console.log('Cite Wide LLM citation flags (paste):', { provider: this.provider, flags: result.flags });
        }

        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
