#!/usr/bin/env node
// Standalone CLI harness for the LLM citation parser.
//
// Usage:
//   node scripts/parse-llm-citations.mjs <input.md>          # parse-only, prints report
//   node scripts/parse-llm-citations.mjs <input.md> -o <out> # transforms, writes output
//
// This script bundles the parser via esbuild on the fly (cite-wide isn't
// published as a library and the parser file uses TypeScript syntax that
// Node's bare interpreter rejects). Bundle is in-memory; nothing extra
// hits disk.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const parserSource = resolve(repoRoot, 'src/services/llmCitationParserService.ts');

function usage() {
    console.error('Usage: node scripts/parse-llm-citations.mjs <input.md> [-o <output.md>]');
    process.exit(2);
}

const args = process.argv.slice(2);
if (args.length < 1) usage();
const inputPath = args[0];
let outputPath = null;
for (let i = 1; i < args.length; i++) {
    if (args[i] === '-o' && args[i + 1]) {
        outputPath = args[i + 1];
        i++;
    } else {
        console.error(`Unknown argument: ${args[i]}`);
        usage();
    }
}

const tmp = mkdtempSync(join(tmpdir(), 'cite-wide-parse-'));
const bundlePath = join(tmp, 'parser.mjs');

await build({
    entryPoints: [parserSource],
    outfile: bundlePath,
    format: 'esm',
    bundle: true,
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
});

const mod = await import(pathToFileURL(bundlePath).href);
const { llmCitationParserService } = mod;

const content = readFileSync(inputPath, 'utf-8');

if (outputPath === null) {
    // Parse-only mode: print structured report
    const parsed = llmCitationParserService.parse(content);
    const tokenCount = parsed.tokens.length;
    const refdefHexCount = [...parsed.hexRefs.keys()].length;
    const refdefNumCount = [...parsed.numericRefs.keys()].length;
    const inlineHexCount = parsed.inlineHex.length;
    const inlineNumCount = parsed.inlineNumeric.length;

    const inlineByKind = parsed.inlineNumeric.reduce((acc, t) => {
        acc[t.kind] = (acc[t.kind] || 0) + 1;
        return acc;
    }, {});

    console.log('=== Parse Report ===');
    console.log(`File: ${inputPath}`);
    console.log(`Tokens detected: ${tokenCount}`);
    console.log('');
    console.log('Reference definitions:');
    console.log(`  hex (already-Lossless): ${refdefHexCount}`);
    console.log(`  numeric (LLM-style, to convert): ${refdefNumCount}`);
    console.log(`    numbers: [${[...parsed.numericRefs.keys()].sort((a, b) => parseInt(a) - parseInt(b)).join(', ')}]`);
    console.log('');
    console.log('Inline citations:');
    console.log(`  hex (already-Lossless, preserved): ${inlineHexCount}`);
    console.log(`  numeric: ${inlineNumCount}`);
    for (const [k, v] of Object.entries(inlineByKind)) {
        console.log(`    ${k}: ${v}`);
    }
    console.log('');
    console.log(`Flags raised: ${parsed.flags.length}`);
    if (parsed.flags.length > 0) {
        const grouped = parsed.flags.reduce((acc, f) => {
            acc[f.code] = (acc[f.code] || []);
            acc[f.code].push(f);
            return acc;
        }, {});
        for (const [code, flags] of Object.entries(grouped)) {
            console.log(`  [${flags[0].severity}] ${code} (${flags.length})`);
            for (const f of flags.slice(0, 5)) {
                console.log(`    - ${f.message}${f.line ? ` (line ${f.line})` : ''}`);
            }
            if (flags.length > 5) console.log(`    ... ${flags.length - 5} more`);
        }
    }
    process.exit(0);
}

// Transform mode
const result = llmCitationParserService.parseAndTransform(content);
writeFileSync(outputPath, result.content, 'utf-8');

console.log('=== Transform Report ===');
console.log(`Input:  ${inputPath}`);
console.log(`Output: ${outputPath}`);
console.log('');
console.log(`Numeric inline citations converted: ${result.stats.numericCitationsConverted}`);
console.log(`Numeric ref defs converted:         ${result.stats.refDefsConverted}`);
console.log(`Hex citations preserved:            ${result.stats.hexCitationsPreserved}`);
console.log(`Flags raised:                        ${result.stats.flagsRaised}`);
console.log('');
if (result.numericToHex.size > 0) {
    console.log('Numeric → hex mapping:');
    const entries = [...result.numericToHex.entries()].sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    for (const [num, hex] of entries) {
        console.log(`  [${num}] -> [^${hex}]`);
    }
}
if (result.flags.length > 0) {
    console.log('');
    console.log('Flags:');
    for (const f of result.flags) {
        console.log(`  [${f.severity}] ${f.code}: ${f.message}${f.line ? ` (line ${f.line})` : ''}`);
    }
}
