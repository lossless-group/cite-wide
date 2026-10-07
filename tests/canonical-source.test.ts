// Acceptance tests for "Promote to canonical source"
// (context-v/specs/Promote-to-Canonical-Source.md). Covers the pure logic:
// footnote parsing on real vault shapes, the cursor lookup, the two
// metadata tiers, content capture, and the frontmatter assembly rules
// (write-once fields, light keys preserved, modal edits win). The ported
// tier-1 extractor has its own file, direct-fetch.test.ts. No network:
// requestUrl is the obsidian stub, driven by globalThis.__requestUrl.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseFootnote,
    findCitationIdAtCursor,
    findFootnoteDefinition,
    buildPrefill,
    assembleCanonicalFrontmatter,
    toKebabSlug,
    normalizeDatePublished,
    fetchTier1,
    needsTier2,
    fetchTier2,
    documentExtension,
    promoteCanonicalSource,
    type CanonicalForm,
} from '../src/services/canonicalSourceService';
import { parseDirectFetchHtml, type DirectFetchResult } from '../src/services/directFetchService';
import { TFile, type App } from 'obsidian';

const OPENCLOUD = '[^80nyxu]: 2021, Nov. ["State of the OpenCloud 2021"](https://www.scribd.com/document/536774580/Battery-Ventures-OpenCloud-Report-2021#fullscreen&from_embed). Scribd. Battery Ventures.';
const BOOK = '[^4k2m9p]: 2014, Sep 16. Thiel, Peter; Masters, Blake. "Zero to One: Notes on Startups, or How to Build the Future". Crown Business.';
const BARE_URL = '[^q7w2e9]: https://stratechery.com/2015/aggregation-theory/';

describe('parseFootnote', () => {
    test('the OpenCloud report line: linked title, URL, partial date, trailing segments', () => {
        const p = parseFootnote(OPENCLOUD);
        assert.equal(p.hexId, '80nyxu');
        assert.equal(p.title, 'State of the OpenCloud 2021');
        assert.equal(p.url, 'https://www.scribd.com/document/536774580/Battery-Ventures-OpenCloud-Report-2021#fullscreen&from_embed');
        assert.equal(p.datePublished, '2021-11');
        assert.deepEqual(p.trailingSegments, ['Scribd', 'Battery Ventures']);
        // Scribd is the URL's host, so the publisher is the other segment.
        assert.equal(p.publisher, 'Battery Ventures');
        assert.deepEqual(p.authors, []);
        assert.equal(p.referenceText, OPENCLOUD.replace('[^80nyxu]: ', ''));
    });

    test('a book line: quoted title, authors before the title, publisher after', () => {
        const p = parseFootnote(BOOK);
        assert.equal(p.hexId, '4k2m9p');
        assert.equal(p.title, 'Zero to One: Notes on Startups, or How to Build the Future');
        assert.equal(p.url, undefined);
        assert.equal(p.datePublished, '2014-09-16');
        assert.deepEqual(p.authors, ['Thiel, Peter', 'Masters, Blake']);
        assert.equal(p.publisher, 'Crown Business');
    });

    test('a book line with "by" authorship after the title', () => {
        const p = parseFootnote('[^b00k12]: "The Innovator\'s Dilemma" by Clayton M. Christensen. Harvard Business Review Press. 1997.');
        assert.equal(p.title, 'The Innovator\'s Dilemma');
        assert.deepEqual(p.authors, ['Clayton M. Christensen']);
        assert.equal(p.publisher, 'Harvard Business Review Press');
        assert.equal(p.datePublished, '1997');
    });

    test('a bare-URL footnote: URL only, no title', () => {
        const p = parseFootnote(BARE_URL);
        assert.equal(p.hexId, 'q7w2e9');
        assert.equal(p.url, 'https://stratechery.com/2015/aggregation-theory/');
        assert.equal(p.title, undefined);
        assert.deepEqual(p.authors, []);
        assert.equal(p.publisher, undefined);
    });

    test('a quoted bare URL, as Cite Wide itself assembles them', () => {
        const p = parseFootnote('[^a1b2c3]: "https://example.com/post".');
        assert.equal(p.url, 'https://example.com/post');
        assert.equal(p.title, undefined);
    });

    test('a year inside the title is not read as the date', () => {
        const p = parseFootnote('[^y2k000]: ["Outlook 2030"](https://example.com/outlook). Example Co.');
        assert.equal(p.title, 'Outlook 2030');
        assert.equal(p.datePublished, undefined);
    });
});

describe('cursor lookup', () => {
    test('cursor inside an inline marker selects it', () => {
        const line = 'The OpenCloud report[^80nyxu] is canonical[^zz9911].';
        assert.equal(findCitationIdAtCursor(line, 22), '80nyxu');
        assert.equal(findCitationIdAtCursor(line, line.indexOf('[^zz9911]') + 9), 'zz9911');
    });

    test('cursor anywhere on a definition line selects that definition', () => {
        assert.equal(findCitationIdAtCursor(OPENCLOUD, OPENCLOUD.length - 3), '80nyxu');
    });

    test('cursor away from any marker selects nothing', () => {
        assert.equal(findCitationIdAtCursor('The OpenCloud report[^80nyxu] is canonical.', 2), null);
        assert.equal(findCitationIdAtCursor('', 0), null);
    });

    test('finds the definition line for an ID', () => {
        const content = ['Body[^80nyxu].', '', OPENCLOUD, BOOK].join('\n');
        assert.equal(findFootnoteDefinition(content, '80nyxu'), OPENCLOUD);
        assert.equal(findFootnoteDefinition(content, 'nope00'), null);
    });
});

describe('helpers', () => {
    test('default_slug is kebab-case', () => {
        assert.equal(toKebabSlug('State of the OpenCloud 2021'), 'state-of-the-opencloud-2021');
        assert.equal(toKebabSlug('Zero to One: Notes on Startups, or How to Build the Future'), 'zero-to-one-notes-on-startups-or-how-to-build-the-future');
        assert.equal(toKebabSlug('  Café Society — “Quoted”!  '), 'cafe-society-quoted');
    });

    test('dates normalize to partial ISO', () => {
        assert.equal(normalizeDatePublished('2021, Nov.'), '2021-11');
        assert.equal(normalizeDatePublished('2025, Jan 25'), '2025-01-25');
        assert.equal(normalizeDatePublished('March 3, 2020'), '2020-03-03');
        assert.equal(normalizeDatePublished('2021/11/03'), '2021-11-03');
        assert.equal(normalizeDatePublished('2024-02-01T00:00:00Z'), '2024-02-01');
        assert.equal(normalizeDatePublished('1997'), '1997');
        assert.equal(normalizeDatePublished('sometime'), undefined);
    });
});

// --- Field assembly ------------------------------------------------------

const LIGHT: Record<string, unknown> = {
    hexId: '80nyxu',
    title: 'State of the OpenCloud 2021',
    author: '',
    url: 'https://www.scribd.com/document/536774580/Battery-Ventures-OpenCloud-Report-2021#fullscreen&from_embed',
    date: '2021',
    source: 'scribd.com',
    tags: ['Open-Source'],
    created: '2026-05-01T00:00:00.000Z',
    lastModified: '2026-05-01T00:00:00.000Z',
    referenceText: OPENCLOUD.replace('[^80nyxu]: ', ''),
    usageCount: 3,
    filesUsedIn: ['Vocabulary/Open Source Software.md', 'Memos/Infra.md'],
};

const FORM: CanonicalForm = {
    title: 'State of the OpenCloud 2021',
    subtitle: '',
    authors: ['Battery Ventures'],
    datePublished: '2021, Nov.',
    publisher: 'Battery Ventures',
    publicationType: 'report',
    url: 'https://www.scribd.com/document/536774580/Battery-Ventures-OpenCloud-Report-2021#fullscreen&from_embed',
};

const FETCHED: DirectFetchResult = {
    title: 'Fetched Title',
    citationTitle: undefined,
    citationPublisher: undefined,
    description: '',
    image: 'https://imgv2.scribdassets.com/cover.jpg',
    favicon: 'https://www.scribd.com/favicon.ico',
    url: 'https://www.scribd.com/document/536774580/x',
    type: '',
    siteName: 'Scribd',
    authors: ['Fetched Author'],
    published: '2021-11-03',
    scholarly: false,
    contentType: 'text/html',
};

const SCHOLARLY_HTML = '<meta name="citation_title" content="State of the OpenCloud 2021"><meta name="citation_author" content="Dayan, Danel"><meta name="citation_author" content="Ng, Neeraj"><meta name="citation_publication_date" content="2021/11/03"><meta name="citation_publisher" content="Battery Ventures">';

let uuidCalls = 0;
const newUuid = (): string => `00000000-0000-4000-8000-00000000000${++uuidCalls}`;

describe('assembleCanonicalFrontmatter', () => {
    test('sets canonical: true and the v1 fields, keeping every light key', () => {
        uuidCalls = 0;
        const fm = assembleCanonicalFrontmatter(LIGHT, {
            hexId: '80nyxu', form: FORM, fetched: FETCHED, today: '2026-10-06', newUuid,
        });
        assert.equal(fm['canonical'], true);
        for (const key of Object.keys(LIGHT)) assert.ok(key in fm, `light key ${key} was dropped`);
        assert.deepEqual(fm['tags'], ['Open-Source']);
        assert.equal(fm['usageCount'], 3);
        assert.equal(fm['created'], '2026-05-01T00:00:00.000Z');
        assert.equal(fm['referenceText'], LIGHT['referenceText']);

        assert.equal(fm['internal_uuid'], '00000000-0000-4000-8000-000000000001');
        assert.equal(fm['reference_hexcode'], '80nyxu');
        assert.equal(fm['default_slug'], 'state-of-the-opencloud-2021');
        assert.equal(fm['title'], 'State of the OpenCloud 2021');
        assert.deepEqual(fm['authors'], ['Battery Ventures']);
        assert.equal(fm['date_published'], '2021-11');
        assert.equal(fm['publisher'], 'Battery Ventures');
        assert.equal(fm['publisher_url'], 'https://www.scribd.com');
        assert.equal(fm['publication_type'], 'report');
        assert.equal(fm['first_accessed_at_url'], FORM.url);
        assert.equal(fm['date_added'], '2026-10-06');
        assert.equal(fm['date_recently_accessed'], '2026-10-06');
        assert.equal(fm['piece_og_image'], 'https://imgv2.scribdassets.com/cover.jpg');
        assert.equal(fm['publisher_favicon_url'], 'https://www.scribd.com/favicon.ico');
        assert.equal('subtitle' in fm, false, 'an empty subtitle is left off');
        assert.equal('downloaded_content_path' in fm, false, 'no capture, no path');
        assert.equal('source_text_path' in fm, false, 'no capture, no path');
        // AI-required and archival fields stay absent in v1.
        for (const key of ['publisher_type', 'edition_or_version', 'structured_data_path', 'api_provider_url']) {
            assert.equal(key in fm, false, `${key} should not be written in v1`);
        }
    });

    test('light fields left empty are backfilled from the modal', () => {
        const fm = assembleCanonicalFrontmatter(LIGHT, {
            hexId: '80nyxu', form: FORM, fetched: null, today: '2026-10-06', newUuid,
        });
        assert.equal(fm['author'], 'Battery Ventures');
        assert.equal(fm['date'], '2021', 'a filled light field is not overwritten');
    });

    test('cited_in_files mirrors filesUsedIn, including the promoting file', () => {
        const fm = assembleCanonicalFrontmatter(LIGHT, {
            hexId: '80nyxu', form: FORM, fetched: null, today: '2026-10-06', newUuid,
            sourceFile: 'Memos/New.md',
        });
        const expected = ['Vocabulary/Open Source Software.md', 'Memos/Infra.md', 'Memos/New.md'];
        assert.deepEqual(fm['filesUsedIn'], expected);
        assert.deepEqual(fm['cited_in_files'], expected);
        assert.notEqual(fm['cited_in_files'], fm['filesUsedIn'], 'separate arrays, so YAML does not emit an anchor');
    });

    test('re-promoting keeps internal_uuid, first_accessed_at_url, and date_added', () => {
        uuidCalls = 0;
        const first = assembleCanonicalFrontmatter(LIGHT, {
            hexId: '80nyxu', form: FORM, fetched: FETCHED, today: '2026-10-06', newUuid,
        });
        const second = assembleCanonicalFrontmatter(first, {
            hexId: '80nyxu',
            form: { ...FORM, url: 'https://batteryventures.com/opencloud-2021' },
            fetched: null,
            today: '2027-01-15',
            newUuid,
        });
        assert.equal(second['internal_uuid'], first['internal_uuid']);
        assert.equal(uuidCalls, 1, 'no second UUID is generated');
        assert.equal(second['first_accessed_at_url'], FORM.url);
        assert.equal(second['date_added'], '2026-10-06');
        assert.equal(second['url'], 'https://batteryventures.com/opencloud-2021', 'the edited URL becomes the working url');
        assert.equal(second['publisher_url'], 'https://batteryventures.com');
        assert.equal(second['date_recently_accessed'], '2026-10-06', 'a failed fetch does not advance date_recently_accessed');
        assert.equal(second['piece_og_image'], 'https://imgv2.scribdassets.com/cover.jpg', 'a failed fetch keeps the stored og image');
    });

    test('modal edits win over fetched values', () => {
        const fm = assembleCanonicalFrontmatter({}, {
            hexId: 'q7w2e9',
            form: { ...FORM, title: 'My Edited Title', authors: ['Edited Author'], publisher: 'Edited Pub', datePublished: '2020' },
            fetched: FETCHED,
            today: '2026-10-06',
            newUuid,
        });
        assert.equal(fm['title'], 'My Edited Title');
        assert.deepEqual(fm['authors'], ['Edited Author']);
        assert.equal(fm['publisher'], 'Edited Pub');
        assert.equal(fm['date_published'], '2020');
        assert.equal(fm['default_slug'], 'my-edited-title');
    });

    test('a new file gets the light keys too, so Dataview queries see it', () => {
        const fm = assembleCanonicalFrontmatter({}, {
            hexId: 'q7w2e9', form: FORM, fetched: null, today: '2026-10-06', newUuid,
            sourceFile: 'a.md', referenceText: 'https://stratechery.com/2015/aggregation-theory/', now: '2026-10-06T12:00:00.000Z',
        });
        assert.equal(fm['hexId'], 'q7w2e9');
        assert.equal(fm['usageCount'], 1);
        assert.equal(fm['created'], '2026-10-06T12:00:00.000Z');
        assert.equal(fm['referenceText'], 'https://stratechery.com/2015/aggregation-theory/');
        assert.deepEqual(fm['tags'], []);
        assert.equal('date_recently_accessed' in fm, false, 'no fetch, no access date');
    });
});

describe('buildPrefill', () => {
    test('a fresh promote: scholarly meta over the footnote, footnote over og tags', () => {
        const parsed = parseFootnote(OPENCLOUD);
        const pre = buildPrefill({ parsed, existing: LIGHT, tier1: FETCHED, tier2: null });
        // FETCHED has no scholarly tags flagged, so the curated footnote title wins over og:title.
        assert.equal(pre.title, 'State of the OpenCloud 2021');
        assert.equal(pre.publisher, 'Battery Ventures');
        assert.equal(pre.url, parsed.url);
        assert.equal(pre.datePublished, '2021-11');
        assert.deepEqual(pre.authors, ['Fetched Author'], 'footnote had no authors, so fetched fills the gap');
    });

    test('scholarly citation_* tags win over the footnote', () => {
        const parsed = parseFootnote(OPENCLOUD);
        const scholarly = { ...parseDirectFetchHtml(SCHOLARLY_HTML, 'https://www.scribd.com/x'), contentType: 'text/html' };
        const pre = buildPrefill({ parsed, existing: {}, tier1: scholarly, tier2: null });
        assert.deepEqual(pre.authors, ['Danel Dayan', 'Neeraj Ng']);
        assert.equal(pre.datePublished, '2021-11-03');
        assert.equal(pre.publicationType, 'paper');
    });

    test('a failed fetch falls back to parsed values', () => {
        const pre = buildPrefill({ parsed: parseFootnote(BOOK), existing: {}, tier1: null, tier2: null });
        assert.equal(pre.title, 'Zero to One: Notes on Startups, or How to Build the Future');
        assert.deepEqual(pre.authors, ['Thiel, Peter', 'Masters, Blake']);
        assert.equal(pre.publisher, 'Crown Business');
        assert.equal(pre.publicationType, 'other');
    });

    test('re-promoting prefills the stored canonical values, not the fetched ones', () => {
        const stored = { ...LIGHT, canonical: true, title: 'Kept Title', subtitle: 'Kept Sub', authors: ['Kept Author'], publication_type: 'report', publisher: 'Kept Pub', date_published: '2021-11' };
        const pre = buildPrefill({ parsed: parseFootnote(OPENCLOUD), existing: stored, tier1: FETCHED, tier2: null });
        assert.equal(pre.title, 'Kept Title');
        assert.equal(pre.subtitle, 'Kept Sub');
        assert.deepEqual(pre.authors, ['Kept Author']);
        assert.equal(pre.publisher, 'Kept Pub');
        assert.equal(pre.publicationType, 'report');
    });
});

// --- Tier 1 timeout and tier 2 (Jina Reader) ------------------------------

type Handler = (req: { url: string; headers?: Record<string, string>; throw?: boolean }) => unknown;
function setHandler(h: Handler | undefined): void {
    (globalThis as { __requestUrl?: unknown }).__requestUrl = h;
}
function res(status: number, init: { text?: string; json?: unknown; headers?: Record<string, string>; bytes?: ArrayBuffer } = {}): unknown {
    return { status, headers: init.headers ?? {}, text: init.text ?? '', json: init.json ?? null, arrayBuffer: init.bytes ?? new ArrayBuffer(0) };
}

describe('tiers', () => {
    afterEach(() => setHandler(undefined));

    test('tier 1 falls back to null on an error and on a timeout', async () => {
        setHandler(() => res(500));
        assert.equal(await fetchTier1('https://example.com/a'), null);
        setHandler(() => new Promise(() => { /* never resolves */ }));
        assert.equal(await fetchTier1('https://example.com/a', 20), null);
    });

    test('a bot-check interstitial counts as a failed tier-1 fetch, not a title', async () => {
        // Scribd served exactly this to a plain GET on 2026-10-06.
        for (const title of ['Client Challenge', 'Just a moment...', 'Attention Required! | Cloudflare', 'Access Denied']) {
            setHandler(() => res(200, { text: `<html><head><title>${title}</title></head><body></body></html>`, headers: { 'content-type': 'text/html' } }));
            assert.equal(await fetchTier1('https://www.scribd.com/document/1'), null, title);
        }
        setHandler(() => res(200, { text: '<html><head><title>Client Challenge Report 2024</title></head></html>', headers: { 'content-type': 'text/html' } }));
        assert.notEqual(await fetchTier1('https://example.com/report'), null, 'a real title that merely starts the same way is kept');
    });

    test('tier 2 runs only when tier 1 leaves title or authors empty', () => {
        assert.equal(needsTier2(null), true);
        assert.equal(needsTier2({ ...FETCHED, authors: [] }), true);
        assert.equal(needsTier2({ ...FETCHED, title: '' }), true);
        assert.equal(needsTier2(FETCHED), false);
    });

    test('tier 2 reads title, author, and site name from Jina Reader', async () => {
        setHandler(req => {
            assert.ok(req.url.startsWith('https://r.jina.ai/'));
            return res(200, { json: { data: { title: 'Jina Title', metadata: { author: 'Jina Author', 'og:site_name': 'Jina Site' } } } });
        });
        const t2 = await fetchTier2('https://example.com/a');
        assert.equal(t2?.title, 'Jina Title');
        assert.deepEqual(t2?.authors, ['Jina Author']);
        assert.equal(t2?.publisher, 'Jina Site');
    });

    test('tier 2 fills only the gaps tier 1 left', () => {
        const pre = buildPrefill({
            parsed: parseFootnote(BARE_URL),
            existing: {},
            tier1: { ...FETCHED, title: 'Tier One Title', authors: [] },
            tier2: { title: 'Jina Title', authors: ['Jina Author'], datePublished: undefined, publisher: 'Jina Site' },
        });
        assert.equal(pre.title, 'Tier One Title');
        assert.deepEqual(pre.authors, ['Jina Author']);
    });

    test('a failing Jina call yields null, not a throw', async () => {
        setHandler(() => res(429));
        assert.equal(await fetchTier2('https://example.com/a'), null);
    });
});

describe('documentExtension', () => {
    test('detects documents by content type or URL extension', () => {
        assert.equal(documentExtension('https://example.com/r', 'application/pdf'), 'pdf');
        assert.equal(documentExtension('https://example.com/r', 'application/epub+zip'), 'epub');
        assert.equal(documentExtension('https://example.com/r', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'docx');
        assert.equal(documentExtension('https://example.com/r', 'application/vnd.openxmlformats-officedocument.presentationml.presentation; x=1'), 'pptx');
        assert.equal(documentExtension('https://example.com/r', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'xlsx');
        assert.equal(documentExtension('https://example.com/files/Report.PDF?dl=1', undefined), 'pdf');
        assert.equal(documentExtension('https://example.com/post', 'text/html'), null);
        assert.equal(documentExtension('not a url', undefined), null);
    });
});

// --- Content capture + promote, against a fake vault -----------------------

type FM = Record<string, unknown>;
interface Entry { file: TFile; fm: FM; text?: string; bytes?: ArrayBuffer }
const vaultFiles = new Map<string, Entry>();
const folders = new Set<string>();

function makeApp(): App {
    const put = (path: string, entry: Partial<Entry>): TFile => {
        const file = Object.assign(new TFile(), { path });
        vaultFiles.set(path, { file, fm: {}, ...entry });
        return file;
    };
    return {
        vault: {
            getAbstractFileByPath: (p: string) => vaultFiles.get(p)?.file ?? (folders.has(p) ? { path: p } : null),
            createFolder: (p: string) => { folders.add(p); return Promise.resolve(); },
            create: (p: string, text: string) => Promise.resolve(put(p, { text })),
            modify: (f: TFile, text: string) => { vaultFiles.get(f.path)!.text = text; return Promise.resolve(); },
            createBinary: (p: string, bytes: ArrayBuffer) => Promise.resolve(put(p, { bytes })),
            modifyBinary: (f: TFile, bytes: ArrayBuffer) => { vaultFiles.get(f.path)!.bytes = bytes; return Promise.resolve(); },
        },
        fileManager: {
            processFrontMatter: (file: TFile, fn: (fm: FM) => void) => {
                fn(vaultFiles.get(file.path)!.fm);
                return Promise.resolve();
            },
        },
    } as unknown as App;
}

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7 fake').buffer;
const PDF_URL = 'https://example.com/reports/opencloud-2021.pdf';

function promoteArgs(overrides: Partial<Parameters<typeof promoteCanonicalSource>[1]> = {}): Parameters<typeof promoteCanonicalSource>[1] {
    return {
        folder: 'Citations',
        hexId: '80nyxu',
        form: { ...FORM, url: PDF_URL },
        capture: true,
        tier1: null,
        sourceFile: 'Vocabulary/Open Source Software.md',
        referenceText: 'ref',
        today: '2026-10-06',
        now: '2026-10-06T12:00:00.000Z',
        newUuid: () => 'uuid-1',
        ...overrides,
    };
}

describe('promoteCanonicalSource', () => {
    afterEach(() => { setHandler(undefined); vaultFiles.clear(); folders.clear(); });

    function routes(jina: () => unknown): void {
        setHandler(req => {
            if (req.url.startsWith('https://r.jina.ai/')) return jina();
            if (req.url === PDF_URL) return res(200, { headers: { 'Content-Type': 'application/pdf' }, bytes: PDF_BYTES });
            return res(404);
        });
    }

    test('a PDF is saved to _files/ and Jina text to _text/ with a backlink', async () => {
        routes(() => res(200, { json: { data: { title: 'T', content: '# State of the OpenCloud\n\nBody text.' } } }));
        const out = await promoteCanonicalSource(makeApp(), promoteArgs());

        assert.equal(out.downloadedContentPath, 'Citations/_files/80nyxu.pdf');
        assert.equal(out.sourceTextPath, 'Citations/_text/80nyxu.md');
        assert.equal(out.textError, undefined);
        assert.deepEqual(new Uint8Array(vaultFiles.get('Citations/_files/80nyxu.pdf')!.bytes!), new Uint8Array(PDF_BYTES));

        const text = vaultFiles.get('Citations/_text/80nyxu.md')!.text!;
        assert.match(text, /\[\[Citations\/80nyxu\|State of the OpenCloud 2021\]\]/);
        assert.match(text, /Body text\./);

        const fm = vaultFiles.get('Citations/80nyxu.md')!.fm;
        assert.equal(fm['canonical'], true);
        assert.equal(fm['downloaded_content_path'], 'Citations/_files/80nyxu.pdf');
        assert.equal(fm['source_text_path'], 'Citations/_text/80nyxu.md');
        assert.match(vaultFiles.get('Citations/80nyxu.md')!.text!, /State of the OpenCloud 2021/);
    });

    test('a Jina failure still promotes, and reports the text was not imported', async () => {
        routes(() => res(503));
        const out = await promoteCanonicalSource(makeApp(), promoteArgs());
        assert.equal(out.sourceTextPath, undefined);
        assert.ok(out.textError, 'the failure is reported');
        assert.equal(out.downloadedContentPath, 'Citations/_files/80nyxu.pdf');
        const fm = vaultFiles.get('Citations/80nyxu.md')!.fm;
        assert.equal(fm['canonical'], true);
        assert.equal('source_text_path' in fm, false);
        assert.equal(vaultFiles.has('Citations/_text/80nyxu.md'), false);
    });

    test('an HTML page downloads no file but still imports text', async () => {
        setHandler(req => req.url.startsWith('https://r.jina.ai/')
            ? res(200, { json: { data: { content: 'Page text.' } } })
            : res(200, { headers: { 'content-type': 'text/html' }, text: '<html></html>' }));
        const out = await promoteCanonicalSource(makeApp(), promoteArgs({ form: { ...FORM, url: 'https://example.com/post' }, tier1: FETCHED }));
        assert.equal(out.downloadedContentPath, undefined);
        assert.equal(out.sourceTextPath, 'Citations/_text/80nyxu.md');
    });

    test('capture off, or no URL, makes no requests', async () => {
        setHandler(() => { throw new Error('no request expected'); });
        const off = await promoteCanonicalSource(makeApp(), promoteArgs({ capture: false }));
        assert.equal(off.downloadedContentPath, undefined);
        assert.equal(off.sourceTextPath, undefined);
        assert.equal(off.textError, undefined);
        vaultFiles.clear();
        const noUrl = await promoteCanonicalSource(makeApp(), promoteArgs({ form: { ...FORM, url: '' } }));
        assert.equal(noUrl.textError, undefined);
        assert.equal(vaultFiles.get('Citations/80nyxu.md')!.fm['canonical'], true);
    });

    test('upgrading an existing light file keeps its body and light keys', async () => {
        const app = makeApp();
        const file = Object.assign(new TFile(), { path: 'Citations/80nyxu.md' });
        vaultFiles.set('Citations/80nyxu.md', { file, fm: { ...LIGHT }, text: 'existing body' });
        folders.add('Citations');
        await promoteCanonicalSource(app, promoteArgs({ capture: false }));
        const entry = vaultFiles.get('Citations/80nyxu.md')!;
        assert.equal(entry.text, 'existing body');
        assert.equal(entry.fm['usageCount'], 3);
        assert.equal(entry.fm['canonical'], true);
    });
});

