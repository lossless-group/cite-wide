import { App, ButtonComponent, Modal, Notice } from 'obsidian';
import { hasRealChanges, type CitationPlan } from '../services/enrichCitationsService';
import { asString } from '../utils/coerce';

const MAX_VALUE_CHARS = 160;

function formatValue(v: unknown): string {
    if (v === undefined || v === null) return '(empty)';
    if (Array.isArray(v)) {
        const items = v.map(item => asString(item) ?? JSON.stringify(item)).filter(s => s.trim());
        return items.length > 0 ? items.join(', ') : '(empty)';
    }
    const s = asString(v) ?? JSON.stringify(v);
    if (!s.trim()) return '(empty)';
    return s.length > MAX_VALUE_CHARS ? `${s.slice(0, MAX_VALUE_CHARS - 1)}…` : s;
}

/**
 * Review step of "Enrich citations": every citation with proposed changes,
 * old → new per field, one checkbox per citation (all on). Nothing is
 * written until Apply; closing the modal discards the plan.
 */
export class EnrichCitationsModal extends Modal {
    private readonly changed: CitationPlan[];
    private readonly selected = new Map<string, boolean>();
    private submitted = false;

    constructor(
        app: App,
        private readonly plans: readonly CitationPlan[],
        private readonly reportFolder: string,
        private readonly onApply: (approved: CitationPlan[]) => Promise<void>,
    ) {
        super(app);
        this.changed = plans.filter(p => hasRealChanges(p.changes));
        for (const p of this.changed) this.selected.set(p.path, true);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('cite-wide-modal', 'cite-wide-enrich');
        const n = this.changed.length;
        this.setTitle(n === 0 ? 'Enrich citations: nothing to change' : `Enrich citations: ${n} with changes`);

        const checkedCount = this.plans.length;
        contentEl.createEl('p', {
            cls: 'cite-wide-enrich-summary',
            text: n === 0
                ? `All ${checkedCount} checked citation${checkedCount === 1 ? ' is' : 's are'} already enriched. Apply writes only the run report to ${this.reportFolder}.`
                : `${n} of ${checkedCount} checked citations have changes. Apply writes the checked ones, then a run report to ${this.reportFolder}.`,
        });

        if (n > 1) {
            const all = contentEl.createEl('label', { cls: 'cite-wide-all-label' });
            const allBox = all.createEl('input', { type: 'checkbox' });
            allBox.checked = true;
            all.appendText('Select all');
            allBox.addEventListener('change', () => {
                for (const p of this.changed) this.selected.set(p.path, allBox.checked);
                for (const box of Array.from(list.querySelectorAll<HTMLInputElement>('input.cite-wide-enrich-checkbox'))) box.checked = allBox.checked;
            });
        }

        const list = contentEl.createDiv('cite-wide-enrich-list');
        for (const plan of this.changed) this.renderCitation(list, plan);

        const buttons = contentEl.createDiv('modal-button-container');
        new ButtonComponent(buttons)
            .setButtonText('Cancel')
            .onClick(() => this.close());
        new ButtonComponent(buttons)
            .setButtonText('Apply')
            .setCta()
            .onClick(() => {
                if (this.submitted) return;
                this.submitted = true;
                const approved = this.changed.filter(p => this.selected.get(p.path) === true);
                this.close();
                void this.onApply(approved).catch((error: unknown) => {
                    console.error('Cite Wide: applying enrichment failed.', error);
                    new Notice(`Could not apply the enrichment: ${error instanceof Error ? error.message : String(error)}`);
                });
            });
    }

    private renderCitation(list: HTMLElement, plan: CitationPlan): void {
        const card = list.createDiv('cite-wide-enrich-citation');
        const header = card.createEl('label', { cls: 'cite-wide-enrich-header' });
        const box = header.createEl('input', { type: 'checkbox', cls: 'cite-wide-enrich-checkbox' });
        box.checked = true;
        box.addEventListener('change', () => this.selected.set(plan.path, box.checked));
        header.createSpan({ cls: 'cite-wide-enrich-id', text: `[^${plan.hexId}]` });
        const title = asString(plan.changes.find(c => c.key === 'title')?.to) ?? asString(plan.current['title']) ?? '';
        if (title.trim()) header.createSpan({ cls: 'cite-wide-enrich-title', text: title });

        const table = card.createEl('table', { cls: 'cite-wide-enrich-changes' });
        for (const change of plan.changes) {
            const row = table.createEl('tr');
            row.createEl('td', { cls: 'cite-wide-enrich-key', text: change.key });
            const values = row.createEl('td', { cls: 'cite-wide-enrich-values' });
            values.createSpan({ cls: 'cite-wide-enrich-old', text: formatValue(change.from) });
            values.createSpan({ cls: 'cite-wide-enrich-arrow', text: ' → ' });
            values.createSpan({ cls: 'cite-wide-enrich-new', text: formatValue(change.to) });
            values.createDiv({ cls: 'cite-wide-enrich-reason', text: change.reason });
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/**
 * The progress notice: "Enriching 12 / 70…" with a Cancel button that stops
 * the run before the review step.
 */
export class EnrichProgressNotice {
    private readonly notice: Notice;
    private readonly label: HTMLElement;
    private cancelled = false;

    constructor(onCancel: () => void) {
        this.notice = new Notice('', 0);
        const el = this.notice.messageEl;
        el.empty();
        el.addClass('cite-wide-enrich-progress');
        this.label = el.createSpan({ text: 'Reading the vault…' });
        const cancel = el.createEl('button', { text: 'Cancel', cls: 'cite-wide-enrich-cancel' });
        cancel.addEventListener('click', event => {
            event.stopPropagation();
            cancel.disabled = true;
            this.cancelled = true;
            this.label.setText('Cancelling…');
            onCancel();
        });
    }

    update(done: number, total: number): void {
        if (this.cancelled) return;
        this.label.setText(`Enriching ${done} / ${total}…`);
    }

    hide(): void {
        this.notice.hide();
    }
}
