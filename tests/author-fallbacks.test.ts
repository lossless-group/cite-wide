// Author fallbacks, from probing the 40 author-less citations in the lossless
// vault (2026-10-06). Each fixture mirrors where a real page kept its byline.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseDirectFetchHtml, jsonLdAuthors, twitterWrittenBy, bylineElements } from '../src/services/directFetchService';
import { buildPrefill, fetchYouTubeChannel, isYouTubeUrl } from '../src/services/canonicalSourceService';

const U = 'https://example.com/post';

test('JSON-LD article author (DevRev, Figma, HBR, LinkedIn, dev.to had nothing else)', () => {
    const one = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting","author":{"@type":"Person","name":"Akshaya Seshadri"}}</script>';
    assert.deepEqual(parseDirectFetchHtml(one, U).authors, ['Akshaya Seshadri']);
    const many = '<script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":"Article","author":[{"@type":"Person","name":"Gregor Gimmy"},{"@type":"Person","name":"Dominik Kanbach"}]}]}</script>';
    assert.deepEqual(jsonLdAuthors(many), ['Gregor Gimmy', 'Dominik Kanbach']);
});

test('twitter:data1 is a byline only when label1 says so', () => {
    assert.deepEqual(twitterWrittenBy('<meta name="twitter:label1" content="Written by"><meta name="twitter:data1" content="Kyle O\'Brien">'), ["Kyle O'Brien"]);
    assert.deepEqual(twitterWrittenBy('<meta name="twitter:label1" content="Est. reading time"><meta name="twitter:data1" content="3 minutes">'), []);
});

test('visible byline element is the last HTML resort (Rivery, Deloitte, Harvard DCE)', () => {
    assert.deepEqual(bylineElements('<div class="post-author__name">Chen Cuello</div>'), ['Chen Cuello']);
    assert.deepEqual(bylineElements('<span class="byline">By Maggie Wooll</span>'), ['Maggie Wooll']);
    assert.deepEqual(parseDirectFetchHtml('<p class="author">Mary Sharp Emerson</p>', U).authors, ['Mary Sharp Emerson']);
});

afterEach(() => { delete (globalThis as { __requestUrl?: unknown }).__requestUrl; });

test('YouTube: the channel, via oEmbed', async () => {
    assert.equal(isYouTubeUrl('https://youtu.be/ZJLJnLYwM5w?si=x'), true);
    assert.equal(isYouTubeUrl('https://example.com/youtu.be'), false);
    (globalThis as { __requestUrl?: unknown }).__requestUrl = (req: { url: string }) => {
        assert.match(req.url, /^https:\/\/www\.youtube\.com\/oembed\?format=json&url=/);
        return { status: 200, headers: {}, text: '', arrayBuffer: new ArrayBuffer(0), json: { author_name: 'Dev Tools Made Simple' } };
    };
    assert.equal(await fetchYouTubeChannel('https://youtu.be/ZJLJnLYwM5w'), 'Dev Tools Made Simple');
    const pre = buildPrefill({ parsed: null, existing: { url: 'https://youtu.be/ZJLJnLYwM5w' }, tier1: null, tier2: null, channel: 'Dev Tools Made Simple' });
    assert.deepEqual(pre.authors, ['Dev Tools Made Simple']);
});

test('no person credited: the organization is the group author; Wikipedia is "Wikipedia contributors"', () => {
    const org = buildPrefill({ parsed: null, existing: { url: 'https://www.kaszek.com/companies/trela', source: 'Kaszek' }, tier1: null, tier2: null });
    assert.deepEqual(org.authors, ['Kaszek']);
    const wiki = buildPrefill({ parsed: null, existing: { url: 'https://en.wikipedia.org/wiki/Multi-model_database' }, tier1: null, tier2: null });
    assert.deepEqual(wiki.authors, ['Wikipedia contributors']);
    const person = buildPrefill({ parsed: null, existing: { url: U, author: 'Jane Doe', source: 'Acme' }, tier1: null, tier2: null });
    assert.deepEqual(person.authors, ['Jane Doe'], 'a credited person always wins over the organization');
});

test('a junk publisher is never promoted to group author', () => {
    for (const junk of ['training data', '1 minute', 'Devrev.Published: 2025-05-28 | Updated: 2025-06-03', 'Published: 2021-03-21 | Updated: 2025-04-04']) {
        const pre = buildPrefill({ parsed: null, existing: { url: U, source: junk }, tier1: null, tier2: null });
        assert.deepEqual(pre.authors, [], junk);
        assert.equal(pre.publisher, '', junk);
    }
    const wiki = buildPrefill({ parsed: null, existing: { url: U, source: '[[Sources/Media/Harvard Business Review|Harvard Business Review]]' }, tier1: null, tier2: null });
    assert.deepEqual(wiki.authors, ['[[Sources/Media/Harvard Business Review|Harvard Business Review]]'], 'a wikilinked publisher is fine');
});

test('a YouTube channel name is trusted even with digits', () => {
    const pre = buildPrefill({ parsed: null, existing: { url: 'https://youtu.be/lL_j7ilk7rc', source: '[[YouTube]]' }, tier1: null, tier2: null, channel: '5 Minutes Tech' });
    assert.deepEqual(pre.authors, ['5 Minutes Tech']);
});

test('a junk meta author does not shadow a real byline element (Deloitte)', () => {
    const html = '<meta name="author" content="changing demand as the learning needs"><span class="byline">By</span><span class="byline__name">Maggie Wooll</span>';
    assert.deepEqual(parseDirectFetchHtml(html, U).authors, ['Maggie Wooll']);
});

test("BEM byline names win; job-title and role elements never count (Deloitte's real markup)", () => {
    const html = '<span class="cmp-di-authors__text">By</span>'
        + '<span class="cmp-di-authors__name cmp-di-authors__name--external">Maggie Wooll</span>'
        + '<span class="cmp-di-authors__name cmp-di-authors__name--external">John Hagel III</span>'
        + '<div class="author-role">Former Independent Co-Chairman</div>';
    assert.deepEqual(bylineElements(html), ['Maggie Wooll', 'John Hagel III']);
    assert.deepEqual(bylineElements('<div class="author-role">Head of Research</div><div class="author-bio">Writes about X</div>'), []);
});

test("Jina's fetch-time 'Published Time' is not a publication date", async () => {
    const { plausiblePublishedTime } = await import('../src/services/canonicalSourceService');
    const now = Date.parse('Tue, 06 Oct 2026 20:00:00 GMT');
    assert.equal(plausiblePublishedTime('Tue, 06 Oct 2026 19:54:40 GMT', now), undefined, 'minutes before the fetch');
    assert.equal(plausiblePublishedTime('2026-10-04T08:00:00Z', now), undefined, 'two days before');
    assert.equal(plausiblePublishedTime('2025-06-11T00:00:00Z', now), '2025-06-11T00:00:00Z');
    assert.equal(plausiblePublishedTime(undefined, now), undefined);
});
