// "Enrich all citations" / "Enrich this citation": the I/O part.
//
// Spec: context-v/specs/Enrich-Citations.md
//
// Reads the vault once to index footnote usage, fetches each citation's
// metadata (4 at a time) with the existing canonical-source tiers, plans the
// changes with the pure planner, and, after the user approves them, writes
// through processFrontMatter and saves a report note.

import { TFile, normalizePath, type App } from 'obsidian';
import {
    buildPrefill,
    fetchPublisherBrand,
    fetchTier1,
    fetchTier2,
    fetchYouTubeChannel,
    isYouTubeUrl,
    mergeBrand,
    needsPublisherBrand,
    needsTier2,
    parseFootnote,
} from './canonicalSourceService';
import {
    applyFieldChanges,
    buildUsageIndex,
    planCitationChanges,
    type CitationPlan,
    type CitationUsage,
    type FetchedCitation,
    type FieldChange,
    type NoteText,
} from './enrichCitationsService';
import { obsidianLinker } from '../utils/fileLinks';
import { asString, isRecord } from '../utils/coerce';

export const ENRICH_CONCURRENCY = 4;

export interface CitationTarget {
    file: TFile;
    hexId: string;
}

/**
 * A citation file: a markdown file in the citations folder or a subfolder,
 * outside the plugin's own `_reports`, `_text`, and `_files` folders (any
 * folder whose name starts with `_`).
 */
export function isCitationFilePath(path: string, folder: string): boolean {
    const root = normalizePath(folder);
    if (!path.startsWith(`${root}/`) || !/\.md$/i.test(path)) return false;
    return !path.slice(root.length + 1).split('/').some(segment => segment.startsWith('_'));
}

/**
 * Every markdown note outside the citations folder, read once each.
 * `getMarkdownFiles()` lists notes in symlinked folders under their vault
 * paths; a path listed twice is read once.
 */
export async function readVaultNotes(app: App, citationsFolder: string): Promise<NoteText[]> {
    const prefix = `${normalizePath(citationsFolder)}/`;
    const seen = new Set<string>();
    const files: TFile[] = [];
    for (const file of app.vault.getMarkdownFiles()) {
        if (seen.has(file.path) || file.path.startsWith(prefix)) continue;
        seen.add(file.path);
        files.push(file);
    }
    return Promise.all(files.map(async file => ({ path: file.path, content: await app.vault.cachedRead(file) })));
}

function frontmatterOf(app: App, file: TFile): Record<string, unknown> {
    const fm: unknown = app.metadataCache.getFileCache(file)?.frontmatter;
    return isRecord(fm) ? { ...fm } : {};
}

function hexIdOf(fm: Record<string, unknown>, file: TFile): string {
    return asString(fm['hexId'])?.trim() || asString(fm['reference_hexcode'])?.trim() || file.basename;
}

export function citationTarget(app: App, file: TFile): CitationTarget {
    return { file, hexId: hexIdOf(frontmatterOf(app, file), file) };
}

/** Every citation file in the folder, in path order. */
export function listCitationTargets(app: App, folder: string): CitationTarget[] {
    return app.vault.getMarkdownFiles()
        .filter(f => isCitationFilePath(f.path, folder))
        .sort((a, b) => a.path.localeCompare(b.path))
        .map(file => citationTarget(app, file));
}

interface FetchOutcome {
    url: string | undefined;
    fetched: FetchedCitation;
}

/** Fetch one citation's metadata with the canonical-source tiers. Never throws. */
async function fetchCitation(current: Record<string, unknown>, usage: CitationUsage | undefined, today: string): Promise<FetchOutcome> {
    const empty: FetchedCitation = { tier1: null, tier2: null, brand: undefined, channel: null, fetchedOn: today };
    const parsed = usage?.definition ? parseFootnote(usage.definition) : null;
    // URL precedence follows the prefill: footnote, then the stored url.
    const url = buildPrefill({ parsed, existing: current, tier1: null, tier2: null }).url || undefined;
    if (!url) return { url, fetched: empty };
    try {
        const tier1 = await fetchTier1(url);
        const tier2 = needsTier2(tier1) ? await fetchTier2(url) : null;
        let brand = tier1?.brand;
        if (needsPublisherBrand(tier1, url)) brand = mergeBrand(brand, await fetchPublisherBrand(url));
        const channel = isYouTubeUrl(url) && !(tier1?.authors.length) ? await fetchYouTubeChannel(url) : null;
        const fetchedAt = tier1 || tier2 ? new Date().toISOString() : undefined;
        return { url, fetched: { tier1, tier2, brand, channel, fetchedOn: today, fetchedAt } };
    } catch (error) {
        console.warn(`Cite Wide: enriching ${url} failed.`, error);
        return { url, fetched: empty };
    }
}

export interface PlanOptions {
    folder: string;
    /** YYYY-MM-DD, for date_recently_accessed. */
    today: string;
    concurrency?: number;
    /** Set `cancelled` to stop before the review step. */
    signal: { cancelled: boolean };
    onProgress?: (done: number, total: number) => void;
}

/**
 * Plan every target: index usage once, fetch with a small worker pool, plan.
 * Returns null when cancelled. Writes nothing.
 */
export async function planEnrichment(app: App, targets: readonly CitationTarget[], options: PlanOptions): Promise<CitationPlan[] | null> {
    const index = buildUsageIndex(await readVaultNotes(app, options.folder), options.folder);
    const plans: CitationPlan[] = new Array<CitationPlan>(targets.length);
    let next = 0;
    let done = 0;
    options.onProgress?.(0, targets.length);

    const worker = async (): Promise<void> => {
        while (!options.signal.cancelled && next < targets.length) {
            const i = next++;
            const target = targets[i];
            if (!target) continue;
            const current = frontmatterOf(app, target.file);
            const usage = index.get(target.hexId);
            const { url, fetched } = await fetchCitation(current, usage, options.today);
            plans[i] = {
                hexId: target.hexId,
                path: target.file.path,
                url,
                tier1Ok: fetched.tier1 !== null,
                tier2Ok: fetched.tier2 !== null,
                usage,
                current,
                changes: planCitationChanges(current, fetched, usage, obsidianLinker(app, target.file.path)),
            };
            options.onProgress?.(++done, targets.length);
        }
    };
    const workers = Math.max(1, Math.min(options.concurrency ?? ENRICH_CONCURRENCY, targets.length));
    await Promise.all(Array.from({ length: workers }, () => worker()));
    return options.signal.cancelled ? null : plans.filter((p): p is CitationPlan => p !== undefined);
}

/** Write the approved plans. Returns the changes actually applied, by path. */
export async function applyEnrichment(app: App, approved: readonly CitationPlan[]): Promise<Map<string, FieldChange[]>> {
    const applied = new Map<string, FieldChange[]>();
    for (const plan of approved) {
        const file = app.vault.getAbstractFileByPath(plan.path);
        if (!(file instanceof TFile)) continue;
        try {
            await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                applied.set(plan.path, applyFieldChanges(fm, plan.changes));
            });
        } catch (error) {
            console.error(`Cite Wide: could not update ${plan.path}.`, error);
        }
    }
    return applied;
}

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

/** { display: "2026-10-06 14:05", stamp: "2026-10-06-1405", day: "2026-10-06" } in local time. */
export function runTimestamps(d: Date = new Date()): { display: string; stamp: string; day: string } {
    const day = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    return { day, display: `${day} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`, stamp: `${day}-${pad2(d.getHours())}${pad2(d.getMinutes())}` };
}

/** Save the report to <folder>/_reports/Enrichment-<stamp>.md, never over an existing one. */
export async function writeEnrichmentReport(app: App, folder: string, stamp: string, markdown: string): Promise<TFile> {
    const dir = normalizePath(`${folder}/_reports`);
    if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
    let path = `${dir}/Enrichment-${stamp}.md`;
    for (let n = 2; app.vault.getAbstractFileByPath(path); n++) path = `${dir}/Enrichment-${stamp}-${n}.md`;
    return app.vault.create(path, markdown);
}
