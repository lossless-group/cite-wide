// cite-wide/src/settings/CiteWideSettings.ts
import { App, PluginSettingTab, Setting } from 'obsidian';
import CiteWidePlugin from '../../main';
import { urlCitationService } from '../services/urlCitationService';

export interface CiteWideSettings {
    jinaApiKey: string;
}

export const DEFAULT_SETTINGS: CiteWideSettings = {
    jinaApiKey: ''
};

export class CiteWideSettingTab extends PluginSettingTab {
    plugin: CiteWidePlugin;

    constructor(app: App, plugin: CiteWidePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Cite Wide Settings' });

        // Jina.ai API Key setting
        new Setting(containerEl)
            .setName('Jina.ai API Key (Optional)')
            .setDesc('Enter your Jina.ai API key to avoid rate limits. Get your key from https://jina.ai/. Leave empty to use without authentication.')
            .addText(text => text
                .setPlaceholder('Enter your API key (optional)')
                .setValue(this.plugin.settings.jinaApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.jinaApiKey = value;
                    urlCitationService.setApiKey(value);
                    await this.plugin.saveSettings();
                }));

        // Status message
        const statusEl = containerEl.createEl('div', { 
            cls: 'setting-item-description',
            text: this.plugin.settings.jinaApiKey 
                ? '✅ API key configured - URL citation extraction with rate limit protection'
                : '⚠️ No API key configured - URL citation extraction works but may hit rate limits'
        });

        // Instructions
        containerEl.createEl('h3', { text: 'How to Use URL Citation Extraction' });
        
        const instructionsEl = containerEl.createEl('div', { cls: 'setting-item-description' });
        instructionsEl.innerHTML = `
            <ol>
                <li>Highlight a URL in your document</li>
                <li>Run the "Extract Citation from URL" command (Ctrl/Cmd + P)</li>
                <li>The URL will be replaced with a citation reference like <code>[^a1b2c3]</code></li>
                <li>A properly formatted citation will be added to the Footnotes section</li>
            </ol>
            <p><strong>Example:</strong></p>
            <p>URL: <code>https://bobsbeenreading.com/2016/05/08/originals-by-adam-grant/</code></p>
            <p>Becomes: <code>[^1b34df]: 2022, Mar. "[Originals, by Adam Grant | Bob's Books](https://bobsbeenreading.com/2016/05/08/originals-by-adam-grant/)" Bob Holfeld. [Bob's Been Reading](https://bobsbeenreading.com/).</code></p>
        `;
    }
} 