// Publisher brand assets for canonical sources: favicon, app icon, logo
// (trademark/wordmark), mask icon, brand color, and web manifest, plus the
// homepage fallback for documents and blocked pages.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extractBrandAssets, type BrandAssets, type DirectFetchResult } from '../src/services/directFetchService';
import {
    needsPublisherBrand,
    fetchPublisherBrand,
    mergeBrand,
    assembleCanonicalFrontmatter,
    type CanonicalForm,
} from '../src/services/canonicalSourceService';

// A major news site's <head>, with every asset type declared.
const NEWS_HEAD = `<html><head>
<link rel="apple-touch-icon" sizes="120x120" href="/vi-assets/static-assets/apple-touch-icon-120.png">
<link rel="apple-touch-icon" sizes="180x180" href="/vi-assets/static-assets/apple-touch-icon-180.png">
<link rel="icon" type="image/png" sizes="32x32" href="/vi-assets/static-assets/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/vi-assets/static-assets/icon-192.png">
<link rel="shortcut icon" href="/vi-assets/static-assets/favicon.ico">
<link rel="mask-icon" href="/vi-assets/static-assets/mask-icon.svg" color="#000000">
<link rel="manifest" href="/vi-assets/static-assets/manifest.json">
<meta name="theme-color" content="#ffffff">
<meta property="og:site_name" content="The Daily Record">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","headline":"x",
 "publisher":{"@type":"NewsMediaOrganization","name":"The Daily Record",
 "logo":{"@type":"ImageObject","url":"https://static.dailyrecord.example/images/logo-wordmark.png","width":800}}}</script>
</head><body></body></html>`;

describe('extractBrandAssets', () => {
    test('reads every asset a news site declares', () => {
        const b = extractBrandAssets(NEWS_HEAD, 'https://www.dailyrecord.example/2026/10/06/story.html');
        assert.equal(b.favicon, 'https://www.dailyrecord.example/vi-assets/static-assets/favicon-32.png');
        assert.equal(b.appIcon, 'https://www.dailyrecord.example/vi-assets/static-assets/apple-touch-icon-180.png');
        assert.equal(b.logo, 'https://static.dailyrecord.example/images/logo-wordmark.png');
        assert.equal(b.maskIcon, 'https://www.dailyrecord.example/vi-assets/static-assets/mask-icon.svg');
        assert.equal(b.maskIconColor, '#000000');
        assert.equal(b.brandColor, '#ffffff');
        assert.equal(b.webManifest, 'https://www.dailyrecord.example/vi-assets/static-assets/manifest.json');
    });

    test('the favicon is never the apple-touch-icon, even when that link comes first', () => {
        // The ported extractor matched any rel *containing* "icon", so a page
        // listing apple-touch-icon first reported it as the favicon.
        const b = extractBrandAssets(
            '<link rel="apple-touch-icon" href="/touch.png"><link rel="icon" href="/fav.png">',
            'https://example.com/a'
        );
        assert.equal(b.favicon, 'https://example.com/fav.png');
        assert.equal(b.appIcon, 'https://example.com/touch.png');
    });

    test('prefers an SVG favicon; falls back to /favicon.ico when none is declared', () => {
        const svg = extractBrandAssets('<link rel="icon" sizes="32x32" href="/f.png"><link rel="icon" type="image/svg+xml" href="/f.svg">', 'https://example.com/');
        assert.equal(svg.favicon, 'https://example.com/f.svg');
        assert.equal(extractBrandAssets('<html></html>', 'https://example.com/x').favicon, 'https://example.com/favicon.ico');
    });

    test('app icon falls back to msapplication-TileImage, then a large icon', () => {
        assert.equal(
            extractBrandAssets('<meta name="msapplication-TileImage" content="/tile-270.png">', 'https://example.com/').appIcon,
            'https://example.com/tile-270.png'
        );
        assert.equal(
            extractBrandAssets('<link rel="icon" sizes="32x32" href="/s.png"><link rel="icon" sizes="192x192" href="/l.png">', 'https://example.com/').appIcon,
            'https://example.com/l.png'
        );
    });

    test('logo: JSON-LD inside @graph, a plain-string logo, og:logo, and itemprop', () => {
        const graph = '<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"Organization","logo":"/brand/logo.svg"}]}</script>';
        assert.equal(extractBrandAssets(graph, 'https://firm.example/').logo, 'https://firm.example/brand/logo.svg');
        assert.equal(extractBrandAssets('<meta property="og:logo" content="https://cdn.example/l.png">', 'https://x.example/').logo, 'https://cdn.example/l.png');
        assert.equal(extractBrandAssets('<img class="hdr" itemprop="logo" src="/i/logo.png" alt="">', 'https://x.example/').logo, 'https://x.example/i/logo.png');
    });

    test('malformed JSON-LD is skipped, not fatal', () => {
        const b = extractBrandAssets('<script type="application/ld+json">{not json</script><meta property="og:logo" content="/l.png">', 'https://x.example/');
        assert.equal(b.logo, 'https://x.example/l.png');
    });
});

const EMPTY: BrandAssets = { favicon: 'https://reports.example/favicon.ico', appIcon: undefined, logo: undefined, maskIcon: undefined, maskIconColor: undefined, brandColor: undefined, webManifest: undefined };
const FULL: BrandAssets = { favicon: 'https://home.example/f.svg', appIcon: 'https://home.example/a.png', logo: 'https://home.example/logo.svg', maskIcon: 'https://home.example/m.svg', maskIconColor: '#111', brandColor: '#fff', webManifest: 'https://home.example/manifest.json' };

function page(brand: BrandAssets, contentType = 'text/html'): DirectFetchResult {
    return { title: 'T', citationTitle: undefined, citationPublisher: undefined, description: '', image: undefined, favicon: brand.favicon, url: '', type: '', siteName: '', authors: [], published: undefined, scholarly: false, contentType, brand };
}

describe('homepage fallback', () => {
    afterEach(() => { delete (globalThis as { __requestUrl?: unknown }).__requestUrl; });

    test('needed for a PDF, a failed or blocked fetch, or a page with neither app icon nor logo', () => {
        assert.equal(needsPublisherBrand(page(EMPTY, 'application/pdf'), 'https://reports.example/2021/report.pdf'), true);
        assert.equal(needsPublisherBrand(null, 'https://reports.example/2021/report'), true);
        assert.equal(needsPublisherBrand(page(EMPTY), 'https://reports.example/2021/report'), true);
        assert.equal(needsPublisherBrand(page(FULL), 'https://home.example/story'), false);
        assert.equal(needsPublisherBrand(page(EMPTY), 'https://home.example/'), false, 'already the homepage');
        assert.equal(needsPublisherBrand(null, undefined), false);
    });

    test('fetchPublisherBrand reads the site root', async () => {
        const seen: string[] = [];
        (globalThis as { __requestUrl?: unknown }).__requestUrl = (req: { url: string }) => {
            seen.push(req.url);
            return { status: 200, headers: { 'content-type': 'text/html' }, text: NEWS_HEAD.replace('<html><head>', '<html><head><title>The Daily Record</title>'), json: null, arrayBuffer: new ArrayBuffer(0) };
        };
        const brand = await fetchPublisherBrand('https://www.dailyrecord.example/2026/10/06/story.pdf');
        assert.equal(seen[0], 'https://www.dailyrecord.example');
        assert.equal(brand?.logo, 'https://static.dailyrecord.example/images/logo-wordmark.png');
    });

    test('mergeBrand: page assets win, the homepage fills the gaps', () => {
        const merged = mergeBrand({ ...EMPTY, brandColor: '#abc' }, FULL)!;
        assert.equal(merged.favicon, FULL.favicon, 'a bare /favicon.ico yields to the declared icon');
        assert.equal(merged.logo, FULL.logo);
        assert.equal(merged.brandColor, '#abc', "the page's own value wins");
        assert.equal(mergeBrand(undefined, null), undefined);
    });
});

test('brand assets are written to the canonical record and never blanked', () => {
    const form: CanonicalForm = { title: 'State of the OpenCloud 2021', subtitle: '', authors: [], datePublished: '2021-11', publisher: 'Battery Ventures', publicationType: 'report', url: 'https://reports.example/2021/report.pdf' };
    const ctx = { hexId: '80nyxu', form, fetched: null, brand: FULL, today: '2026-10-06', newUuid: () => 'u-1', now: '2026-10-06T00:00:00Z' };
    const fm = assembleCanonicalFrontmatter({}, ctx);
    assert.equal(fm['publisher_logo_url'], FULL.logo);
    assert.equal(fm['publisher_app_icon_url'], FULL.appIcon);
    assert.equal(fm['publisher_mask_icon_url'], FULL.maskIcon);
    assert.equal(fm['publisher_mask_icon_color'], '#111');
    assert.equal(fm['publisher_brand_color'], '#fff');
    assert.equal(fm['publisher_web_manifest_url'], FULL.webManifest);
    const again = assembleCanonicalFrontmatter(fm, { ...ctx, brand: { ...EMPTY, favicon: '' } });
    assert.equal(again['publisher_logo_url'], FULL.logo, 'a later fetch with no logo keeps the stored one');
});
