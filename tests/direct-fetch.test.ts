// Tier 1 of "Promote to canonical source": the dependency-free <meta>
// extractor ported (copied, not imported) from Metafetch's
// directFetchService. Covers multi-author citation_author, both attribute
// orders, HTML entities, the favicon, and the fetch wrapper's failure modes.
// No network: requestUrl is the obsidian stub, driven by __requestUrl.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    getMetaAll,
    normalizeAuthorName,
    normalizeDate,
    parseDirectFetchHtml,
    fetchDirectOpenGraph,
    DirectFetchError,
} from '../src/services/directFetchService';

const SCHOLARLY_HTML = `<!doctype html><html><head>
<meta charset="utf-8">
<title>Ignored &amp; fallback title</title>
<link rel="icon" href="/static/favicon-32.png">
<meta property="og:title" content="Battery Ventures OpenCloud Report 2021 | PDF">
<meta content="Scribd" property="og:site_name" />
<meta property='og:image' content='/images/cover.jpg'>
<meta property="og:type" content="article">
<meta name="author" content="Danel Dayan">
<meta name="citation_title" content="State of the OpenCloud 2021">
<meta name="citation_author" content="Dayan, Danel">
<meta content="Ng, Neeraj" name="citation_author">
<meta name="citation_author" content="Doe, Jane, PhD">
<meta name="citation_publication_date" content="2021/11/3">
<meta name="CITATION_PUBLISHER" content="Battery Ventures">
<meta name="description" content="Tom &amp; Jerry&#39;s &quot;report&quot; &#8212; &#x2014;">
</head><body></body></html>`;

const BLOG_HTML = `<html><head>
<title>A Post &mdash; The Blog</title>
<meta property="og:title" content="A Post">
<meta property="article:author" content="https://x.com/a">
<meta property="article:published_time" content="2024-02-01T00:00:00Z">
<meta property="og:site_name" content="The Blog">
<link href="https://cdn.blog.example.com/fav.ico" rel="shortcut icon">
</head></html>`;

describe('getMetaAll', () => {
    test('returns every citation_author, in either attribute order, de-duplicated', () => {
        // Document order: the quote-aware parser reads tags in sequence.
        assert.deepEqual(getMetaAll(SCHOLARLY_HTML, 'name', 'citation_author'), ['Dayan, Danel', 'Ng, Neeraj', 'Doe, Jane, PhD']);
        assert.deepEqual(getMetaAll('<meta name="a" content="x"><meta name="a" content="x">', 'name', 'a'), ['x']);
    });

    test('matches content-before-property and is case-insensitive on the key', () => {
        assert.deepEqual(getMetaAll(SCHOLARLY_HTML, 'property', 'og:site_name'), ['Scribd']);
        assert.deepEqual(getMetaAll(SCHOLARLY_HTML, 'name', 'citation_publisher'), ['Battery Ventures']);
    });

    test('decodes named and numeric entities', () => {
        assert.deepEqual(getMetaAll(SCHOLARLY_HTML, 'name', 'description'), ['Tom & Jerry\'s "report" — —']);
    });
});

describe('normalizers', () => {
    test('normalizeAuthorName flips Last, First and leaves credentials alone', () => {
        assert.equal(normalizeAuthorName('Dayan, Danel'), 'Danel Dayan');
        assert.equal(normalizeAuthorName('Jane Doe, PhD'), 'Jane Doe, PhD');
        assert.equal(normalizeAuthorName('Plain Name'), 'Plain Name');
    });

    test('normalizeDate pads Highwire slash dates and passes ISO through', () => {
        assert.equal(normalizeDate('2021/11/3'), '2021-11-03');
        assert.equal(normalizeDate('2021/4'), '2021-04');
        assert.equal(normalizeDate('2024-02-01T00:00:00Z'), '2024-02-01T00:00:00Z');
    });
});

describe('parseDirectFetchHtml', () => {
    test('scholarly page: citation_* authors (normalized), date, publisher, favicon, og:image resolved', () => {
        const m = parseDirectFetchHtml(SCHOLARLY_HTML, 'https://www.scribd.com/document/536774580/x');
        assert.equal(m.title, 'Battery Ventures OpenCloud Report 2021 | PDF');
        assert.equal(m.citationTitle, 'State of the OpenCloud 2021');
        assert.equal(m.scholarly, true);
        // Order follows Metafetch's two-pass regex: name-before-content tags first.
        assert.deepEqual(m.authors, ['Danel Dayan', 'Neeraj Ng', 'Doe, Jane, PhD']);
        assert.equal(m.published, '2021-11-03');
        assert.equal(m.citationPublisher, 'Battery Ventures');
        assert.equal(m.siteName, 'Scribd');
        assert.equal(m.type, 'article');
        assert.equal(m.image, 'https://www.scribd.com/images/cover.jpg');
        assert.equal(m.favicon, 'https://www.scribd.com/static/favicon-32.png');
    });

    test('blog page: URL-valued authors dropped, href-before-rel favicon, no image', () => {
        const m = parseDirectFetchHtml(BLOG_HTML, 'https://blog.example.com/p');
        assert.equal(m.title, 'A Post');
        assert.equal(m.scholarly, false);
        assert.deepEqual(m.authors, []);
        assert.equal(m.published, '2024-02-01T00:00:00Z');
        assert.equal(m.siteName, 'The Blog');
        assert.equal(m.image, undefined);
        assert.equal(m.favicon, 'https://cdn.blog.example.com/fav.ico');
    });

    test('no <link rel=icon> falls back to /favicon.ico; <title> is the last-resort title', () => {
        const m = parseDirectFetchHtml('<html><head><title>Just a title</title></head></html>', 'https://example.com/a/b');
        assert.equal(m.title, 'Just a title');
        assert.equal(m.favicon, 'https://example.com/favicon.ico');
    });
});

describe('fetchDirectOpenGraph', () => {
    afterEach(() => { delete (globalThis as { __requestUrl?: unknown }).__requestUrl; });

    function respond(status: number, text: string, headers: Record<string, string> = { 'content-type': 'text/html' }): void {
        (globalThis as { __requestUrl?: unknown }).__requestUrl = (req: { throw?: boolean }) => {
            assert.equal(req.throw, false);
            return { status, headers, text, json: null, arrayBuffer: new ArrayBuffer(0) };
        };
    }

    test('parses a successful response and records its content type', async () => {
        respond(200, BLOG_HTML, { 'Content-Type': 'text/html; charset=utf-8' });
        const m = await fetchDirectOpenGraph('https://blog.example.com/p');
        assert.equal(m.title, 'A Post');
        assert.equal(m.contentType, 'text/html; charset=utf-8');
    });

    test('a document response is not parsed as HTML', async () => {
        respond(200, '%PDF-1.7 binary', { 'content-type': 'application/pdf' });
        const m = await fetchDirectOpenGraph('https://example.com/report');
        assert.equal(m.contentType, 'application/pdf');
        assert.equal(m.title, '');
        assert.deepEqual(m.authors, []);
    });

    test('HTTP errors and network errors throw DirectFetchError', async () => {
        respond(403, 'Forbidden');
        await assert.rejects(fetchDirectOpenGraph('https://example.com/a'), (e: unknown) => e instanceof DirectFetchError && e.code === 'HTTP_ERROR');
        (globalThis as { __requestUrl?: unknown }).__requestUrl = () => { throw new Error('offline'); };
        await assert.rejects(fetchDirectOpenGraph('https://example.com/a'), (e: unknown) => e instanceof DirectFetchError && e.code === 'NETWORK_ERROR');
    });
});
