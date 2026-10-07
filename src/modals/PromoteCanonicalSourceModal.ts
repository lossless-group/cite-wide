import { App, ButtonComponent, Modal, Setting } from 'obsidian';
import {
    isPublicationType,
    PUBLICATION_TYPES,
    type CanonicalForm,
} from '../services/canonicalSourceService';

export interface PromoteSubmission {
    form: CanonicalForm;
    /** Download the source file and import its text. */
    capture: boolean;
}

/**
 * Confirm step of "Promote to canonical source": the prefilled bibliographic
 * fields, all editable, plus the content-capture checkbox (on by default).
 */
export class PromoteCanonicalSourceModal extends Modal {
    private form: CanonicalForm;
    private capture = true;
    private submitted = false;

    constructor(
        app: App,
        private readonly hexId: string,
        prefill: CanonicalForm,
        private readonly onSubmit: (submission: PromoteSubmission) => Promise<void>,
    ) {
        super(app);
        this.form = { ...prefill, authors: [...prefill.authors] };
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('cite-wide-modal');
        this.setTitle(`Promote [^${this.hexId}] to canonical source`);

        new Setting(contentEl)
            .setName('Title')
            .addText(text => text
                .setValue(this.form.title)
                .onChange(value => { this.form.title = value; }));

        new Setting(contentEl)
            .setName('Subtitle')
            .addText(text => text
                .setValue(this.form.subtitle)
                .onChange(value => { this.form.subtitle = value; }));

        new Setting(contentEl)
            .setName('Authors')
            .setDesc('One per line, in publication order.')
            .addTextArea(area => {
                area.setValue(this.form.authors.join('\n'))
                    .onChange(value => { this.form.authors = value.split('\n'); });
                area.inputEl.rows = 3;
            });

        new Setting(contentEl)
            .setName('Date published')
            .setDesc('Year-month-day, such as 2021-11-03. A year, or a year and month, is fine.')
            .addText(text => text
                .setPlaceholder('2021-11')
                .setValue(this.form.datePublished)
                .onChange(value => { this.form.datePublished = value; }));

        new Setting(contentEl)
            .setName('Publisher')
            .addText(text => text
                .setValue(this.form.publisher)
                .onChange(value => { this.form.publisher = value; }));

        new Setting(contentEl)
            .setName('Publication type')
            .addDropdown(dropdown => {
                for (const type of PUBLICATION_TYPES) dropdown.addOption(type, type);
                dropdown.setValue(this.form.publicationType)
                    .onChange(value => {
                        if (isPublicationType(value)) this.form.publicationType = value;
                    });
            });

        new Setting(contentEl)
            .setName('URL')
            .addText(text => text
                .setValue(this.form.url)
                .onChange(value => { this.form.url = value; }));

        new Setting(contentEl)
            .setName('Capture the source')
            .setDesc('Saves a downloadable document to the _files folder, and imports the text as markdown to the _text folder.')
            .addToggle(toggle => toggle
                .setValue(this.capture)
                .onChange(value => { this.capture = value; }));

        const buttons = contentEl.createDiv('modal-button-container');
        new ButtonComponent(buttons)
            .setButtonText('Cancel')
            .onClick(() => this.close());
        new ButtonComponent(buttons)
            .setButtonText('Promote')
            .setCta()
            .onClick(() => {
                if (this.submitted) return;
                this.submitted = true;
                this.close();
                void this.onSubmit({ form: this.form, capture: this.capture });
            });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
