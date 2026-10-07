// "Enrich all citations" / "Enrich this citation"
// (context-v/specs/Enrich-Citations.md). The planner, the usage index, and the
// report are pure, so they are tested here without Obsidian or a network.
// Values come from the 2026-10-06 enrichment of the lossless vault
// (context-v/issues/Enriching-the-Lossless-Vault-Citations.md).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TFile, type App } from 'obsidian';
import {
    applyFieldChanges,
    buildUsageIndex,
    hasRealChanges,
    planCitationChanges,
    renderEnrichmentReport,
    type CitationPlan,
    type CitationUsage,
    type FetchedCitation,
    type FieldChange,
} from '../src/services/enrichCitationsService';
import { isCitationFilePath, readVaultNotes } from '../src/services/enrichCitationsRunner';
import type { BrandAssets, DirectFetchResult } from '../src/services/directFetchService';

const TODAY = '2026-10-06';
const OPENCLOUD = '[^80nyxu]: 2021, Nov. ["State of the OpenCloud 2021"](https://www.scribd.com/document/536774580/Battery-Ventures-OpenCloud-Report-2021#fullscreen&from_embed). Scribd. Battery Ventures.';
const OPENCLOUD_URL = 'https://www.scribd.com/document/536774580/Battery-Ventures-OpenCloud-Report-2021#fullscreen&from_embed';

function noBrand(): BrandAssets {
    return { favicon: '', appIcon: undefined, logo: undefined, maskIcon: undefined, maskIconColor: undefined, brandColor: undefined, webManifest: undefined };
}

function tier1(over: Partial<DirectFetchResult> = {}): DirectFetchResult {
    return {
        title: '', citationTitle: undefined, citationPublisher: undefined, description: '', image: undefined,
        favicon: '', url: 'https://x.example/a', type: '', siteName: '', authors: [], published: undefined,
        scholarly: false, contentType: 'text/html', brand: noBrand(), ...over,
    };
}

function fetched(over: Partial<FetchedCitation> = {}): FetchedCitation {
    return { tier1: null, tier2: null, brand: undefined, channel: null, fetchedOn: TODAY, ...over };
}

function usage(files: string[], definition?: string): CitationUsage {
    return { files, definition };
}

function byKey(changes: FieldChange[]): Record<string, unknown> {
    return Object.fromEntries(changes.map(c => [c.key, c.to]));
}

describe('planCitationChanges', () => {
    test('an empty citation file plus its footnote: the light and schema fields are filled', () => {
        const changes = planCitationChanges(
            { hexId: '80nyxu', title: '', author: '', url: '', date: '', source: '', referenceText: '', filesUsedIn: [] },
            fetched(),
            usage(['Vocabulary/Open Source Software.md'], OPENCLOUD),
        );
        const to = byKey(changes);
        assert.equal(to['title'], 'State of the OpenCloud 2021');
        assert.equal(to['url'], OPENCLOUD_URL);
        assert.equal(to['date'], '2021-11');
        assert.equal(to['source'], 'Battery Ventures');
        assert.equal(to['referenceText'], OPENCLOUD.replace('[^80nyxu]: ', ''));
        // No person is credited, so the publisher is the group author.
        assert.equal(to['author'], 'Battery Ventures');
        assert.deepEqual(to['authors'], ['Battery Ventures']);
        assert.equal(to['publisher'], 'Battery Ventures');
        assert.equal(to['publisher_url'], 'https://www.scribd.com');
        assert.equal(to['date_published'], '2021-11');
        assert.deepEqual(to['filesUsedIn'], ['[[Vocabulary/Open Source Software|Open Source Software]]']);
        // Tier 1 failed, so the access date is not claimed.
        assert.equal('date_recently_accessed' in to, false);
        for (const c of changes) assert.ok(c.reason.trim(), `${c.key} has no reason`);
        const title = changes.find(c => c.key === 'title');
        assert.equal(title?.from, '');
    });

    test('a stored junk author ("3 minutes") is replaced by a real one', () => {
        const changes = planCitationChanges(
            { hexId: 'r3min0', title: 'How to Price a SaaS Product', url: 'https://x.example/a', author: '3 minutes' },
            fetched({ tier1: tier1({ title: 'How to Price a SaaS Product', authors: ['Kyle Poyar'] }) }),
            undefined,
        );
        const author = changes.find(c => c.key === 'author');
        assert.equal(author?.from, '3 minutes');
        assert.equal(author?.to, 'Kyle Poyar');
        assert.deepEqual(byKey(changes)['authors'], ['Kyle Poyar']);
    });

    test('a CMS placeholder author ("Super User") is replaced, and emptied when no name is known', () => {
        const replaced = planCitationChanges(
            { hexId: 'su0001', url: 'https://x.example/a', author: 'Super User' },
            fetched({ tier1: tier1({ authors: ['Ada Lovelace'] }) }),
            undefined,
        );
        assert.equal(byKey(replaced)['author'], 'Ada Lovelace');
        const emptied = planCitationChanges({ hexId: 'su0002', author: 'Super User' }, fetched(), undefined);
        assert.equal(byKey(emptied)['author'], '');
    });

    test('a real stored title is kept over a fetched one', () => {
        const changes = planCitationChanges(
            { hexId: '8j90if', title: 'Top 5 Open Source Identity and Access Management (IAM) Tools', url: 'https://logto.medium.com/x' },
            fetched({ tier1: tier1({ title: 'Something Else Entirely | Medium' }) }),
            undefined,
        );
        assert.equal(changes.some(c => c.key === 'title'), false);
    });

    test('a stored "Page not found | MRU" title is replaced with the footnote’s', () => {
        const changes = planCitationChanges(
            { hexId: '0kal5f', title: 'Page not found | MRU', url: 'https://mtroyal.ca/x' },
            fetched(),
            usage(['Concepts/First Mover Advantage.md'], '[^0kal5f]: 2019. ["First Mover Disadvantage"](https://mtroyal.ca/x). Mount Royal University.'),
        );
        const title = changes.find(c => c.key === 'title');
        assert.equal(title?.from, 'Page not found | MRU');
        assert.equal(title?.to, 'First Mover Disadvantage');
    });

    test('an entity-encoded stored title is decoded', () => {
        const changes = planCitationChanges(
            { hexId: 'ns5di0', title: 'What BMW&rsquo;s Corporate VC Offers', url: 'https://x.example/bmw' },
            fetched(),
            undefined,
        );
        const title = changes.find(c => c.key === 'title');
        assert.equal(title?.to, 'What BMW’s Corporate VC Offers');
    });

    test('filesUsedIn: stale plain paths become [[full/path|Alias]] links to the notes that cite it today', () => {
        const changes = planCitationChanges(
            { hexId: '3l14s3', title: 'Relational model', url: 'https://x.example/r', filesUsedIn: ['Vocabulary/Relational Database.md'] },
            fetched(),
            usage(['Vocabulary/Relational Databases.md']),
        );
        const files = changes.find(c => c.key === 'filesUsedIn');
        assert.deepEqual(files?.from, ['Vocabulary/Relational Database.md']);
        assert.deepEqual(files?.to, ['[[Vocabulary/Relational Databases|Relational Databases]]']);
    });

    test('filesUsedIn uses the Obsidian linker when given, so aliases come from note titles', () => {
        const path = 'projects/Context-Vigilance/Philosophy/Our-Approach.md';
        const linker = {
            link: (p: string) => `[[${p.replace(/\.md$/, '')}|Our Approach]]`,
            refersTo: () => false,
            upgrade: (e: string) => e,
        };
        const changes = planCitationChanges({ hexId: 'e2kfhb' }, fetched(), usage([path]), linker);
        assert.deepEqual(byKey(changes)['filesUsedIn'], ['[[projects/Context-Vigilance/Philosophy/Our-Approach|Our Approach]]']);
    });

    test('no usage found: the stored filesUsedIn is kept', () => {
        const stored = { hexId: 'y0ml1v', title: 'FP&A basics', url: 'https://x.example/f', filesUsedIn: ['[[FP&A|FP&A]]'] };
        assert.equal(planCitationChanges(stored, fetched(), undefined).some(c => c.key === 'filesUsedIn'), false);
        assert.equal(planCitationChanges(stored, fetched(), usage([])).some(c => c.key === 'filesUsedIn'), false);
    });

    test('canonical is never set, whatever was fetched', () => {
        for (const current of [{ hexId: 'c1' }, { hexId: 'c2', canonical: false }]) {
            const changes = planCitationChanges(current, fetched({ tier1: tier1({ title: 'A Real Title', authors: ['Ada Lovelace'] }) }), usage(['Note.md'], OPENCLOUD));
            assert.equal(changes.some(c => c.key === 'canonical'), false);
        }
    });

    test('schema fields are added when absent and never blank a stored value', () => {
        const brand: BrandAssets = { ...noBrand(), favicon: 'https://x.example/icon.svg', logo: 'https://x.example/logo.svg', brandColor: '#123456' };
        const changes = planCitationChanges(
            { hexId: 'b1', title: 'T', url: 'https://x.example/a', publisher_logo_url: 'https://kept.example/logo.png', publisher: 'Kept Press' },
            fetched({ tier1: tier1({ title: 'T', siteName: 'Other', image: 'https://x.example/og.png', brand }), brand }),
            undefined,
        );
        const to = byKey(changes);
        assert.equal(to['piece_og_image'], 'https://x.example/og.png');
        assert.equal(to['publisher_favicon_url'], 'https://x.example/icon.svg');
        assert.equal(to['publisher_brand_color'], '#123456');
        assert.equal('publisher_logo_url' in to, false);
        assert.equal('publisher' in to, false);
        assert.equal(to['date_recently_accessed'], TODAY);
    });

    test('an already-enriched file proposes no changes (idempotence)', () => {
        const f = fetched({ tier1: tier1({ title: 'State of the OpenCloud 2021', siteName: 'Scribd', image: 'https://x.example/og.png' }) });
        const u = usage(['Vocabulary/Open Source Software.md'], OPENCLOUD);
        const fm: Record<string, unknown> = { hexId: '80nyxu', title: '', author: '', url: '', date: '', source: '', filesUsedIn: [], canonical: false };
        const first = planCitationChanges(fm, f, u);
        assert.ok(hasRealChanges(first));
        applyFieldChanges(fm, first);
        const second = planCitationChanges(fm, f, u);
        assert.deepEqual(second, []);
        assert.equal(hasRealChanges(second), false);
        // A later run on another day only refreshes the access date.
        const third = planCitationChanges(fm, { ...f, fetchedOn: '2026-11-01' }, u);
        assert.deepEqual(third.map(c => c.key), ['date_recently_accessed']);
        assert.equal(hasRealChanges(third), false);
    });
});

describe('applyFieldChanges', () => {
    test('applies a change only when the field still holds the planned old value', () => {
        const fm: Record<string, unknown> = { title: 'Edited meanwhile', author: '' };
        const applied = applyFieldChanges(fm, [
            { key: 'title', from: '', to: 'Planned', reason: 'empty' },
            { key: 'author', from: '', to: 'Ada Lovelace', reason: 'empty' },
            { key: 'authors', from: undefined, to: ['Ada Lovelace'], reason: 'absent' },
        ]);
        assert.deepEqual(applied.map(c => c.key), ['author', 'authors']);
        assert.equal(fm['title'], 'Edited meanwhile');
        assert.equal(fm['author'], 'Ada Lovelace');
        assert.deepEqual(fm['authors'], ['Ada Lovelace']);
    });
});

describe('buildUsageIndex', () => {
    const notes = [
        { path: 'Vocabulary/Relational Databases.md', content: 'Rows and columns.[^3l14s3] Keys too.[^3l14s3]\n\n[^3l14s3]: 1970. ["A Relational Model of Data"](https://x.example/codd). ACM.\n' },
        { path: 'projects/Context-Vigilance/Philosophy/Our-Approach.md', content: 'We cite it again.[^3l14s3] And another.[^e2kfhb]\n' },
        { path: 'Beautiful Soup.md', content: 'Defined but blank.[^569gqp]\n\n[^569gqp]:\n' },
        // The citations folder itself (and its _reports) is not usage.
        { path: 'Citations/3l14s3.md', content: '## Reference\n\n[^3l14s3]: copy\n' },
        { path: 'Citations/_reports/Enrichment-2026-10-06-1200.md', content: '[^e2kfhb]' },
    ];

    test('every note that uses or defines [^id], vault-relative and sorted; the citations folder excluded', () => {
        const index = buildUsageIndex(notes, 'Citations');
        assert.deepEqual(index.get('3l14s3')?.files, ['Vocabulary/Relational Databases.md', 'projects/Context-Vigilance/Philosophy/Our-Approach.md'].sort());
        assert.equal(index.get('3l14s3')?.definition, '[^3l14s3]: 1970. ["A Relational Model of Data"](https://x.example/codd). ACM.');
        assert.deepEqual(index.get('e2kfhb')?.files, ['projects/Context-Vigilance/Philosophy/Our-Approach.md']);
        assert.equal(index.get('e2kfhb')?.definition, undefined);
        // An empty definition is no definition.
        assert.equal(index.get('569gqp')?.definition, undefined);
        assert.deepEqual(index.get('569gqp')?.files, ['Beautiful Soup.md']);
        assert.equal(index.has('nothere'), false);
    });

    test('over a stub vault: nested and symlinked folders are read once each, by vault path', async () => {
        const contents: Record<string, string> = Object.fromEntries(notes.map(n => [n.path, n.content]));
        const files = [...notes.map(n => n.path), 'Vocabulary/Relational Databases.md'].map(path => Object.assign(new TFile(), { path, extension: 'md' }));
        let reads = 0;
        const app = {
            vault: {
                getMarkdownFiles: () => files,
                cachedRead: (f: TFile) => { reads++; return Promise.resolve(contents[f.path] ?? ''); },
            },
        } as unknown as App;
        const read = await readVaultNotes(app, 'Citations');
        // Duplicates collapse; the citations folder is never read.
        assert.equal(reads, 3);
        assert.deepEqual(read.map(n => n.path).sort(), ['Beautiful Soup.md', 'Vocabulary/Relational Databases.md', 'projects/Context-Vigilance/Philosophy/Our-Approach.md'].sort());
        const index = buildUsageIndex(read, 'Citations');
        assert.equal(index.get('3l14s3')?.files.length, 2);
    });

    test('citation files: top-level and nested notes count, the _reports/_text/_files folders do not', () => {
        assert.equal(isCitationFilePath('Citations/3l14s3.md', 'Citations'), true);
        assert.equal(isCitationFilePath('Citations/archive/abc123.md', 'Citations'), true);
        assert.equal(isCitationFilePath('Citations/_reports/Enrichment-2026-10-06-1200.md', 'Citations'), false);
        assert.equal(isCitationFilePath('Citations/_text/80nyxu.md', 'Citations'), false);
        assert.equal(isCitationFilePath('Notes/3l14s3.md', 'Citations'), false);
        assert.equal(isCitationFilePath('Citations/80nyxu.pdf', 'Citations'), false);
    });
});

describe('renderEnrichmentReport', () => {
    function plan(over: Partial<CitationPlan>): CitationPlan {
        return { hexId: 'x', path: 'Citations/x.md', url: undefined, tier1Ok: false, tier2Ok: false, usage: undefined, current: {}, changes: [], ...over };
    }

    const enriched = plan({
        hexId: '80nyxu', path: 'Citations/80nyxu.md', url: OPENCLOUD_URL, tier1Ok: true,
        usage: usage(['Vocabulary/Open Source Software.md'], OPENCLOUD),
        current: { title: '', author: '', date: '' },
        changes: [
            { key: 'title', from: '', to: 'State of the OpenCloud 2021', reason: 'empty' },
            { key: 'author', from: '', to: 'Battery Ventures', reason: 'empty' },
        ],
    });
    const dead = plan({ hexId: 'oq9mgf', path: 'Citations/oq9mgf.md', url: 'https://www.businessinsider.com/gone', usage: usage(['Notes/BI.md'], '[^oq9mgf]: https://www.businessinsider.com/gone'), current: { title: 'Kept', author: '' } });
    const orphan = plan({ hexId: 'yxqi06', path: 'Citations/yxqi06.md', current: { title: 'ChromaDB' } });
    const undefinedMarker = plan({ hexId: '2k7i3j', path: 'Citations/2k7i3j.md', usage: usage(['iFly AGM notes.md']), current: { title: 'Topic' } });

    const input = {
        generatedAt: '2026-10-06 14:05',
        plans: [enriched, dead, orphan, undefinedMarker],
        applied: new Map<string, FieldChange[]>([['Citations/80nyxu.md', enriched.changes]]),
    };

    test('counts per field, dead links, missing footnotes, and fields still empty', () => {
        const md = renderEnrichmentReport(input);
        assert.match(md, /^# Citation enrichment, 2026-10-06 14:05/m);
        assert.match(md, /4 citations checked/);
        assert.match(md, /1 citation changed/);
        assert.match(md, /\| title \| 1 \|/);
        assert.match(md, /\| author \| 1 \|/);
        // Dead or blocked: both tiers failed for a URL.
        assert.match(md, /\[\[Citations\/oq9mgf\|oq9mgf\]\].*https:\/\/www\.businessinsider\.com\/gone/);
        assert.doesNotMatch(md.split('## Dead or blocked links')[1]!.split('##')[0]!, /80nyxu/);
        // No footnote anywhere, telling unused files from undefined markers.
        assert.match(md, /\[\[Citations\/yxqi06\|yxqi06\]\].*not cited/);
        assert.match(md, /\[\[Citations\/2k7i3j\|2k7i3j\]\].*\[\[iFly AGM notes\]\]/);
        // Still empty, after the applied changes: 80nyxu's date; oq9mgf's author.
        const still = md.split('## Fields still empty')[1]!;
        assert.match(still, /80nyxu.*date/);
        assert.doesNotMatch(still, /80nyxu.*title/);
        assert.match(still, /oq9mgf.*author/);
    });

    test('is pure: same input, same text', () => {
        assert.equal(renderEnrichmentReport(input), renderEnrichmentReport(input));
    });

    test('a run with nothing to report says so', () => {
        const md = renderEnrichmentReport({ generatedAt: '2026-10-06 14:05', plans: [], applied: new Map() });
        assert.match(md, /0 citations checked/);
        assert.match(md, /None\./);
    });
});

describe('the runner, over a stub vault with a stubbed requestUrl', () => {
    interface StubFile { path: string; basename: string; extension: string }
    function stubApp(files: Record<string, { fm?: Record<string, unknown>; content: string }>) {
        const tfiles = Object.keys(files).map(path => Object.assign(new TFile(), {
            path, extension: 'md', basename: path.split('/').pop()!.replace(/\.md$/, ''),
        }) as TFile & StubFile);
        const created: Record<string, string> = {};
        const folders: string[] = [];
        const app = {
            vault: {
                getMarkdownFiles: () => tfiles,
                cachedRead: (f: TFile) => Promise.resolve(files[f.path]!.content),
                getAbstractFileByPath: (p: string) => tfiles.find(f => f.path === p) ?? (folders.includes(p) || created[p] !== undefined ? {} : null),
                createFolder: (p: string) => { folders.push(p); return Promise.resolve(); },
                create: (p: string, text: string) => { created[p] = text; return Promise.resolve(Object.assign(new TFile(), { path: p })); },
            },
            metadataCache: {
                getFileCache: (f: TFile) => ({ frontmatter: files[f.path]?.fm }),
                getFirstLinkpathDest: () => null,
            },
            fileManager: {
                processFrontMatter: (f: TFile, fn: (fm: Record<string, unknown>) => void) => {
                    const entry = files[f.path]!;
                    entry.fm = entry.fm ?? {};
                    fn(entry.fm);
                    return Promise.resolve();
                },
            },
        } as unknown as App;
        return { app, files, created };
    }

    test('plans every citation, applies only approved changes, and writes the report under _reports', async () => {
        const { planEnrichment, applyEnrichment, listCitationTargets, writeEnrichmentReport } = await import('../src/services/enrichCitationsRunner');
        const requested: string[] = [];
        (globalThis as { __requestUrl?: (r: { url: string }) => unknown }).__requestUrl = req => {
            requested.push(req.url);
            return { status: 404, headers: {}, text: '', json: null, arrayBuffer: new ArrayBuffer(0) };
        };
        try {
            const { app, files, created } = stubApp({
                'Citations/80nyxu.md': { fm: { hexId: '80nyxu', title: '', author: '', url: '', canonical: false }, content: '' },
                'Citations/yxqi06.md': { fm: { hexId: 'yxqi06', title: 'ChromaDB' }, content: '' },
                'Citations/_reports/Enrichment-old.md': { content: '' },
                'Vocabulary/Open Source Software.md': { content: `Open clouds.[^80nyxu]\n\n${OPENCLOUD}\n` },
            });
            const targets = listCitationTargets(app, 'Citations');
            assert.deepEqual(targets.map(t => t.hexId), ['80nyxu', 'yxqi06']);

            const progress: string[] = [];
            const plans = await planEnrichment(app, targets, {
                folder: 'Citations', today: TODAY, signal: { cancelled: false },
                onProgress: (d, t) => progress.push(`${d}/${t}`),
            });
            assert.ok(plans);
            assert.equal(progress.at(-1), '2/2');
            const [opencloud, chroma] = plans;
            assert.equal(opencloud!.url, OPENCLOUD_URL);
            assert.equal(opencloud!.tier1Ok, false);
            assert.ok(hasRealChanges(opencloud!.changes));
            assert.equal(chroma!.url, undefined);
            assert.ok(requested.length > 0, 'the URL was fetched through requestUrl');
            // Planning writes nothing.
            assert.equal(files['Citations/80nyxu.md']!.fm!['title'], '');

            const applied = await applyEnrichment(app, [opencloud!]);
            assert.equal(files['Citations/80nyxu.md']!.fm!['title'], 'State of the OpenCloud 2021');
            assert.equal(files['Citations/80nyxu.md']!.fm!['canonical'], false);
            assert.equal(files['Citations/yxqi06.md']!.fm!['author'], undefined);

            const report = await writeEnrichmentReport(app, 'Citations', '2026-10-06-1405',
                renderEnrichmentReport({ generatedAt: '2026-10-06 14:05', plans, applied }));
            assert.equal(report.path, 'Citations/_reports/Enrichment-2026-10-06-1405.md');
            assert.match(created[report.path]!, /\| title \| 1 \|/);
            assert.match(created[report.path]!, /yxqi06\|yxqi06\]\]: not cited/);
            const again = await writeEnrichmentReport(app, 'Citations', '2026-10-06-1405', 'x');
            assert.equal(again.path, 'Citations/_reports/Enrichment-2026-10-06-1405-2.md');
        } finally {
            delete (globalThis as { __requestUrl?: unknown }).__requestUrl;
        }
    });

    test('cancel stops before the review step', async () => {
        const { planEnrichment, listCitationTargets } = await import('../src/services/enrichCitationsRunner');
        const { app } = stubApp({ 'Citations/a1.md': { fm: { hexId: 'a1' }, content: '' }, 'Citations/b2.md': { fm: { hexId: 'b2' }, content: '' } });
        const signal = { cancelled: false };
        const plans = await planEnrichment(app, listCitationTargets(app, 'Citations'), {
            folder: 'Citations', today: TODAY, signal, concurrency: 1,
            onProgress: d => { if (d === 1) signal.cancelled = true; },
        });
        assert.equal(plans, null);
    });
});

test('date_fetched records the fetch time and, like the access date, is bookkeeping only', async () => {
    const { planCitationChanges, hasRealChanges } = await import('../src/services/enrichCitationsService');
    const at = '2026-10-06T19:54:40.000Z';
    const changes = planCitationChanges(
        { hexId: 'x', title: 'T', url: 'https://example.com/a', author: 'Jane Doe', date: '2025-01', source: 'Acme', referenceText: 'r' },
        { tier1: null, tier2: { title: 'T', authors: [], datePublished: undefined, publisher: undefined }, brand: undefined, channel: null, fetchedOn: '2026-10-06', fetchedAt: at },
        undefined,
    );
    const fetched = changes.find(c => c.key === 'date_fetched');
    assert.equal(fetched?.to, at);
    assert.equal(hasRealChanges(changes.filter(c => c.key === 'date_fetched' || c.key === 'date_recently_accessed')), false);
});
