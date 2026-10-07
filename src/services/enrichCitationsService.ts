// "Enrich all citations" / "Enrich this citation": the pure part.
//
// Spec:  context-v/specs/Enrich-Citations.md
// Issue: context-v/issues/Enriching-the-Lossless-Vault-Citations.md
//
// No I/O here. The runner (enrichCitationsRunner.ts) reads the vault and
// fetches; this file decides what to change and renders the report, so every
// rule that came out of the 2026-10-06 vault run is unit-tested.

import { buildPrefill, isJunkTitle, isPlausibleAuthor, parseFootnote, siteRoot, splitAuthors, type Tier2Meta } from './canonicalSourceService';
import { decodeEntities, type BrandAssets, type DirectFetchResult } from './directFetchService';
import { plainLinker, type FileLinker } from '../utils/fileLinks';
import { asString, asStringArray } from '../utils/coerce';

/** One proposed frontmatter edit. `from` is the stored value (undefined when the key is absent). */
export interface FieldChange {
    key: string;
    from: unknown;
    to: string | string[];
    reason: string;
}

/** What the network said about one citation. */
export interface FetchedCitation {
    /** Tier 1, the page's <meta> tags; null when there was no URL or the fetch failed. */
    tier1: DirectFetchResult | null;
    /** Tier 2, Jina Reader; null when not needed or it failed. */
    tier2: Tier2Meta | null;
    /** Publisher brand assets: the page's, filled in from the homepage when needed. */
    brand: BrandAssets | undefined;
    /** A YouTube video's channel name. */
    channel: string | null;
    /** The day of the fetch, YYYY-MM-DD. */
    fetchedOn: string;
}

/** Where a citation is used today. */
export interface CitationUsage {
    /** Vault paths of the notes that use or define `[^id]`, sorted. */
    files: string[];
    /** The first non-empty `[^id]:` definition line found, trimmed. */
    definition: string | undefined;
}

export interface NoteText {
    path: string;
    content: string;
}

/** Everything the review modal and the report need about one citation. */
export interface CitationPlan {
    hexId: string;
    /** The citation file's vault path. */
    path: string;
    /** The URL that was fetched, if any. */
    url: string | undefined;
    tier1Ok: boolean;
    tier2Ok: boolean;
    usage: CitationUsage | undefined;
    /** The frontmatter as read before planning. */
    current: Record<string, unknown>;
    changes: FieldChange[];
}

/** Refreshed on every successful fetch, so it never counts as a change on its own. */
export const ACCESS_DATE_KEY = 'date_recently_accessed';

/** The light-format fields citationFileService writes, checked by the report. */
export const LIGHT_FIELDS = ['title', 'author', 'url', 'date', 'source', 'referenceText'] as const;

const BRAND_FIELDS: Array<[string, keyof BrandAssets]> = [
    ['publisher_favicon_url', 'favicon'],
    ['publisher_app_icon_url', 'appIcon'],
    ['publisher_logo_url', 'logo'],
    ['publisher_mask_icon_url', 'maskIcon'],
    ['publisher_mask_icon_color', 'maskIconColor'],
    ['publisher_brand_color', 'brandColor'],
    ['publisher_web_manifest_url', 'webManifest'],
];

// --- Value helpers -------------------------------------------------------

function isEmpty(v: unknown): boolean {
    if (v === undefined || v === null) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) return v.every(isEmpty);
    return false;
}

function sameValue(a: unknown, b: unknown): boolean {
    if (isEmpty(a) && isEmpty(b)) return true;
    return JSON.stringify(a) === JSON.stringify(b);
}

function text(v: unknown): string {
    return asString(v)?.trim() ?? '';
}

function sortedUnique(list: readonly string[]): string[] {
    return [...new Set(list)].sort();
}

// --- Usage index ---------------------------------------------------------

const DEFINITION = /^\s*\[\^([A-Za-z0-9_-]+)\]:(.*)$/;
const MARKER = /\[\^([A-Za-z0-9_-]+)\]/g;

/**
 * For every citation ID in the vault: the notes that use or define it, and its
 * first non-empty definition. Built once per run, never once per citation.
 * Notes inside `excludeFolder` (the citations folder, its reports and text
 * imports) are not usage.
 */
export function buildUsageIndex(notes: Iterable<NoteText>, excludeFolder?: string): Map<string, CitationUsage> {
    const prefix = excludeFolder ? `${excludeFolder.replace(/^\/+|\/+$/g, '')}/` : undefined;
    const byPath = new Map<string, string>();
    for (const note of notes) {
        if (prefix && note.path.startsWith(prefix)) continue;
        if (!byPath.has(note.path)) byPath.set(note.path, note.content);
    }

    const files = new Map<string, Set<string>>();
    const definitions = new Map<string, string>();
    for (const path of [...byPath.keys()].sort()) {
        const content = byPath.get(path) ?? '';
        for (const m of content.matchAll(MARKER)) {
            const id = m[1];
            if (!id) continue;
            let set = files.get(id);
            if (!set) files.set(id, set = new Set());
            set.add(path);
        }
        for (const line of content.split('\n')) {
            const def = DEFINITION.exec(line);
            const id = def?.[1];
            if (!id || definitions.has(id) || !def[2]?.trim()) continue;
            definitions.set(id, line.trim());
        }
    }

    const index = new Map<string, CitationUsage>();
    for (const [id, set] of files) index.set(id, { files: sortedUnique([...set]), definition: definitions.get(id) });
    return index;
}

// --- Planner -------------------------------------------------------------

/**
 * The frontmatter edits for one citation file. Pure: the current frontmatter,
 * what was fetched, and where the citation is used go in; changes come out.
 *
 * Fill rules (spec, "Planning rules"):
 * - title, url, date, source, referenceText: fill when empty (titles also
 *   when junk); an entity-encoded title is decoded; never overwrite otherwise.
 * - author: fill when empty, or replace when it isn't a name.
 * - authors: add when absent; replace only when no entry is a name.
 * - publisher, publisher_url, date_published, piece_og_image, publisher_*:
 *   add when absent, never blank.
 * - date_recently_accessed: set when tier 1 read the page.
 * - filesUsedIn: the notes that cite it today, as links; kept when none found.
 * - canonical and everything else: untouched.
 */
export function planCitationChanges(
    current: Record<string, unknown>,
    fetched: FetchedCitation,
    usage: CitationUsage | undefined,
    linker: FileLinker = plainLinker,
): FieldChange[] {
    const parsed = usage?.definition ? parseFootnote(usage.definition) : null;
    const { tier1, tier2, channel } = fetched;
    const prefill = buildPrefill({ parsed, existing: current, tier1, tier2, channel });
    const changes: FieldChange[] = [];

    const propose = (key: string, to: string | string[], reason: string): void => {
        if (!sameValue(current[key], to)) changes.push({ key, from: current[key], to, reason });
    };
    const fillEmpty = (key: string, value: string | undefined): void => {
        const v = value?.trim();
        if (v && isEmpty(current[key])) propose(key, v, 'was empty');
    };
    const addAbsent = (key: string, value: string | undefined): void => {
        const v = value?.trim();
        if (v && isEmpty(current[key])) propose(key, v, 'was absent');
    };

    // Light fields.
    const storedTitle = asString(current['title']) ?? '';
    const fetchedTitle = prefill.title ? decodeEntities(prefill.title) : '';
    if (!storedTitle.trim()) {
        fillEmpty('title', fetchedTitle);
    } else if (isJunkTitle(storedTitle)) {
        if (fetchedTitle) propose('title', fetchedTitle, `"${storedTitle.trim()}" is an error or bot-check page`);
    } else {
        const decoded = decodeEntities(storedTitle);
        if (decoded !== storedTitle) propose('title', decoded, 'HTML entities decoded');
    }

    fillEmpty('url', prefill.url);

    const storedAuthor = text(current['author']);
    const fetchedAuthor = prefill.authors.join(', ');
    if (!storedAuthor) {
        fillEmpty('author', fetchedAuthor);
    } else if (!splitAuthors(storedAuthor).some(isPlausibleAuthor)) {
        propose('author', fetchedAuthor, fetchedAuthor
            ? `"${storedAuthor}" is not a name`
            : `"${storedAuthor}" is not a name, and no author was found`);
    }

    fillEmpty('date', prefill.datePublished);
    fillEmpty('source', prefill.publisher);
    fillEmpty('referenceText', parsed?.referenceText);

    // Schema fields: add when absent, never blank.
    const storedAuthors = asStringArray(current['authors']).map(a => a.trim()).filter(Boolean);
    if (storedAuthors.length === 0) {
        if (prefill.authors.length > 0) propose('authors', prefill.authors, 'was absent');
    } else if (!storedAuthors.some(isPlausibleAuthor)) {
        propose('authors', prefill.authors, 'no entry is a name');
    }
    addAbsent('publisher', prefill.publisher);
    const url = text(current['url']) || prefill.url;
    addAbsent('publisher_url', url ? siteRoot(url) : undefined);
    addAbsent('date_published', prefill.datePublished);
    addAbsent('piece_og_image', tier1?.image);
    const brand = fetched.brand ?? tier1?.brand;
    for (const [key, field] of BRAND_FIELDS) {
        let value = brand?.[field];
        if (field === 'favicon') {
            value = value || tier1?.favicon;
            // Without a page read, /favicon.ico is a guess, not something the site declared.
            if (!tier1 && value?.endsWith('/favicon.ico')) value = undefined;
        }
        addAbsent(key, value);
    }

    if (tier1) propose(ACCESS_DATE_KEY, fetched.fetchedOn, 'the page was read');

    // Usage, as links Obsidian keeps correct through renames.
    if (usage && usage.files.length > 0) {
        const links = sortedUnique(usage.files).map(p => linker.link(p));
        const stored = asStringArray(current['filesUsedIn']);
        if (JSON.stringify([...stored].sort()) !== JSON.stringify([...links].sort())) {
            changes.push({ key: 'filesUsedIn', from: current['filesUsedIn'], to: links, reason: 'the notes that cite it today' });
        }
    }

    return changes;
}

/** True when a plan changes more than the access date. */
export function hasRealChanges(changes: readonly FieldChange[]): boolean {
    return changes.some(c => c.key !== ACCESS_DATE_KEY);
}

/**
 * Apply planned changes to a frontmatter object (inside processFrontMatter).
 * A change is skipped when the field no longer holds the value it was planned
 * against, so an edit made during review is never overwritten.
 */
export function applyFieldChanges(fm: Record<string, unknown>, changes: readonly FieldChange[]): FieldChange[] {
    const applied: FieldChange[] = [];
    for (const change of changes) {
        if (!sameValue(fm[change.key], change.from)) continue;
        fm[change.key] = Array.isArray(change.to) ? [...change.to] : change.to;
        applied.push(change);
    }
    return applied;
}

// --- Report --------------------------------------------------------------

export interface EnrichmentReportInput {
    /** Shown in the heading, e.g. "2026-10-06 14:05". */
    generatedAt: string;
    plans: readonly CitationPlan[];
    /** Applied changes, by citation file path. */
    applied: ReadonlyMap<string, readonly FieldChange[]>;
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function citationLink(plan: CitationPlan): string {
    return `[[${plan.path.replace(/\.md$/i, '')}|${plan.hexId}]]`;
}

function noteLink(path: string): string {
    return `[[${path.replace(/\.md$/i, '')}]]`;
}

function bulletList(lines: string[]): string {
    return lines.length > 0 ? lines.join('\n') : 'None.';
}

/** The run report note, as markdown. Pure. */
export function renderEnrichmentReport(input: EnrichmentReportInput): string {
    const { plans, applied } = input;
    const changedPlans = plans.filter(p => (applied.get(p.path)?.length ?? 0) > 0);
    const appliedCount = changedPlans.reduce((n, p) => n + (applied.get(p.path)?.length ?? 0), 0);

    const perField = new Map<string, number>();
    for (const p of changedPlans) {
        for (const c of applied.get(p.path) ?? []) perField.set(c.key, (perField.get(c.key) ?? 0) + 1);
    }
    const fieldRows = [...perField.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([key, n]) => `| ${key} | ${n} |`);

    const dead = plans
        .filter(p => p.url && !p.tier1Ok && !p.tier2Ok)
        .map(p => `- ${citationLink(p)}: <${p.url ?? ''}>`);

    const noFootnote = plans
        .filter(p => !p.usage?.definition)
        .map(p => {
            const files = p.usage?.files ?? [];
            return files.length > 0
                ? `- ${citationLink(p)}: cited in ${files.map(noteLink).join(', ')}, but never defined`
                : `- ${citationLink(p)}: not cited in any note`;
        });

    const stillEmpty: string[] = [];
    for (const p of plans) {
        const after: Record<string, unknown> = { ...p.current };
        for (const c of applied.get(p.path) ?? []) after[c.key] = c.to;
        const empty = LIGHT_FIELDS.filter(key => isEmpty(after[key]));
        if (empty.length > 0) stillEmpty.push(`- ${citationLink(p)}: ${empty.join(', ')}`);
    }

    return [
        `# Citation enrichment, ${input.generatedAt}`,
        '',
        `${plural(plans.length, 'citation')} checked, ${plural(changedPlans.length, 'citation')} changed, ${plural(appliedCount, 'field')} written.`,
        '',
        '## What changed',
        '',
        fieldRows.length > 0 ? ['| Field | Citations |', '|---|---|', ...fieldRows].join('\n') : 'None.',
        '',
        '## Dead or blocked links',
        '',
        'Both the page fetch and Jina Reader failed.',
        '',
        bulletList(dead),
        '',
        '## No footnote anywhere',
        '',
        'No note defines these citations’ footnotes.',
        '',
        bulletList(noFootnote),
        '',
        '## Fields still empty',
        '',
        bulletList(stillEmpty),
        '',
    ].join('\n');
}
