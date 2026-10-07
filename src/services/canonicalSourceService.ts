// "Promote to canonical source" — the logic behind the command, kept free
// of editor and modal code so it is unit-testable under Node.
//
// Spec:   context-v/specs/Promote-to-Canonical-Source.md
// Schema: context-v/blueprints/Lossless-Citation-Standards.md
//
// Flow: parse the footnote → tier 1 (<meta> tags, directFetchService) →
// tier 2 (Jina Reader, only when tier 1 left title or authors empty) →
// prefill the modal → on Promote, capture the file and text, then upgrade
// Citations/<id>.md in place via processFrontMatter.

import { requestUrl, TFile, type App } from 'obsidian';
import { asNumber, asString, asStringArray } from '../utils/coerce';
import { fetchDirectOpenGraph, headerValue, type BrandAssets, type DirectFetchResult } from './directFetchService';
import { urlCitationService } from './urlCitationService';

export const PUBLICATION_TYPES = ['book', 'report', 'paper', 'article', 'web page', 'video', 'other'] as const;
export type PublicationType = typeof PUBLICATION_TYPES[number];

export function isPublicationType(v: unknown): v is PublicationType {
    return typeof v === 'string' && (PUBLICATION_TYPES as readonly string[]).includes(v);
}

/** The values the modal shows and the user confirms. */
export interface CanonicalForm {
    title: string;
    subtitle: string;
    authors: string[];
    datePublished: string;
    publisher: string;
    publicationType: PublicationType;
    url: string;
}

export interface ParsedFootnote {
    hexId: string | undefined;
    /** The footnote text after `[^id]:`. */
    referenceText: string;
    title: string | undefined;
    url: string | undefined;
    /** Partial ISO: YYYY, YYYY-MM, or YYYY-MM-DD. */
    datePublished: string | undefined;
    authors: string[];
    /** Sentence segments after the title, minus any "Accessed …" segment. */
    trailingSegments: string[];
    publisher: string | undefined;
}

/** Metadata from tier 2, Jina Reader. */
export interface Tier2Meta {
    title: string | undefined;
    authors: string[];
    datePublished: string | undefined;
    publisher: string | undefined;
}

// --- Footnote parsing ----------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?';
const DATE_PATTERNS: RegExp[] = [
    /\b\d{4}-\d{2}(?:-\d{2})?(?:T[\d:.]+Z?)?\b/,
    /\b\d{4}\/\d{1,2}(?:\/\d{1,2})?\b/,
    new RegExp(`\\b\\d{4},?\\s+${MONTH}(?:\\s+\\d{1,2}\\b)?`, 'i'),
    new RegExp(`\\b${MONTH}\\s+(?:\\d{1,2},?\\s+)?\\d{4}\\b`, 'i'),
    /\b(?:1[5-9]|20)\d{2}\b/,
];

function pad2(n: string | number): string {
    return String(n).padStart(2, '0');
}

function monthNumber(name: string): string | undefined {
    const i = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
    return i >= 0 ? pad2(i + 1) : undefined;
}

/**
 * Normalize a free-form date to partial ISO 8601 (YYYY, YYYY-MM, or
 * YYYY-MM-DD). Returns undefined when nothing date-like is found.
 */
export function normalizeDatePublished(raw: string): string | undefined {
    const s = raw.trim();
    let m = s.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
    if (m && m[1] && m[2]) return m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
    m = s.match(/(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?/);
    if (m && m[1] && m[2]) return m[3] ? `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` : `${m[1]}-${pad2(m[2])}`;
    m = s.match(new RegExp(`(\\d{4}),?\\s+${MONTH}(?:\\s+(\\d{1,2})\\b)?`, 'i'));
    if (m && m[1] && m[2]) {
        const month = monthNumber(m[2]);
        if (month) return m[3] ? `${m[1]}-${month}-${pad2(m[3])}` : `${m[1]}-${month}`;
    }
    m = s.match(new RegExp(`${MONTH}\\s+(?:(\\d{1,2}),?\\s+)?(\\d{4})`, 'i'));
    if (m && m[1] && m[3]) {
        const month = monthNumber(m[1]);
        if (month) return m[2] ? `${m[3]}-${month}-${pad2(m[2])}` : `${m[3]}-${month}`;
    }
    m = s.match(/\b(\d{4})\b/);
    if (m && m[1]) return m[1];
    return undefined;
}

function findDate(text: string): { date: string; rest: string } | undefined {
    for (const pattern of DATE_PATTERNS) {
        const m = pattern.exec(text);
        if (!m) continue;
        const date = normalizeDatePublished(m[0]);
        if (!date) continue;
        return { date, rest: text.slice(0, m.index) + text.slice(m.index + m[0].length) };
    }
    return undefined;
}

function trimSegment(s: string): string {
    return s
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^[\s.,;:"'“”]+|[\s.,;:"'“”]+$/g, '');
}

/** Split on sentence periods, but not after a single-capital initial ("M."). */
function sentenceSegments(text: string): string[] {
    return text
        .split(/(?<!\b[A-Z])\.(?=\s|$)/)
        .map(trimSegment)
        .filter(s => s.length > 0 && !/^accessed\b/i.test(s));
}

/**
 * Split an author segment into names. `;`, "and", and "&" always separate.
 * Commas separate only when every part is a multi-word name, so
 * "Thiel, Peter" stays one author while "Peter Thiel, Blake Masters" is two.
 */
export function splitAuthors(segment: string): string[] {
    const s = segment.replace(/^by\s+/i, '').trim();
    if (!s) return [];
    const parts = s.includes(';') ? s.split(';') : s.split(/\s+(?:and|&)\s+/i);
    const out: string[] = [];
    for (const part of parts) {
        const commaParts = part.split(',').map(p => p.trim()).filter(Boolean);
        if (commaParts.length > 1 && commaParts.every(p => p.split(/\s+/).length > 1)) out.push(...commaParts);
        else if (part.trim()) out.push(part.trim());
    }
    return out;
}

function stripTitleQuotes(s: string): string {
    return s.trim().replace(/^["“'‘]+|["”'’]+$/g, '').trim();
}

function isUrl(s: string): boolean {
    return /^https?:\/\/\S+$/i.test(s.trim());
}

function hostLabels(url: string | undefined): string[] {
    if (!url) return [];
    try {
        const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
        return [host, host.split('.')[0] ?? host];
    } catch {
        return [];
    }
}

/**
 * Parse a footnote definition line. Recognizes Lossless house style
 * (`date. Authors. [Title](url). Publisher.`), quoted titles, "by" authorship,
 * and bare URLs. Fields it cannot find are left undefined / empty.
 */
export function parseFootnote(line: string): ParsedFootnote {
    const def = line.match(/^\s*\[\^([a-z0-9]+)\]:\s*(.*)$/i);
    const body = (def ? def[2] ?? '' : line).trim();
    const result: ParsedFootnote = {
        hexId: def?.[1],
        referenceText: body,
        title: undefined,
        url: undefined,
        datePublished: undefined,
        authors: [],
        trailingSegments: [],
        publisher: undefined,
    };

    let prefix = '';
    let suffix = '';
    const link = /"?\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)"?/.exec(body);
    const quoted = /"([^"]+)"|“([^”]+)”/.exec(body);
    if (link) {
        result.title = stripTitleQuotes(link[1] ?? '').replace(/\s+\|\s+[^|]+$/, '') || undefined;
        result.url = link[2];
        prefix = body.slice(0, link.index);
        suffix = body.slice(link.index + link[0].length);
    } else if (quoted) {
        const inner = (quoted[1] ?? quoted[2] ?? '').trim();
        if (isUrl(inner)) {
            result.url = inner;
        } else {
            result.title = stripTitleQuotes(inner) || undefined;
            prefix = body.slice(0, quoted.index);
            suffix = body.slice(quoted.index + quoted[0].length);
        }
    }
    if (!result.url) {
        const bare = body.match(/https?:\/\/[^\s)>\]"]+/);
        if (bare) result.url = bare[0].replace(/[.,;:'"]+$/, '');
    }
    // Without a title there is no anchor to tell authors from publisher;
    // only the date and URL are trustworthy.
    if (!result.title) {
        const noUrl = result.url ? body.replace(result.url, '') : body;
        result.datePublished = findDate(noUrl)?.date;
        return result;
    }

    const inPrefix = findDate(prefix);
    if (inPrefix) {
        result.datePublished = inPrefix.date;
        prefix = inPrefix.rest;
    } else {
        const inSuffix = findDate(suffix);
        if (inSuffix) {
            result.datePublished = inSuffix.date;
            suffix = inSuffix.rest;
        }
    }

    for (const segment of sentenceSegments(prefix)) result.authors.push(...splitAuthors(segment));

    result.trailingSegments = sentenceSegments(suffix);
    const hosts = hostLabels(result.url);
    const publisherCandidates: string[] = [];
    for (const segment of result.trailingSegments) {
        if (/^by\s+/i.test(segment)) {
            result.authors.push(...splitAuthors(segment));
            continue;
        }
        // The hosting site (Scribd for a report hosted on scribd.com) is not
        // the publisher; skip a segment that just names the URL's host.
        const key = segment.toLowerCase().replace(/\s+/g, '');
        if (hosts.includes(key)) continue;
        publisherCandidates.push(segment);
    }
    result.publisher = publisherCandidates[publisherCandidates.length - 1];
    return result;
}

// --- Cursor lookup -------------------------------------------------------

/**
 * The citation ID under the cursor: any position on a `[^id]:` definition
 * line, or a position inside (or at either edge of) an inline `[^id]`.
 */
export function findCitationIdAtCursor(line: string, ch: number): string | null {
    const def = line.match(/^\s*\[\^([a-z0-9]+)\]:/);
    if (def && def[1]) return def[1];
    const inline = /\[\^([a-z0-9]+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = inline.exec(line)) !== null) {
        if (ch >= m.index && ch <= m.index + m[0].length && m[1]) return m[1];
    }
    return null;
}

export function findFootnoteDefinition(content: string, hexId: string): string | null {
    const prefix = `[^${hexId}]:`;
    for (const line of content.split('\n')) {
        if (line.trimStart().startsWith(prefix)) return line;
    }
    return null;
}

// --- Helpers -------------------------------------------------------------

export function toKebabSlug(title: string): string {
    return title
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** The URL's site root, e.g. `https://www.scribd.com`. */
export function siteRoot(url: string): string | undefined {
    try {
        const u = new URL(url);
        return u.protocol.startsWith('http') ? u.origin : undefined;
    } catch {
        return undefined;
    }
}

const DOCUMENT_TYPES: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/epub+zip': 'epub',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

/**
 * The file extension to save a downloadable document under, judged by its
 * content type or, failing that, the URL path. Null for anything else.
 */
export function documentExtension(url: string, contentType: string | undefined): string | null {
    const type = contentType?.split(';')[0]?.trim().toLowerCase();
    if (type && DOCUMENT_TYPES[type]) return DOCUMENT_TYPES[type] ?? null;
    try {
        const m = new URL(url).pathname.match(/\.(pdf|epub|docx|pptx|xlsx)$/i);
        return m && m[1] ? m[1].toLowerCase() : null;
    } catch {
        return null;
    }
}

/** A frontmatter date-ish value as YYYY-MM-DD text, whatever YAML made of it. */
function asDateText(v: unknown): string | undefined {
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
    return asString(v) || undefined;
}

function firstText(...values: (string | undefined)[]): string | undefined {
    for (const v of values) {
        const t = v?.trim();
        if (t) return t;
    }
    return undefined;
}

function firstList(...lists: string[][]): string[] {
    for (const list of lists) {
        const clean = list.map(s => s.trim()).filter(Boolean);
        if (clean.length > 0) return clean;
    }
    return [];
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    let timer: number | undefined;
    const timeout = new Promise<T>(resolve => {
        timer = window.setTimeout(() => resolve(fallback), ms);
    });
    return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

// --- Tiers ---------------------------------------------------------------

export const FETCH_TIMEOUT_MS = 10_000;

/** Tier 1: one GET, parsed for <meta> tags. Null on failure or timeout. */
// Titles of bot-check and access-denied interstitials. When a site serves one
// of these instead of the page (Scribd returns "Client Challenge"), its
// <title> must not be mistaken for the source's title.
const BLOCKED_PAGE_TITLES = [
    /^client challenge$/i,
    /^just a moment\.*$/i,
    /^attention required!?( \| cloudflare)?$/i,
    /^access denied$/i,
    /^403 forbidden$/i,
    /^are you a robot\??$/i,
    /^verify(ing)? you are human/i,
    /^security check/i,
    /^captcha/i,
];

export function isBlockedPage(result: DirectFetchResult): boolean {
    const title = result.title.trim();
    return BLOCKED_PAGE_TITLES.some(re => re.test(title));
}

export function fetchTier1(url: string, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<DirectFetchResult | null> {
    const attempt = fetchDirectOpenGraph(url)
        .then(result => {
            if (!isBlockedPage(result)) return result;
            console.warn(`Cite Wide: ${url} served a bot-check page ("${result.title}"); treating the metadata fetch as failed.`);
            return null;
        })
        .catch((error: unknown) => {
            console.warn('Cite Wide: metadata fetch failed, using the footnote instead.', error);
            return null;
        });
    return withTimeout<DirectFetchResult | null>(attempt, timeoutMs, null);
}

/** Tier 2 runs only when tier 1 left the title or the authors empty. */
export function needsTier2(tier1: DirectFetchResult | null): boolean {
    return !tier1 || !tier1.title.trim() || tier1.authors.length === 0;
}

/**
 * The publisher's brand assets need the homepage when the source page can't
 * supply them: the fetch failed or hit a bot-check, the source is a document
 * (a PDF has no <head>), or the page declared neither an app icon nor a logo.
 */
export function needsPublisherBrand(tier1: DirectFetchResult | null, url: string | undefined): boolean {
    if (!url) return false;
    const root = siteRoot(url);
    if (!root || root === url.replace(/\/$/, '')) return false;
    return !tier1 || !!documentExtension(url, tier1.contentType) || (!tier1.brand.appIcon && !tier1.brand.logo);
}

/** Brand assets from the publisher's homepage. Null on failure, timeout, or a bot-check. */
export async function fetchPublisherBrand(url: string, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<BrandAssets | null> {
    const root = siteRoot(url);
    if (!root) return null;
    const home = await fetchTier1(root, timeoutMs);
    return home?.brand ?? null;
}

/** Page-level assets win; the homepage fills what the page left empty. */
export function mergeBrand(page: BrandAssets | undefined, home: BrandAssets | null): BrandAssets | undefined {
    if (!page) return home ?? undefined;
    if (!home) return page;
    return {
        // A page with no <link rel="icon"> falls back to /favicon.ico on its own host; prefer the homepage's declared icon.
        favicon: page.favicon.endsWith('/favicon.ico') ? home.favicon : page.favicon,
        appIcon: page.appIcon ?? home.appIcon,
        logo: page.logo ?? home.logo,
        maskIcon: page.maskIcon ?? home.maskIcon,
        maskIconColor: page.maskIconColor ?? home.maskIconColor,
        brandColor: page.brandColor ?? home.brandColor,
        webManifest: page.webManifest ?? home.webManifest,
    };
}

/** Tier 2: Jina Reader's metadata. Null on failure or timeout. */
export async function fetchTier2(url: string, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<Tier2Meta | null> {
    const reader = await withTimeout(urlCitationService.fetchReader(url), timeoutMs, null);
    if (!reader) return null;
    return {
        title: reader.title,
        authors: reader.author ? splitAuthors(reader.author) : [],
        datePublished: reader.publishedTime,
        publisher: reader.siteName,
    };
}

function guessPublicationType(tier1: DirectFetchResult | null, url: string | undefined): PublicationType {
    if (tier1?.scholarly) return 'paper';
    if (url && documentExtension(url, tier1?.contentType)) return 'report';
    const og = tier1?.type.toLowerCase() ?? '';
    if (og === 'book' || og.startsWith('books.')) return 'book';
    if (og.startsWith('video')) return 'video';
    if (og === 'article') return 'article';
    return url ? 'web page' : 'other';
}

export interface PrefillInput {
    parsed: ParsedFootnote | null;
    /** The current frontmatter of Citations/<id>.md, or {} when absent. */
    existing: Record<string, unknown>;
    tier1: DirectFetchResult | null;
    tier2: Tier2Meta | null;
}

/**
 * The modal's starting values. Precedence, per field:
 *   stored canonical values (a re-promote shows the user's earlier edits)
 *   → scholarly citation_* tags (authoritative bibliographic data)
 *   → the footnote (curated by a person)
 *   → generic tier-1 tags (og:title is often decorated, e.g. "… | PDF")
 *   → tier 2, Jina Reader
 *   → the light file's own fields.
 */
export function buildPrefill({ parsed, existing, tier1, tier2 }: PrefillInput): CanonicalForm {
    const canon = existing['canonical'] === true;
    const stored = (key: string): string | undefined => (canon ? asString(existing[key]) : undefined);
    const scholarly = tier1?.scholarly === true;
    const lightAuthor = asString(existing['author']);

    const url = firstText(stored('url'), parsed?.url, asString(existing['url']), asString(existing['first_accessed_at_url'])) ?? '';
    const date = firstText(
        stored('date_published'),
        scholarly ? tier1?.published : undefined,
        parsed?.datePublished,
        tier1?.published,
        tier2?.datePublished,
        asDateText(existing['date']),
    );
    const storedType = existing['publication_type'];

    return {
        title: firstText(stored('title'), tier1?.citationTitle, parsed?.title, tier1?.title, tier2?.title, asString(existing['title'])) ?? '',
        subtitle: stored('subtitle') ?? '',
        authors: firstList(
            canon ? asStringArray(existing['authors']) : [],
            scholarly ? tier1?.authors ?? [] : [],
            parsed?.authors ?? [],
            tier1?.authors ?? [],
            tier2?.authors ?? [],
            lightAuthor ? splitAuthors(lightAuthor) : [],
        ),
        datePublished: date ? normalizeDatePublished(date) ?? date : '',
        publisher: firstText(
            stored('publisher'),
            tier1?.citationPublisher,
            parsed?.publisher,
            tier1?.siteName,
            tier2?.publisher,
            asString(existing['source']),
        ) ?? '',
        publicationType: canon && isPublicationType(storedType) ? storedType : guessPublicationType(tier1, url || undefined),
        url,
    };
}

// --- Field assembly ------------------------------------------------------

export interface AssembleContext {
    hexId: string;
    form: CanonicalForm;
    /** Tier-1 result; null when the fetch failed or there was no URL. */
    fetched: DirectFetchResult | null;
    /** Publisher brand assets; defaults to the tier-1 page's own. */
    brand?: BrandAssets | undefined;
    /** Today, YYYY-MM-DD. */
    today: string;
    newUuid: () => string;
    sourceFile?: string | undefined;
    referenceText?: string | undefined;
    /** ISO timestamp for created / lastModified. */
    now?: string | undefined;
    downloadedContentPath?: string | undefined;
    sourceTextPath?: string | undefined;
}

/**
 * The full frontmatter for a canonical citation, given the current one.
 * Keeps every light-format key; write-once fields (internal_uuid,
 * first_accessed_at_url, date_added) keep their stored values; the modal's
 * values are written as-is, so the user's edits win over fetched ones.
 */
export function assembleCanonicalFrontmatter(existing: Record<string, unknown>, ctx: AssembleContext): Record<string, unknown> {
    const fm: Record<string, unknown> = { ...existing };
    const { form, fetched, hexId } = ctx;
    const now = ctx.now ?? new Date().toISOString();
    const url = form.url.trim();
    const title = form.title.trim();
    const authors = form.authors.map(a => a.trim()).filter(Boolean);
    const rawDate = form.datePublished.trim();
    const datePublished = rawDate ? normalizeDatePublished(rawDate) ?? rawDate : '';
    const publisher = form.publisher.trim();

    const setOrDrop = (key: string, value: string | undefined): void => {
        if (value) fm[key] = value;
        else delete fm[key];
    };
    const fillIfEmpty = (key: string, value: string): void => {
        if (!asString(fm[key]) && value) fm[key] = value;
    };

    // Light-format keys, so Dataview queries over Citations/ keep working.
    fm['hexId'] = asString(existing['hexId']) || hexId;
    if (title) fm['title'] = title;
    if (url) fm['url'] = url;
    else if (!('url' in fm)) fm['url'] = '';
    fillIfEmpty('author', authors.join(', '));
    fillIfEmpty('date', datePublished);
    fillIfEmpty('source', publisher);
    if (!('tags' in fm)) fm['tags'] = [];
    fm['created'] = asDateText(existing['created']) ?? now;
    fm['lastModified'] = now;
    fm['referenceText'] = asString(existing['referenceText']) || ctx.referenceText || '';
    fm['usageCount'] = asNumber(existing['usageCount']) ?? 1;
    const files = asStringArray(existing['filesUsedIn']);
    if (ctx.sourceFile && !files.includes(ctx.sourceFile)) files.push(ctx.sourceFile);
    fm['filesUsedIn'] = files;

    // Canonical schema (Lossless-Citation-Standards.md).
    fm['canonical'] = true;
    fm['internal_uuid'] = asString(existing['internal_uuid']) || ctx.newUuid();
    fm['reference_hexcode'] = hexId;
    setOrDrop('default_slug', toKebabSlug(title));
    setOrDrop('subtitle', form.subtitle.trim());
    fm['authors'] = authors;
    setOrDrop('date_published', datePublished);
    setOrDrop('publisher', publisher);
    setOrDrop('publisher_url', url ? siteRoot(url) : undefined);
    fm['publication_type'] = form.publicationType;
    setOrDrop('first_accessed_at_url', asString(existing['first_accessed_at_url']) || url);
    fm['date_added'] = asDateText(existing['date_added']) ?? ctx.today;
    if (fetched) fm['date_recently_accessed'] = ctx.today;
    if (fetched?.image) fm['piece_og_image'] = fetched.image;
    // Publisher brand assets: refreshed whenever they were fetched, never blanked.
    const brand = ctx.brand ?? fetched?.brand;
    const assets: Array<[string, string | undefined]> = [
        ['publisher_favicon_url', brand?.favicon || fetched?.favicon],
        ['publisher_app_icon_url', brand?.appIcon],
        ['publisher_logo_url', brand?.logo],
        ['publisher_mask_icon_url', brand?.maskIcon],
        ['publisher_mask_icon_color', brand?.maskIconColor],
        ['publisher_brand_color', brand?.brandColor],
        ['publisher_web_manifest_url', brand?.webManifest],
    ];
    for (const [key, value] of assets) if (value) fm[key] = value;
    if (ctx.downloadedContentPath) fm['downloaded_content_path'] = ctx.downloadedContentPath;
    if (ctx.sourceTextPath) fm['source_text_path'] = ctx.sourceTextPath;
    // A separate array, so the YAML writer doesn't emit an anchor/alias pair.
    fm['cited_in_files'] = [...files];
    return fm;
}

// --- Promote: capture content and write the citation file ----------------

export const DOWNLOAD_TIMEOUT_MS = 60_000;

export interface PromoteArgs {
    folder: string;
    hexId: string;
    form: CanonicalForm;
    /** The modal's "capture the source file and text" checkbox. */
    capture: boolean;
    tier1: DirectFetchResult | null;
    /** Publisher brand assets (page, filled in from the homepage when needed). */
    brand?: BrandAssets | undefined;
    sourceFile?: string | undefined;
    referenceText?: string | undefined;
    today: string;
    now?: string | undefined;
    newUuid?: (() => string) | undefined;
}

export interface PromoteResult {
    file: TFile;
    downloadedContentPath: string | undefined;
    sourceTextPath: string | undefined;
    /** Why the text import was skipped, when it was attempted and failed. */
    textError: string | undefined;
    /** Why the file download failed, when one was attempted. */
    fileError: string | undefined;
}

async function ensureFolder(app: App, path: string): Promise<void> {
    if (!app.vault.getAbstractFileByPath(path)) await app.vault.createFolder(path);
}

async function writeText(app: App, path: string, text: string): Promise<void> {
    const existing = app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await app.vault.modify(existing, text);
    else await app.vault.create(path, text);
}

async function writeBinary(app: App, path: string, bytes: ArrayBuffer): Promise<void> {
    const existing = app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await app.vault.modifyBinary(existing, bytes);
    else await app.vault.createBinary(path, bytes);
}

async function downloadDocument(app: App, args: PromoteArgs, url: string, ext: string): Promise<string> {
    const get = requestUrl({ url, method: 'GET', throw: false });
    const res = await withTimeout(get, DOWNLOAD_TIMEOUT_MS, null);
    if (!res) throw new Error('the download timed out');
    if (res.status >= 400) throw new Error(`the server answered ${res.status}`);
    const finalExt = documentExtension(url, headerValue(res.headers, 'content-type')) ?? ext;
    const dir = `${args.folder}/_files`;
    await ensureFolder(app, dir);
    const path = `${dir}/${args.hexId}.${finalExt}`;
    await writeBinary(app, path, res.arrayBuffer);
    return path;
}

function sourceTextNote(args: PromoteArgs, url: string, content: string): string {
    const label = args.form.title.replace(/[[\]|]/g, '').trim();
    const link = label ? `[[${args.folder}/${args.hexId}|${label}]]` : `[[${args.folder}/${args.hexId}]]`;
    return `Source text for ${link}, imported with Jina Reader from <${url}> on ${args.today}.\n\n---\n\n${content.trim()}\n`;
}

function citationBody(args: PromoteArgs): string {
    const title = args.form.title.trim() || `Citation ${args.hexId}`;
    const reference = args.referenceText ? `## Reference\n\n${args.referenceText}\n\n` : '';
    return `# ${title}\n\n${reference}## Notes\n\n`;
}

/**
 * Capture the source (when asked and there is a URL), then create or upgrade
 * Citations/<id>.md. A failed download or text import never blocks the
 * promotion; the result says what was skipped.
 */
export async function promoteCanonicalSource(app: App, args: PromoteArgs): Promise<PromoteResult> {
    const url = args.form.url.trim();
    let downloadedContentPath: string | undefined;
    let sourceTextPath: string | undefined;
    let textError: string | undefined;
    let fileError: string | undefined;

    await ensureFolder(app, args.folder);

    if (args.capture && url) {
        const ext = documentExtension(url, args.tier1?.contentType);
        if (ext) {
            try {
                downloadedContentPath = await downloadDocument(app, args, url, ext);
            } catch (error) {
                fileError = error instanceof Error ? error.message : String(error);
            }
        }

        const reader = await withTimeout(urlCitationService.fetchReader(url), DOWNLOAD_TIMEOUT_MS, null);
        if (reader?.content?.trim()) {
            const dir = `${args.folder}/_text`;
            await ensureFolder(app, dir);
            sourceTextPath = `${dir}/${args.hexId}.md`;
            await writeText(app, sourceTextPath, sourceTextNote(args, url, reader.content));
        } else {
            textError = reader ? 'Jina Reader returned no text' : 'Jina Reader was unavailable';
        }
    }

    const path = `${args.folder}/${args.hexId}.md`;
    const found = app.vault.getAbstractFileByPath(path);
    const file = found instanceof TFile ? found : await app.vault.create(path, citationBody(args));

    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        const next = assembleCanonicalFrontmatter(fm, {
            hexId: args.hexId,
            form: args.form,
            fetched: args.tier1,
            brand: args.brand,
            today: args.today,
            now: args.now,
            newUuid: args.newUuid ?? (() => crypto.randomUUID()),
            sourceFile: args.sourceFile,
            referenceText: args.referenceText,
            downloadedContentPath,
            sourceTextPath,
        });
        for (const key of Object.keys(fm)) if (!(key in next)) delete fm[key];
        Object.assign(fm, next);
    });

    return { file, downloadedContentPath, sourceTextPath, textError, fileError };
}
