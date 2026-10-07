// "Where is this citation used" is stored as wikilinks, not paths.
//
// Obsidian rewrites wikilinks in frontmatter when a note is renamed or moved;
// it never touches plain path strings. Citation files that recorded
// `filesUsedIn: ["Vocabulary/Relational Database.md"]` went stale the moment
// the note became "Relational Databases.md", and the citation looked orphaned.
// Writing `[[Relational Databases]]` keeps the reference correct through
// renames, and reads as a link in the Properties panel.
//
// Old files still hold plain paths, so every comparison treats a path and a
// link to the same note as equal, and plain paths are upgraded to links
// whenever a citation file is written.

import { TFile, type App } from 'obsidian';

/** The link target inside an entry: strips [[ ]], |alias, #heading, and .md. */
export function linkTextOf(entry: string): string {
    const inner = entry.trim().replace(/^\[\[/, '').replace(/\]\]$/, '');
    return inner.split('|')[0]!.split('#')[0]!.trim().replace(/\.md$/i, '');
}

export function isWikiLink(entry: string): boolean {
    return /^\[\[[^\]]+\]\]$/.test(entry.trim());
}

function withoutExt(path: string): string {
    return path.replace(/\.md$/i, '');
}

function basename(path: string): string {
    return withoutExt(path).split('/').pop() ?? path;
}

export interface FileLinker {
    /** The wikilink to write for a vault path. */
    link(path: string): string;
    /** True when a stored entry (link or legacy path) refers to this vault path. */
    refersTo(entry: string, path: string): boolean;
    /** A legacy plain-path entry as a wikilink, when it still resolves to a note; otherwise unchanged. */
    upgrade(entry: string): string;
}

/** Path-only linker for code that has no App (pure assembly, tests). */
export const plainLinker: FileLinker = {
    link: path => `[[${withoutExt(path)}]]`,
    refersTo: (entry, path) => {
        const target = linkTextOf(entry);
        return target === withoutExt(path) || (!target.includes('/') && target === basename(path));
    },
    upgrade: entry => entry,
};

/**
 * Obsidian-aware linker: shortest unambiguous link text, and link
 * resolution the way Obsidian itself resolves it from `fromPath`.
 */
export function obsidianLinker(app: App, fromPath: string): FileLinker {
    const fileAt = (path: string): TFile | null => {
        const f = app.vault.getAbstractFileByPath(path);
        return f instanceof TFile ? f : null;
    };
    const link = (path: string): string => {
        const file = fileAt(path);
        return file ? `[[${app.metadataCache.fileToLinktext(file, fromPath, true)}]]` : plainLinker.link(path);
    };
    return {
        link,
        refersTo: (entry, path) => {
            const dest = app.metadataCache.getFirstLinkpathDest(linkTextOf(entry), fromPath);
            return dest ? dest.path === path : plainLinker.refersTo(entry, path);
        },
        upgrade: entry => {
            if (isWikiLink(entry)) return entry;
            const file = fileAt(entry.trim()) ?? app.metadataCache.getFirstLinkpathDest(linkTextOf(entry), fromPath);
            return file ? link(file.path) : entry;
        },
    };
}

/** Upgrade legacy entries, then add `path` unless an entry already refers to it. */
export function addFileLink(entries: string[], path: string | undefined, linker: FileLinker): string[] {
    const upgraded = entries.map(e => linker.upgrade(e));
    if (!path || upgraded.some(e => linker.refersTo(e, path))) return upgraded;
    return [...upgraded, linker.link(path)];
}
