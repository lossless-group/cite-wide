// filesUsedIn / cited_in_files are wikilinks so Obsidian rewrites them when a
// note is renamed. Plain paths written by older versions went stale: a
// citation recorded "Vocabulary/Relational Database.md" after the note became
// "Relational Databases.md", and looked orphaned (2026-10-06).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import { addFileLink, linkTextOf, obsidianLinker, plainLinker } from '../src/utils/fileLinks';

function appWith(paths: string[]): App {
    const files = paths.map(p => Object.assign(new TFile(), { path: p }));
    return {
        vault: { getAbstractFileByPath: (p: string) => files.find(f => f.path === p) ?? null },
        metadataCache: {
            // Shortest unique link text, like Obsidian: the basename when unique.
            fileToLinktext: (f: TFile) => {
                const base = f.path.replace(/\.md$/, '').split('/').pop()!;
                return files.filter(x => x.path.replace(/\.md$/, '').split('/').pop() === base).length > 1 ? f.path.replace(/\.md$/, '') : base;
            },
            getFirstLinkpathDest: (link: string) => files.find(f => {
                const p = f.path.replace(/\.md$/, '');
                return p === link || p.split('/').pop() === link;
            }) ?? null,
        },
    } as unknown as App;
}

test('linkTextOf strips brackets, alias, heading, and .md', () => {
    assert.equal(linkTextOf('[[Vocabulary/Relational Databases|RDBMS]]'), 'Vocabulary/Relational Databases');
    assert.equal(linkTextOf('[[Note#Section]]'), 'Note');
    assert.equal(linkTextOf('Vocabulary/Relational Databases.md'), 'Vocabulary/Relational Databases');
});

test('new entries are written as the shortest unique wikilink', () => {
    const app = appWith(['Vocabulary/Relational Databases.md']);
    const linker = obsidianLinker(app, 'Citations/3l14s3.md');
    assert.deepEqual(addFileLink([], 'Vocabulary/Relational Databases.md', linker), ['[[Relational Databases]]']);
});

test('a legacy plain path is upgraded to a link while its note still exists', () => {
    const app = appWith(['Beautiful Soup.md']);
    const linker = obsidianLinker(app, 'Citations/569gqp.md');
    assert.deepEqual(addFileLink(['Beautiful Soup.md'], undefined, linker), ['[[Beautiful Soup]]']);
});

test('a path and a link to the same note are one entry, not two', () => {
    const app = appWith(['Vocabulary/Relational Databases.md']);
    const linker = obsidianLinker(app, 'Citations/3l14s3.md');
    assert.deepEqual(addFileLink(['[[Relational Databases]]'], 'Vocabulary/Relational Databases.md', linker), ['[[Relational Databases]]']);
    assert.deepEqual(addFileLink(['Vocabulary/Relational Databases.md'], 'Vocabulary/Relational Databases.md', linker), ['[[Relational Databases]]']);
});

test('without an App, links are path-based and still deduplicate', () => {
    assert.deepEqual(addFileLink(['[[Memos/New]]'], 'Memos/New.md', plainLinker), ['[[Memos/New]]']);
    assert.deepEqual(addFileLink([], 'Memos/New.md', plainLinker), ['[[Memos/New]]']);
});
