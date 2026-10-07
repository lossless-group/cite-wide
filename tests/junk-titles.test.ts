// Junk titles and HTML entities, from enriching the lossless vault's 75
// citations (2026-10-06). Every string below was returned by a real fetch or
// found stored in a real citation file.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isJunkTitle, buildPrefill, fetchTier2 } from '../src/services/canonicalSourceService';
import { parseDirectFetchHtml, type DirectFetchResult } from '../src/services/directFetchService';
import { urlCitationService } from '../src/services/urlCitationService';

test('junk titles: bot checks, error pages, and login walls', () => {
    for (const t of [
        'Just a moment...', 'Client Challenge', 'Not Found', 'Not Found - Business Insider',
        'Page not found | MRU', 'Publication Not Available', 'This qatalog.com page can’t be found',
        '404 Not Found', 'Sign Up | LinkedIn', 'Access Denied', 'Error', 'An error occurred.',
    ]) assert.equal(isJunkTitle(t), true, t);
    for (const t of [
        'The Economics of Open Source', 'Battery Ventures OpenCloud Report 2021',
        'Error Handling in Rust', 'Notfound: a study of absence', 'Signals and Noise',
    ]) assert.equal(isJunkTitle(t), false, t);
});

function t1(title: string, siteName = ''): DirectFetchResult {
    return { title, citationTitle: undefined, citationPublisher: undefined, description: '', image: undefined, favicon: '', url: 'https://x.example/a', type: '', siteName, authors: [], published: undefined, scholarly: false, contentType: 'text/html', brand: { favicon: '', appIcon: undefined, logo: undefined, maskIcon: undefined, maskIconColor: undefined, brandColor: undefined, webManifest: undefined } };
}

test('a junk Jina or stored title never displaces a real one', () => {
    // 8j90if: the stored light title was good; Jina returned "Just a moment...".
    const pre = buildPrefill({
        parsed: null,
        existing: { title: 'Top 5 Open Source Identity and Access Management (IAM) Tools' },
        tier1: null,
        tier2: { title: 'Just a moment...', authors: [], datePublished: undefined, publisher: undefined },
    });
    assert.equal(pre.title, 'Top 5 Open Source Identity and Access Management (IAM) Tools');
    // 0kal5f: the stored title was junk; the footnote has the real one.
    const fromFootnote = buildPrefill({
        parsed: { hexId: 'x', referenceText: '', title: 'First Mover Disadvantage', url: 'https://mtroyal.ca/x', datePublished: undefined, authors: [], trailingSegments: [], publisher: undefined },
        existing: { title: 'Page not found | MRU' },
        tier1: null,
        tier2: null,
    });
    assert.equal(fromFootnote.title, 'First Mover Disadvantage');
});

test("a page whose og:title is just its site name doesn't supply the title", () => {
    // tl0qr5: Asana's og:title was "Asana".
    const pre = buildPrefill({ parsed: null, existing: { title: '12 Tips for Effective Communication in the Workplace' }, tier1: t1('Asana', 'Asana'), tier2: null });
    assert.equal(pre.title, '12 Tips for Effective Communication in the Workplace');
});

afterEach(() => { delete (globalThis as { __requestUrl?: unknown }).__requestUrl; });

test('tier 2 returns null when Jina answers with an error page', async () => {
    (globalThis as { __requestUrl?: unknown }).__requestUrl = () => ({
        status: 200, headers: {}, json: null, arrayBuffer: new ArrayBuffer(0),
        text: 'Title: Not Found - Business Insider\n\nURL Source: https://www.businessinsider.com/x\n\nMarkdown Content:\nThe page you were looking for does not exist.',
    });
    urlCitationService.setApiKey('test');
    assert.equal(await fetchTier2('https://www.businessinsider.com/x'), null);
});

test('named HTML entities are decoded', () => {
    // ns5di0: "What BMW&rsquo;s Corporate VC Offers…"
    const r = parseDirectFetchHtml('<meta property="og:title" content="What BMW&rsquo;s Corporate VC Offers &mdash; a look">', 'https://x.example/');
    assert.equal(r.title, 'What BMW’s Corporate VC Offers — a look');
    assert.equal(parseDirectFetchHtml('<title>Tom &amp;amp; Jerry</title>', 'https://x.example/').title, 'Tom &amp; Jerry', 'double-escaped stays single-escaped');
});

test('a citation marker inside the link text does not break footnote parsing', async () => {
    // tl0qr5 in the vault.
    const { parseFootnote } = await import('../src/services/canonicalSourceService');
    const p = parseFootnote('[^tl0qr5]: 2025, Mar. "[12 Tips for Effective Communication in the Workplace [^o7r24s] • Asana](https://asana.com/resources/effective-communication-workplace)". [Asana](https://asana.com).');
    assert.equal(p.url, 'https://asana.com/resources/effective-communication-workplace');
    assert.match(p.title ?? '', /^12 Tips for Effective Communication in the Workplace/);
    assert.deepEqual(p.authors, []);
});
