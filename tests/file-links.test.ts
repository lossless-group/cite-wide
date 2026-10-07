// filesUsedIn / cited_in_files are wikilinks, so Obsidian rewrites them when a
// note is renamed (plain paths went stale and made citations look orphaned).
// Format follows the vault's own convention: full vault path, no extension,
// aliased to the note's title — [[Vocabulary/Relational Databases|Relational Databases]].

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import { addFileLink, formatFileLink, linkTextOf, obsidianLinker, plainLinker } from '../src/utils/fileLinks';

function appWith(paths: string[], titles: Record<string, string> = {}): App {
    const files = paths.map(p => Object.assign(new TFile(), { path: p }));
    return {
        vault: { getAbstractFileByPath: (p: string) => files.find(f => f.path === p) ?? null },
        metadataCache: {
            getFileCache: (f: TFile) => (titles[f.path] ? { frontmatter: { title: titles[f.path] } } : null),
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

test('formatFileLink: full path, no extension, aliased', () => {
    assert.equal(formatFileLink('projects/Context-Vigilance/Philosophy/Our-Approach.md', 'Our Approach'),
        '[[projects/Context-Vigilance/Philosophy/Our-Approach|Our Approach]]');
    assert.equal(formatFileLink('Beautiful Soup.md'), '[[Beautiful Soup|Beautiful Soup]]');
});

test("new entries use the note's frontmatter title as the alias, else its file name", () => {
    const app = appWith(['projects/Context-Vigilance/Philosophy/Our-Approach.md', 'Vocabulary/Relational Databases.md'],
        { 'projects/Context-Vigilance/Philosophy/Our-Approach.md': 'Our Approach' });
    const linker = obsidianLinker(app, 'Citations/e2kfhb.md');
    assert.deepEqual(addFileLink([], 'projects/Context-Vigilance/Philosophy/Our-Approach.md', linker),
        ['[[projects/Context-Vigilance/Philosophy/Our-Approach|Our Approach]]']);
    assert.deepEqual(addFileLink([], 'Vocabulary/Relational Databases.md', linker),
        ['[[Vocabulary/Relational Databases|Relational Databases]]']);
});

test('legacy plain paths and bare links upgrade to the full form while the note exists', () => {
    const app = appWith(['Tooling/Software Development/Programming Languages/Libraries/Beautiful Soup.md']);
    const linker = obsidianLinker(app, 'Citations/569gqp.md');
    const full = '[[Tooling/Software Development/Programming Languages/Libraries/Beautiful Soup|Beautiful Soup]]';
    assert.deepEqual(addFileLink(['Beautiful Soup.md'], undefined, linker), [full]);
    assert.deepEqual(addFileLink(['[[Beautiful Soup]]'], undefined, linker), [full]);
    assert.deepEqual(addFileLink([full], undefined, linker), [full], 'already full: left exactly as written');
    assert.deepEqual(addFileLink(['Gone/Deleted Note.md'], undefined, linker), ['Gone/Deleted Note.md'], 'unresolvable: unchanged');
});

test("a tagline title is not used as the alias; a re-spaced one is", () => {
    const app = appWith(['Tooling/Baserow.md', 'Vocabulary/Multi-Modal Databases.md'],
        { 'Tooling/Baserow.md': 'Open source no-code database', 'Vocabulary/Multi-Modal Databases.md': 'Multi Modal Databases' });
    const linker = obsidianLinker(app, 'Citations/x.md');
    assert.deepEqual(addFileLink([], 'Tooling/Baserow.md', linker), ['[[Tooling/Baserow|Baserow]]']);
    assert.deepEqual(addFileLink([], 'Vocabulary/Multi-Modal Databases.md', linker), ['[[Vocabulary/Multi-Modal Databases|Multi Modal Databases]]']);
});

test('a path and a link to the same note are one entry, not two', () => {
    const app = appWith(['Vocabulary/Relational Databases.md']);
    const linker = obsidianLinker(app, 'Citations/3l14s3.md');
    const full = '[[Vocabulary/Relational Databases|Relational Databases]]';
    assert.deepEqual(addFileLink([full], 'Vocabulary/Relational Databases.md', linker), [full]);
    assert.deepEqual(addFileLink(['Vocabulary/Relational Databases.md'], 'Vocabulary/Relational Databases.md', linker), [full]);
});

test('without an App, links are full-path and still deduplicate', () => {
    assert.deepEqual(addFileLink(['[[Memos/New|New]]'], 'Memos/New.md', plainLinker), ['[[Memos/New|New]]']);
    assert.deepEqual(addFileLink([], 'Memos/New.md', plainLinker), ['[[Memos/New|New]]']);
});
