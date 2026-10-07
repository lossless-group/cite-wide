// Acceptance tests for the 0.3.0 settings tab, which moves to Obsidian
// 1.13's declarative getSettingDefinitions() API (same migration as Image
// Gin 0.3.0). These walk the definition tree Obsidian renders and indexes
// for settings search, so a missing or mistyped setting fails here instead
// of silently vanishing from the screen.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CiteWideSettingTab, DEFAULT_SETTINGS } from '../src/settings/CiteWideSettings';
import type { CiteWideSettings } from '../src/settings/CiteWideSettings';
import { urlCitationService } from '../src/services/urlCitationService';
import { citationFileService } from '../src/services/citationFileService';
import type CiteWidePlugin from '../main';
import type { App } from 'obsidian';

// Loose structural view of the definition tree; the real types come from
// obsidian 1.13 but tests stay decoupled from them.
interface Def {
    type?: string;
    name?: string;
    heading?: string;
    desc?: unknown;
    control?: { type: string; key: string; options?: Record<string, string> };
    render?: unknown;
    items?: Def[];
    visible?: boolean | (() => boolean);
}

type Tab = {
    getSettingDefinitions(): Def[];
    getControlValue(key: string): unknown;
    setControlValue(key: string, value: unknown): void | Promise<void>;
};

function makeTab(overrides: Partial<CiteWideSettings> = {}) {
    const settings: CiteWideSettings = { ...DEFAULT_SETTINGS, ...overrides };
    let saves = 0;
    const plugin = {
        settings,
        saveSettings: () => { saves++; return Promise.resolve(); },
    } as unknown as CiteWidePlugin;
    const app = { vault: {} } as unknown as App;
    const tab = new CiteWideSettingTab(app, plugin) as unknown as Tab;
    return { tab, settings, saves: () => saves };
}

/** Depth-first walk over groups, lists, and pages. */
function walk(defs: Def[], out: Def[] = []): Def[] {
    for (const d of defs) {
        out.push(d);
        if (d.items) walk(d.items, out);
    }
    return out;
}

const norm = (s: string) => s.trim().toLowerCase();

// Every row in the 0.2.x display() tab. Compared case-insensitively because
// 0.3.0 moves the names to sentence case (marketplace lint), which is a
// wording change, not a missing setting.
const REQUIRED_NAMES = [
    'Jina.ai API Key (Optional)',
    'Citations Folder',
    'Auto-save URL Citations',
];

// The 0.2.x tab also drew an API-key status line and a "How to Use URL
// Citation Extraction" instructions block; both must survive.
const REQUIRED_HEADINGS = ['How to use URL citation extraction'];

describe('declarative settings tab (Obsidian ≥ 1.13)', () => {
    test('uses getSettingDefinitions and does not override display()', () => {
        assert.ok(
            Object.prototype.hasOwnProperty.call(CiteWideSettingTab.prototype, 'getSettingDefinitions'),
            'CiteWideSettingTab must implement getSettingDefinitions()',
        );
        assert.ok(
            !Object.prototype.hasOwnProperty.call(CiteWideSettingTab.prototype, 'display'),
            'display() must not be overridden; Obsidian renders the definitions',
        );
    });

    test('every 0.2.x setting row is still present (searchable by name)', () => {
        const names = new Set(
            walk(makeTab().tab.getSettingDefinitions()).map(d => d.name).filter((n): n is string => !!n).map(norm),
        );
        const missing = REQUIRED_NAMES.filter(n => !names.has(norm(n)));
        assert.deepEqual(missing, []);
    });

    test('the URL citation instructions survive as a heading', () => {
        const headings = walk(makeTab().tab.getSettingDefinitions()).map(d => norm(d.heading ?? ''));
        for (const h of REQUIRED_HEADINGS) {
            assert.ok(headings.some(x => x.includes(norm(h))), `missing heading: ${h}`);
        }
    });

    test('API key status reflects whether a key is set', () => {
        // Only rows Obsidian would render count: evaluate `visible`.
        const shown = (d: Def) => d.visible === undefined || (typeof d.visible === 'function' ? d.visible() : d.visible);
        const status = (overrides: Partial<CiteWideSettings>) => walk(makeTab(overrides).tab.getSettingDefinitions())
            .filter(d => norm(d.name ?? '') === 'api key status' && shown(d))
            .map(d => (typeof d.desc === 'string' ? d.desc : ''));
        const without = status({ jinaApiKey: '' });
        const withKey = status({ jinaApiKey: 'jina_test' });
        assert.equal(without.length, 1);
        assert.equal(withKey.length, 1);
        assert.match(without[0]!, /no API key configured/i);
        assert.match(withKey[0]!, /^\W*API key configured/i);
    });

    test('every item is searchable: non-empty name; groups are not empty', () => {
        const defs = walk(makeTab().tab.getSettingDefinitions());
        assert.ok(defs.length > 0, 'getSettingDefinitions() returned nothing');
        for (const d of defs) {
            if (d.type === 'group' || d.type === 'list') {
                if (d.type === 'group') assert.ok((d.items?.length ?? 0) > 0, `empty group: ${d.heading}`);
                continue;
            }
            if (d.type === 'page') continue;
            assert.ok(d.name && d.name.trim(), `item without a name: ${JSON.stringify(d.control ?? d)}`);
        }
    });
});

describe('control bindings', () => {
    test('every control key exists in the settings shape', () => {
        const keys = walk(makeTab().tab.getSettingDefinitions())
            .map(d => d.control?.key)
            .filter((k): k is string => !!k);
        assert.deepEqual([...keys].sort(), Object.keys(DEFAULT_SETTINGS).sort());
    });

    test('getControlValue reads the stored value for every control', () => {
        const { tab, settings } = makeTab({ jinaApiKey: 'jina_test', citationsFolder: 'Refs', autoSaveUrlCitations: true });
        for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof CiteWideSettings)[]) {
            assert.deepEqual(tab.getControlValue(k), settings[k], k);
        }
    });

    test('setControlValue persists and keeps the services in sync', async () => {
        const { tab, settings, saves } = makeTab();
        await tab.setControlValue('jinaApiKey', 'jina_test');
        assert.equal(settings.jinaApiKey, 'jina_test');
        assert.equal(urlCitationService.hasApiKey(), true);

        await tab.setControlValue('citationsFolder', 'References');
        assert.equal(settings.citationsFolder, 'References');
        assert.equal(citationFileService.getCitationsFolder(), 'References');

        await tab.setControlValue('autoSaveUrlCitations', true);
        assert.equal(settings.autoSaveUrlCitations, true);

        assert.equal(saves(), 3);

        await tab.setControlValue('jinaApiKey', '');
        assert.equal(urlCitationService.hasApiKey(), false);
    });
});
