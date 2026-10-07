// Regression: "Insert hex citation" creates Citations/<hex>.md before the
// footnote has text. Saving later used to only bump usageCount, leaving the
// file permanently empty (25 of 75 files in the lossless vault, 2026-10-06).
// A save must now backfill empty fields from the footnote, and never
// overwrite fields that already have values.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import { citationFileService, initializeCitationFileService } from '../src/services/citationFileService';

type FM = Record<string, unknown>;
const files = new Map<string, { file: TFile; fm: FM }>();

function makeApp(): App {
    return {
        vault: {
            getAbstractFileByPath: (p: string) => files.get(p)?.file ?? null,
            createFolder: () => Promise.resolve(),
            create: (p: string) => {
                const file = Object.assign(new TFile(), { path: p });
                files.set(p, { file, fm: {} });
                return Promise.resolve(file);
            },
        },
        fileManager: {
            processFrontMatter: (file: TFile, fn: (fm: FM) => void) => {
                const entry = [...files.values()].find(e => e.file === file);
                fn(entry!.fm);
                return Promise.resolve();
            },
        },
        metadataCache: { getFileCache: () => null },
    } as unknown as App;
}

function seedEmpty(hex: string, extra: FM = {}): FM {
    const file = Object.assign(new TFile(), { path: `Citations/${hex}.md` });
    const fm: FM = { hexId: hex, title: '', author: '', url: '', date: '', source: '', referenceText: '', usageCount: 1, filesUsedIn: ['a.md'], ...extra };
    files.set(`Citations/${hex}.md`, { file, fm });
    return fm;
}

const NOTE = [
    'The OpenCloud report[^80nyxu] is a canonical source.',
    '',
    '[^80nyxu]: 2021, Nov. ["State of the OpenCloud 2021"](https://www.scribd.com/document/536774580/Battery-Ventures-OpenCloud-Report-2021). Scribd. Battery Ventures.',
].join('\n');

beforeEach(() => {
    files.clear();
    initializeCitationFileService(makeApp());
    citationFileService.setCitationsFolder('Citations');
});

test('saving backfills an empty citation file from its footnote', async () => {
    const fm = seedEmpty('80nyxu');
    const result = await citationFileService.saveAllHexCitationsFromContent(NOTE, 'Vocabulary/Open Source Software.md');
    assert.equal(result.updated, 1);
    assert.match(String(fm.referenceText), /State of the OpenCloud 2021/);
    assert.equal(fm.url, 'https://www.scribd.com/document/536774580/Battery-Ventures-OpenCloud-Report-2021');
    assert.equal(fm.usageCount, 2);
    assert.deepEqual(fm.filesUsedIn, ['a.md', 'Vocabulary/Open Source Software.md']);
});

test('saving never overwrites fields that already have values', async () => {
    const fm = seedEmpty('80nyxu', { referenceText: 'Hand-edited reference', url: 'https://example.com/kept' });
    await citationFileService.saveAllHexCitationsFromContent(NOTE, 'b.md');
    assert.equal(fm.referenceText, 'Hand-edited reference');
    assert.equal(fm.url, 'https://example.com/kept');
});

test('an existing empty file with no footnote text stays empty but counts the use', async () => {
    const fm = seedEmpty('abc123');
    await citationFileService.saveAllHexCitationsFromContent('Inline only[^abc123].', 'c.md');
    assert.equal(fm.referenceText, '');
    assert.equal(fm.usageCount, 2);
});

test('base-36 IDs (the format generateHexId produces) are recognized', async () => {
    const { citationService } = await import('../src/services/citationService');
    for (const id of ['80nyxu', 'a1b2c3', 'zz9q01', '0f3a2b']) {
        const groups = citationService.extractCitations(`Claim[^${id}].\n\n[^${id}]: Some source. https://example.com/${id}`);
        assert.equal(groups.length, 1, id);
        assert.equal(groups[0]!.number, `hex_${id}`);
        assert.ok(groups[0]!.matches.some(m => m.isReferenceSource), `${id} definition found`);
    }
    for (let i = 0; i < 50; i++) {
        const id = citationService.generateHexId();
        assert.equal(citationService.extractCitations(`x[^${id}]`).length, 1, `generated ${id}`);
    }
});
