// Guards the "Cite Wide's commands don't load" report against Obsidian
// 1.14.4: loads main.ts's plugin class against the obsidian stub, whose
// addSettingTab() calls getSettingDefinitions() as 1.13+ does, and asserts
// onload() completes and registers every command.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import CiteWidePlugin from '../main';
import { DEFAULT_SETTINGS } from '../src/settings/CiteWideSettings';

interface StubPlugin {
    commands: { id: string; name: string }[];
    settingTabs: { settingItems: unknown[] }[];
    ribbonIcons: { icon: string; title: string }[];
    storedData: unknown;
    settings: unknown;
    onload(): Promise<void>;
}

// Every command ID main.ts registered in 0.2.3. IDs are what user hotkeys
// bind to, so they must not change.
const COMMAND_IDS = [
    'show-citations',
    'dedupe-citations-by-url',
    'parse-llm-citations',
    'paste-llm-content',
    'save-all-hex-citations',
    'convert-all-citations',
    'insert-hex-citation',
    'convert-selected-citation-to-hex',
    'clean-references-section',
    'convert-citation-section-to-footnotes',
    'format-citations-punctuation',
    'lift-table-citations',
    'extract-citation-from-url',
    'format-reference-links',
];

function makePlugin(storedData: unknown = null): StubPlugin {
    const app = { workspace: {}, vault: {}, metadataCache: {}, fileManager: {} };
    const manifest = { id: 'cite-wide', name: 'Cite Wide', version: '0.0.0' };
    const Ctor = CiteWidePlugin as unknown as new (app: unknown, manifest: unknown) => StubPlugin;
    const plugin = new Ctor(app, manifest);
    plugin.storedData = storedData;
    return plugin;
}

describe('plugin onload()', () => {
    test('registers every command, with no duplicates', async () => {
        const plugin = makePlugin();
        await plugin.onload();
        const ids = plugin.commands.map(c => c.id);
        assert.deepEqual([...ids].sort(), [...COMMAND_IDS].sort());
        for (const c of plugin.commands) assert.ok(c.name.trim(), `command ${c.id} has no name`);
    });

    test('adds the settings tab and its definitions build during addSettingTab()', async () => {
        const plugin = makePlugin();
        await plugin.onload();
        assert.equal(plugin.settingTabs.length, 1);
        assert.ok(plugin.settingTabs[0]!.settingItems.length > 0, 'settings tab produced no definitions');
        assert.equal(plugin.ribbonIcons.length, 1);
    });

    test('loads with no data.json and with a stored data.json', async () => {
        const fresh = makePlugin(null);
        await fresh.onload();
        assert.deepEqual(fresh.settings, DEFAULT_SETTINGS);

        const stored = makePlugin({ jinaApiKey: 'jina_test', citationsFolder: 'Refs', autoSaveUrlCitations: true });
        await stored.onload();
        assert.deepEqual(stored.settings, { jinaApiKey: 'jina_test', citationsFolder: 'Refs', autoSaveUrlCitations: true });
        assert.equal(stored.commands.length, COMMAND_IDS.length);
    });
});
