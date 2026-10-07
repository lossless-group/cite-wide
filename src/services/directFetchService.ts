// Tier 1 of "Promote to canonical source": a dependency-free <meta> tag
// extractor.
//
// Ported from Metafetch (The Lossless Group's OpenGraph plugin),
// src/services/directFetchService.ts. This is a COPY, not an import: each
// Lossless plugin ships standalone. Changes from the original:
//   - returns cite-wide's DirectFetchResult instead of Metafetch's
//     OpenGraphData, adding citationTitle, citationPublisher, the
//     `scholarly` flag, and the response content type;
//   - the HTML parsing is split out as parseDirectFetchHtml() so it is
//     testable without a network;
//   - a document response (PDF, EPUB, Office) is not parsed as HTML;
//   - 4-space indentation and noUncheckedIndexedAccess-safe callbacks.

import { requestUrl } from 'obsidian';
import { isPlausibleAuthor } from '../utils/authorNames';

export interface DirectFetchResult {
    /** og:title, then twitter:title, citation_title, <title>; '' when none. */
    title: string;
    citationTitle: string | undefined;
    citationPublisher: string | undefined;
    description: string;
    image: string | undefined;
    favicon: string;
    url: string;
    type: string;
    siteName: string;
    /** Tiered, first non-empty wins: citation_author, author, article:author. */
    authors: string[];
    /** Highwire slash dates normalized; ISO timestamps passed through. */
    published: string | undefined;
    /** True when the page carries scholarly citation_title / citation_author tags. */
    scholarly: boolean;
    /** The response's content-type header, when the fetch provided one. */
    contentType: string | undefined;
    /** Publisher brand assets declared by the page. */
    brand: BrandAssets;
}

/**
 * A publisher's brand assets, as URLs. Each is what a site declares for a
 * specific job, so they are kept apart rather than collapsed into "the icon":
 * the favicon is tiny and often a letterform, the app icon is the square
 * home-screen mark, the logo is the trademark/wordmark, and the mask icon is
 * the single-color SVG Safari uses for pinned tabs.
 */
export interface BrandAssets {
    /** <link rel="icon">, preferring SVG, then the largest PNG up to 96 px; else /favicon.ico. */
    favicon: string;
    /** Largest apple-touch-icon, else msapplication-TileImage, else the largest icon ≥ 120 px. */
    appIcon: string | undefined;
    /** The trademark/wordmark: JSON-LD Organization or publisher `logo`, else og:logo, else itemprop="logo". */
    logo: string | undefined;
    /** <link rel="mask-icon">: a single-color SVG of the mark. */
    maskIcon: string | undefined;
    /** The mask icon's declared color. */
    maskIconColor: string | undefined;
    /** <meta name="theme-color">, else msapplication-TileColor. */
    brandColor: string | undefined;
    /** <link rel="manifest">: the web app manifest, which lists more icons. */
    webManifest: string | undefined;
}

export type ParsedHtmlMeta = Omit<DirectFetchResult, 'contentType'>;

export class DirectFetchError extends Error {
    constructor(message: string, public readonly code: string) {
        super(message);
        this.name = 'DirectFetchError';
    }
}

// Named entities seen in titles and descriptions. The numeric forms are
// decoded generically below.
const NAMED_ENTITIES: Record<string, string> = {
    rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201D', ldquo: '\u201C', sbquo: '\u201A', bdquo: '\u201E',
    mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', middot: '\u00B7', bull: '\u2022',
    copy: '\u00A9', reg: '\u00AE', trade: '\u2122', deg: '\u00B0', times: '\u00D7',
    laquo: '\u00AB', raquo: '\u00BB', euro: '\u20AC', pound: '\u00A3', yen: '\u00A5', cent: '\u00A2',
    eacute: '\u00E9', egrave: '\u00E8', aacute: '\u00E1', agrave: '\u00E0', iacute: '\u00ED', oacute: '\u00F3',
    uacute: '\u00FA', ntilde: '\u00F1', ccedil: '\u00E7', uuml: '\u00FC', ouml: '\u00F6', auml: '\u00E4', szlig: '\u00DF',
};

function decodeEntities(s: string): string {
    return s
        .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_m, n: string) => String.fromCharCode(parseInt(n, 16)));
}

/**
 * Every value for a meta tag, de-duplicated.
 *
 * Scholarly pages repeat tags: arXiv emits one `citation_author` per author.
 * A single-value lookup would return the first and silently drop the rest,
 * which is how a five-author paper became a one-author note.
 */
export function getMetaAll(
    html: string,
    attrName: 'property' | 'name',
    attrValue: string
): string[] {
    // Read each <meta> tag's attributes, quote-aware and in document order.
    // The ported pattern matched content=["']([^"']*)["'], so a double-quoted
    // value containing an apostrophe was cut short: content="Kyle O'Brien"
    // came back as "Kyle O". It also returned name-first tags before
    // content-first ones, scrambling multi-author order.
    const want = attrValue.toLowerCase();
    const values: string[] = [];
    for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
        const tag = m[0];
        if ((attr(tag, attrName) ?? '').toLowerCase() !== want) continue;
        const content = attr(tag, 'content');
        if (content) values.push(content);
    }
    return [...new Set(values)];
}

function getMeta(html: string, attrName: 'property' | 'name', attrValue: string): string | null {
    return getMetaAll(html, attrName, attrValue)[0] ?? null;
}

/**
 * Flips `"Dennis, Simon"` into `"Simon Dennis"`.
 *
 * Highwire `citation_author` is conventionally Last, First, while the
 * canonical schema lists authors as "FirstName LastName". Left alone when the
 * tail looks like a credential or generational suffix, so "Jane Doe, PhD"
 * doesn't become "PhD Jane Doe".
 */
export function normalizeAuthorName(raw: string): string {
    const parts = raw.split(',');
    if (parts.length !== 2) return raw.trim();

    const last = (parts[0] ?? '').trim();
    const first = (parts[1] ?? '').trim();
    if (!last || !first) return raw.trim();
    if (/^(ph\.?\s?d|m\.?\s?d|j\.?\s?d|jr|sr|i{1,3}|iv|esq|m\.?b\.?a)\.?$/i.test(first)) {
        return raw.trim();
    }
    return `${first} ${last}`;
}

/**
 * Highwire dates are slash-separated (`2026/04/30`, sometimes `2026/4/30`, and
 * occasionally year-month only). Everything else — notably the ISO timestamps
 * `article:published_time` emits — passes through untouched.
 */
export function normalizeDate(raw: string): string {
    const value = raw.trim();
    const match = value.match(/^(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?$/);
    if (!match) return value;

    const [, year, month, day] = match;
    const paddedMonth = (month ?? '').padStart(2, '0');
    return day ? `${year}-${paddedMonth}-${day.padStart(2, '0')}` : `${year}-${paddedMonth}`;
}

/** Returns the first list that has anything in it. */
function firstNonEmpty(...candidates: string[][]): string[] {
    for (const list of candidates) {
        if (list.length > 0) return list;
    }
    return [];
}

function getTitleTag(html: string): string | null {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m && m[1] ? decodeEntities(m[1]).trim() : null;
}

function resolveAgainstBase(href: string, baseUrl: string): string {
    try {
        return new URL(href, baseUrl).href;
    } catch {
        return href;
    }
}

interface LinkTag {
    rel: string[];
    href: string;
    sizes: number;
    type: string;
    color: string | undefined;
    itemprop: string | undefined;
}

function attr(tag: string, name: string): string | undefined {
    const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    const v = m ? (m[1] ?? m[2] ?? m[3]) : undefined;
    return v === undefined ? undefined : decodeEntities(v).trim();
}

/** Largest dimension in a `sizes` attribute ("180x180", "16x16 32x32", "any"). */
function largestSize(sizes: string | undefined): number {
    if (!sizes) return 0;
    if (/\bany\b/i.test(sizes)) return Number.MAX_SAFE_INTEGER;
    let max = 0;
    for (const m of sizes.matchAll(/(\d+)x(\d+)/gi)) max = Math.max(max, Number(m[1]), Number(m[2]));
    return max;
}

function linkTags(html: string, baseUrl: string): LinkTag[] {
    const out: LinkTag[] = [];
    for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
        const tag = m[0];
        const href = attr(tag, 'href');
        if (!href) continue;
        out.push({
            rel: (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean),
            href: resolveAgainstBase(href, baseUrl),
            sizes: largestSize(attr(tag, 'sizes')),
            type: (attr(tag, 'type') ?? '').toLowerCase(),
            color: attr(tag, 'color'),
            itemprop: attr(tag, 'itemprop'),
        });
    }
    return out;
}

/** Every JSON-LD node on the page, flattened through @graph and arrays. */
function jsonLdNodes(html: string): Record<string, unknown>[] {
    const nodes: Record<string, unknown>[] = [];
    const visit = (v: unknown): void => {
        if (Array.isArray(v)) { v.forEach(visit); return; }
        if (v && typeof v === 'object') {
            const obj = v as Record<string, unknown>;
            nodes.push(obj);
            if (obj['@graph']) visit(obj['@graph']);
            if (obj['publisher']) visit(obj['publisher']);
        }
    };
    for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
            visit(JSON.parse(m[1] ?? '') as unknown);
        } catch {
            // Malformed JSON-LD is common; skip it.
        }
    }
    return nodes;
}

const ORGANIZATION_TYPES = /^(Organization|NewsMediaOrganization|Corporation|EducationalOrganization|GovernmentOrganization|NGO|ResearchOrganization|OnlineBusiness)$/;

function logoUrl(logo: unknown): string | undefined {
    if (typeof logo === 'string') return logo;
    if (Array.isArray(logo)) return logoUrl(logo[0]);
    if (logo && typeof logo === 'object') {
        const o = logo as Record<string, unknown>;
        return logoUrl(o['url'] ?? o['contentUrl']);
    }
    return undefined;
}

export function extractBrandAssets(html: string, baseUrl: string): BrandAssets {
    const links = linkTags(html, baseUrl);
    const has = (l: LinkTag, rel: string) => l.rel.includes(rel);

    const icons = links.filter(l => has(l, 'icon'));
    const svgIcon = icons.find(l => l.type === 'image/svg+xml' || /\.svg(\?|$)/i.test(l.href));
    const smallIcons = icons.filter(l => l.sizes <= 96).sort((a, b) => b.sizes - a.sizes);
    const favicon = svgIcon?.href ?? smallIcons[0]?.href ?? icons[0]?.href ?? resolveAgainstBase('/favicon.ico', baseUrl);

    const touch = links
        .filter(l => has(l, 'apple-touch-icon') || has(l, 'apple-touch-icon-precomposed'))
        .sort((a, b) => (b.sizes || 180) - (a.sizes || 180));
    const tile = getMeta(html, 'name', 'msapplication-TileImage');
    const bigIcon = icons.filter(l => l.sizes >= 120 && l.sizes !== Number.MAX_SAFE_INTEGER).sort((a, b) => b.sizes - a.sizes)[0];
    const appIcon = touch[0]?.href ?? (tile ? resolveAgainstBase(tile, baseUrl) : undefined) ?? bigIcon?.href;

    let logo: string | undefined;
    for (const node of jsonLdNodes(html)) {
        const t = node['@type'];
        const types = (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string');
        if (types.some(x => ORGANIZATION_TYPES.test(x))) {
            const u = logoUrl(node['logo']);
            if (u) { logo = resolveAgainstBase(u, baseUrl); break; }
        }
    }
    if (!logo) {
        const og = getMeta(html, 'property', 'og:logo');
        if (og) logo = resolveAgainstBase(og, baseUrl);
    }
    if (!logo) {
        const itemprop = links.find(l => l.itemprop === 'logo')?.href
            ?? html.match(/<img\b[^>]*itemprop\s*=\s*["']logo["'][^>]*>/i)?.[0];
        if (itemprop) logo = itemprop.startsWith('<') ? (() => { const src = attr(itemprop, 'src'); return src ? resolveAgainstBase(src, baseUrl) : undefined; })() : itemprop;
    }

    const mask = links.find(l => has(l, 'mask-icon'));
    return {
        favicon,
        appIcon,
        logo,
        maskIcon: mask?.href,
        maskIconColor: mask?.color,
        brandColor: getMeta(html, 'name', 'theme-color') ?? getMeta(html, 'name', 'msapplication-TileColor') ?? undefined,
        webManifest: links.find(l => has(l, 'manifest'))?.href,
    };
}

const ARTICLE_TYPES = /^(Article|NewsArticle|BlogPosting|TechArticle|ScholarlyArticle|Report|WebPage|VideoObject|DiscussionForumPosting|SocialMediaPosting|DigitalDocument|Book|CreativeWork|HowTo|Review)$/;

function personNames(v: unknown): string[] {
    if (typeof v === 'string') return [v];
    if (Array.isArray(v)) return v.flatMap(personNames);
    if (v && typeof v === 'object') {
        const name = (v as Record<string, unknown>)['name'];
        return typeof name === 'string' ? [name] : [];
    }
    return [];
}

/** `author` (else `creator`) of the page's article-like JSON-LD node. */
export function jsonLdAuthors(html: string): string[] {
    for (const node of jsonLdNodes(html)) {
        const t = node['@type'];
        const types = (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string');
        if (!types.some(x => ARTICLE_TYPES.test(x))) continue;
        const names = personNames(node['author'] ?? node['creator']).map(n => decodeEntities(n).trim()).filter(Boolean);
        if (names.length) return [...new Set(names)];
    }
    return [];
}

/**
 * Medium, Ghost, and WordPress put the byline in twitter:data1 — but only when
 * twitter:label1 says so. Elsewhere data1 is the reading time ("3 minutes"),
 * which is how reading times ended up stored as authors.
 */
export function twitterWrittenBy(html: string): string[] {
    const out: string[] = [];
    for (const n of ['1', '2']) {
        const label = getMeta(html, 'name', `twitter:label${n}`) ?? '';
        const data = getMeta(html, 'name', `twitter:data${n}`);
        if (data && /^(written by|author|by)$/i.test(label.trim())) out.push(data);
    }
    return out;
}

/**
 * Last HTML resort: the visible byline. Text of the first elements whose class
 * or itemprop names an author or byline (Rivery, Deloitte, Harvard DCE expose
 * nothing else). Only name-shaped strings survive downstream filtering;
 * "By" and "Published by" prefixes are dropped here.
 */
export function bylineElements(html: string): string[] {
    // Whole class tokens, BEM-aware. Deloitte marks names
    // `cmp-di-authors__name` and job titles `author-role`; matching any class
    // that merely starts with "author" picked the job title.
    const NAME_TOKEN = /^(?:[a-z0-9]+[-_]+)*(?:authors?|byline)(?:[-_]{1,2}name|Name)(?:--[a-z0-9-]+)?$/i;
    const BARE_TOKEN = /^(?:[a-z0-9]+[-_]+)*(?:authors?|byline)(?:--[a-z0-9-]+)?$/i;
    const named: string[] = [];
    const bare: string[] = [];
    const re = /<(a|span|div|p|li|address|strong|h[2-6])\b([^>]*)>((?:(?!<\/?(?:a|span|div|p|li|address|strong|h[2-6])\b)[\s\S]){1,200})/gi;
    for (const m of html.matchAll(re)) {
        const attrs = m[2] ?? '';
        const tokens = [...(attr(`<x ${attrs}>`, 'class') ?? '').split(/\s+/), attr(`<x ${attrs}>`, 'itemprop') === 'author' ? 'author' : ''].filter(Boolean);
        const kind = tokens.some(t => NAME_TOKEN.test(t)) ? named : tokens.some(t => BARE_TOKEN.test(t)) ? bare : null;
        if (!kind) continue;
        const text = decodeEntities((m[3] ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
            .replace(/^(published )?by\s*:?\s*/i, '');
        if (text && text.length <= 60 && !kind.includes(text)) kind.push(text);
    }
    return (named.length ? named : bare).slice(0, 6);
}

/** Content types we save as files rather than parse as HTML. */
const DOCUMENT_CONTENT_TYPE = /^application\/(pdf|epub\+zip|vnd\.openxmlformats-officedocument\.)/i;

export function isDocumentContentType(contentType: string | undefined): boolean {
    return !!contentType && DOCUMENT_CONTENT_TYPE.test(contentType.trim());
}

/** Case-insensitive header lookup; Obsidian does not promise a key casing. */
export function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
    if (!headers) return undefined;
    const lower = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === lower) return value;
    }
    return undefined;
}

export function parseDirectFetchHtml(html: string, url: string): ParsedHtmlMeta {
    const citationTitle = getMeta(html, 'name', 'citation_title') ?? undefined;
    const title =
        getMeta(html, 'property', 'og:title') ??
        getMeta(html, 'name', 'twitter:title') ??
        citationTitle ??
        getTitleTag(html) ??
        '';
    const description =
        getMeta(html, 'property', 'og:description') ??
        getMeta(html, 'name', 'twitter:description') ??
        getMeta(html, 'name', 'description') ??
        '';
    const rawImage =
        getMeta(html, 'property', 'og:image') ??
        getMeta(html, 'name', 'twitter:image');
    const image = rawImage ? resolveAgainstBase(rawImage, url) : undefined;
    const siteName = getMeta(html, 'property', 'og:site_name') ?? '';
    const type = getMeta(html, 'property', 'og:type') ?? '';
    const brand = extractBrandAssets(html, url);
    const favicon = brand.favicon;
    // Tiers, first non-empty wins — NOT merged. A journal page can carry both a
    // generic `author` naming one person and a full `citation_author` set;
    // merging would double-list them under two spellings.
    //
    // citation_* leads because it's the Highwire Press standard scholarly
    // publishers emit, and it's complete where the generic tags are lossy.
    const citationAuthors = getMetaAll(html, 'name', 'citation_author');
    // Fallback order, from probing 40 author-less citations (2026-10-06):
    // JSON-LD carried the byline on 15 (DevRev, Figma, HBR, LinkedIn, dev.to…)
    // that have no author meta tag; a few expose it only in a visible byline.
    // Each source is filtered before choosing, so a junk meta author can't
    // shadow a real byline further down (Deloitte).
    const plausible = (list: string[]): string[] => list.filter((a) => isPlausibleAuthor(a.replace(/,/g, ' ')));
    const authors = firstNonEmpty(
        citationAuthors,
        plausible(jsonLdAuthors(html)),
        plausible(getMetaAll(html, 'name', 'author')),
        plausible(getMetaAll(html, 'property', 'article:author')),
        plausible(twitterWrittenBy(html)),
        plausible(bylineElements(html))
    )
        // `article:author` is frequently a profile URL rather than a name.
        .filter((value) => !/^https?:\/\//i.test(value))
        // "Lee Ying Shan,Dylan Butts" is two people, not "Last, First":
        // split on commas when every part is itself a multi-word name.
        .flatMap((value) => {
            const parts = value.split(',').map((p) => p.trim()).filter(Boolean);
            return parts.length > 1 && parts.every((p) => p.split(/\s+/).length > 1) ? parts : [value];
        })
        .map(normalizeAuthorName);

    const publishedRaw =
        getMeta(html, 'name', 'citation_publication_date') ??
        getMeta(html, 'name', 'citation_date') ??
        getMeta(html, 'property', 'article:published_time') ??
        getMeta(html, 'name', 'date') ??
        getMeta(html, 'property', 'og:published_time') ??
        // Last resort: when a paper was posted, if no publication date is given.
        getMeta(html, 'name', 'citation_online_date') ??
        null;
    const published = publishedRaw ? normalizeDate(publishedRaw) : undefined;

    return {
        title,
        citationTitle,
        citationPublisher: getMeta(html, 'name', 'citation_publisher') ?? undefined,
        description,
        image,
        favicon,
        url,
        type,
        siteName,
        authors,
        published,
        scholarly: !!citationTitle || citationAuthors.length > 0,
        brand,
    };
}

/** One GET with `throw: false`. Throws DirectFetchError on any failure. */
export async function fetchDirectOpenGraph(url: string): Promise<DirectFetchResult> {
    let res;
    try {
        res = await requestUrl({ url, method: 'GET', throw: false });
    } catch (err) {
        throw new DirectFetchError(
            `Network error fetching ${url}: ${err instanceof Error ? err.message : 'unknown'}`,
            'NETWORK_ERROR'
        );
    }

    if (res.status >= 400) {
        throw new DirectFetchError(`HTTP ${res.status} fetching ${url}`, 'HTTP_ERROR');
    }

    const contentType = headerValue(res.headers, 'content-type');
    if (isDocumentContentType(contentType)) {
        // A PDF or Office file has no <meta> tags; reading .text would decode
        // binary for nothing. Return an empty result that records the type.
        return { ...parseDirectFetchHtml('', url), contentType };
    }

    const html = res.text ?? '';
    if (!html) {
        throw new DirectFetchError(`Empty response from ${url}`, 'EMPTY_RESPONSE');
    }

    return { ...parseDirectFetchHtml(html, url), contentType };
}
