// Google AI changed its paste format (2026-10): no reference list at the end,
// just a `[1] (url), [2] (url)` cluster after each sentence, numbered from 1
// every time. Fixture text is from a real paste into "Responsible AI.md".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { llmCitationParserService as svc } from '../src/services/llmCitationParserService';

const paste = `Responsible AI is the practice of governing AI. [1] (https://www.ibm.com/think/topics/responsible-ai), [2] (https://hai.stanford.edu/ai-definitions/what-is-responsible-ai)

Core Principles

• Fairness: AI systems must treat people equitably. [1] (https://www.microsoft.com/en-us/ai/responsible-ai), [2] (https://www.youtube.com/watch?v=vYQOXE5VaRk&t=16)
• Privacy: Personal data must be protected. [1] (https://www.youtube.com/watch?v=vYQOXE5VaRk&t=16), [2] (https://en.wikipedia.org/wiki/Privacy_(law))
Would you like to explore more?`;

test('clusters become one numeric reference list, deduped by URL', () => {
    const out = svc.normalizeInlineUrlCitations(paste);
    assert.match(out, /governing AI\. \[1, 2\]$/m);
    assert.match(out, /^- Fairness: AI systems must treat people equitably\. \[3, 4\]$/m);
    assert.match(out, /^- Privacy: Personal data must be protected\. \[4, 5\]$/m);
    assert.match(out, /^\[5\] \[https:\/\/en\.wikipedia\.org\/wiki\/Privacy_\(law\)\]\(https:\/\/en\.wikipedia\.org\/wiki\/Privacy_\(law\)\)$/m);
    assert.equal(out.match(/^\[\d+\] \[/gm)?.length, 5);
});

test('end to end: every citation becomes a hex footnote with a definition', () => {
    const normalized = svc.normalizeInlineUrlCitations(paste);
    const result = svc.parseAndTransform(normalized);
    assert.equal(result.flags.filter(f => f.severity === 'warning').length, 0);
    assert.equal(result.stats.refDefsConverted, 5);
    assert.equal(result.stats.numericCitationsConverted, 6);
    assert.doesNotMatch(result.content, /\]\s*\(https?:\/\/[^)]*\),/);
    const youtube = result.numericToHex.get('4');
    assert.ok(youtube);
    assert.equal(result.content.split(`[^${youtube}]`).length - 1, 3); // two inline + one def
});

test('numbers start above an existing old-style reference list', () => {
    const mixed = `Old claim [1].\n\nNew claim. [1] (https://b.example/x)\n\n[1] [Old](https://a.example/y)`;
    const out = svc.normalizeInlineUrlCitations(mixed);
    assert.match(out, /New claim\. \[2\]/);
    assert.match(out, /^\[2\] \[https:\/\/b\.example\/x\]/m);
});

test('content without clusters is untouched', () => {
    const plain = 'A claim [1, 2].\n• not a google paste\n\n[1] [A](https://a.example)\n[2] [B](https://b.example)';
    assert.equal(svc.normalizeInlineUrlCitations(plain), plain);
});
