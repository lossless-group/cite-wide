// cite-wide/src/settings/CiteWideSettings.ts
import type { App, SettingDefinitionItem } from 'obsidian';
import { PluginSettingTab } from 'obsidian';
import type CiteWidePlugin from '../../main';
import { urlCitationService } from '../services/urlCitationService';
import { citationFileService } from '../services/citationFileService';

export interface CiteWideSettings {
    jinaApiKey: string;
    citationsFolder: string;
    autoSaveUrlCitations: boolean;
}

export const DEFAULT_SETTINGS: CiteWideSettings = {
    jinaApiKey: '',
    citationsFolder: 'Citations',
    autoSaveUrlCitations: false
};

type SettingKey = keyof CiteWideSettings;

function isSettingKey(key: string): key is SettingKey {
    return Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key);
}

// Built on Obsidian 1.13's declarative settings API: Obsidian renders these
// definitions and indexes them for settings search. There is no display()
// override. Controls bind to top-level keys of plugin.settings via
// getControlValue / setControlValue below.
export class CiteWideSettingTab extends PluginSettingTab {
    plugin: CiteWidePlugin;

    constructor(app: App, plugin: CiteWidePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    getControlValue(key: string): unknown {
        return isSettingKey(key) ? this.plugin.settings[key] : undefined;
    }

    async setControlValue(key: string, value: unknown): Promise<void> {
        const settings = this.plugin.settings;
        switch (key) {
            case 'jinaApiKey': {
                const apiKey = typeof value === 'string' ? value : '';
                settings.jinaApiKey = apiKey;
                urlCitationService.setApiKey(apiKey);
                break;
            }
            case 'citationsFolder': {
                const folder = typeof value === 'string' ? value : '';
                settings.citationsFolder = folder;
                citationFileService.setCitationsFolder(folder);
                break;
            }
            case 'autoSaveUrlCitations':
                settings.autoSaveUrlCitations = value === true;
                break;
            default:
                return;
        }
        await this.plugin.saveSettings();
        // The API key status rows' `visible` predicates depend on the key.
        // refreshDomState() toggles them in place without a re-render, so
        // typing in the key field keeps focus.
        if (key === 'jinaApiKey') this.refreshDomState();
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        const hasApiKey = () => this.plugin.settings.jinaApiKey.trim().length > 0;
        return [
            {
                name: 'Jina.ai API key (optional)',
                desc: 'Enter your Jina.ai API key to avoid rate limits. Get your key from https://jina.ai/. Leave empty to use without authentication.',
                control: { type: 'text', key: 'jinaApiKey', placeholder: 'Enter your API key (optional)' },
            },
            {
                name: 'API key status',
                desc: '✅ API key configured - URL citation extraction with rate limit protection',
                visible: hasApiKey,
            },
            {
                name: 'API key status',
                desc: '⚠️ No API key configured - URL citation extraction works but may hit rate limits',
                visible: () => !hasApiKey(),
            },
            {
                name: 'Citations folder',
                desc: 'Folder where citation files will be stored for Dataview integration.',
                control: { type: 'text', key: 'citationsFolder', placeholder: 'Citations' },
            },
            {
                name: 'Auto-save URL citations',
                desc: 'Automatically save citations extracted from URLs as citation files in the citations folder. When off (default), URL extracts only update the document. Use the "Save all hex citations to citation files" command or the per-citation save button in the citations modal to canonicalize specific citations.',
                control: { type: 'toggle', key: 'autoSaveUrlCitations' },
            },
            {
                type: 'group',
                heading: 'How to use URL citation extraction',
                items: [
                    { name: '1. Highlight a URL', desc: 'Select a URL in your document.' },
                    { name: '2. Run the command', desc: 'Run "Extract citation from URL" from the command palette (Ctrl/Cmd + P).' },
                    { name: '3. The URL becomes a reference', desc: 'The URL is replaced with a citation reference like [^a1b2c3].' },
                    { name: '4. The citation is added', desc: 'A properly formatted citation is added to the footnotes section.' },
                    {
                        name: 'Example',
                        desc: 'URL: https://bobsbeenreading.com/2016/05/08/originals-by-adam-grant/ becomes: [^1b34df]: 2022, Mar. "[Originals, by Adam Grant | Bob\'s Books](https://bobsbeenreading.com/2016/05/08/originals-by-adam-grant/)" Bob Holfeld. [Bob\'s Been Reading](https://bobsbeenreading.com/).',
                    },
                ],
            },
        ];
    }
}
