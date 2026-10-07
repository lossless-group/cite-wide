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
        const { contentEl, modalEl } = this;
        contentEl.empty();

        // Attach styling class to the OUTER modal element so the width rules
        // in citations.css (.cite-wide-modal { width: 90vw; max-width: 1100px })
        // actually take effect. See context-v reminder
        // "Widen-Modals-in-Obsidian-using-CSS" — width rules added to contentEl
        // only resize the inner content area, not the popup itself.
        modalEl.addClass('cite-wide-modal');

        const container = contentEl.createDiv('cite-wide-container');

        // Tight header — title only; action buttons live in the footer to
        // keep them next to the textarea.
        const header = container.createDiv('cite-wide-header cite-wide-compact-header is-tight');

        header.createEl('h2', {
            text: 'Paste LLM content (convert citations on insert)',
            cls: 'cite-wide-title cite-wide-compact-title',
        });

        // Provider selector. Carried as metadata for now — the parser already
        // auto-handles both Google AI multi-comma and Perplexity adjacent-multi
        // forms, so the selection is informational. Keeps the field for any
        // future provider-specific tweaks.
        const providerRow = container.createDiv('cite-wide-provider-row');

        providerRow.createSpan({ text: 'Source:', cls: 'cite-wide-provider-label' });

        const providers: { value: Provider; label: string }[] = [
            { value: 'google-ai', label: 'Google AI Overviews' },
            { value: 'perplexity', label: 'Perplexity' },
        ];
        for (const { value, label } of providers) {
            const lbl = providerRow.createEl('label', { cls: 'cite-wide-provider-option' });
            const radio = lbl.createEl('input', { type: 'radio' });
            radio.name = 'cite-wide-provider';
            radio.value = value;
            radio.checked = this.provider === value;
            radio.addEventListener('change', () => {
                if (radio.checked) this.provider = value;
            });
            lbl.createSpan({ text: label });
        }

        // Big textarea: where the user pastes the LLM output verbatim.
        this.textarea = contentEl.createEl('textarea', { cls: 'cite-wide-paste-textarea' });
        this.textarea.placeholder = 'Paste LLM output here. Inline citations like [1, 2, 3] (Google AI) or [1][2] (Perplexity) and reference lists like [1] [title](URL) will be converted to lossless [^hex] format on insert. Existing hex citations in the active document are accounted for so generated hex IDs never collide.';

        // Footer with action buttons.
        const footer = contentEl.createDiv('cite-wide-paste-footer');

        const cancelBtn = footer.createEl('button', { text: 'Cancel', cls: 'cite-wide-paste-btn' });
        cancelBtn.addEventListener('click', () => this.close());

        const insertBtn = footer.createEl('button', {
            text: 'Parse and insert',
            cls: 'mod-cta cite-wide-paste-btn',
        });
        insertBtn.addEventListener('click', () => {
            void this.parseAndInsert();
        });

        // Defer focus to next tick so the modal's own focus management runs first.
        window.setTimeout(() => this.textarea.focus(), 50);
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
            console.warn('Cite Wide LLM citation flags (paste):', { provider: this.provider, flags: result.flags });
        }

        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
