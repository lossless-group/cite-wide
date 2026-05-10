/**
 * LLM Citation Parser Service
 *
 * Transforms numeric citation patterns from LLM tool outputs (Google AI,
 * Perplexity) into the Lossless hex-footnote format. Designed to handle
 * messy real-world files where LLM-generated citations coexist with
 * already-converted Lossless citations and partial human edits.
 *
 * Key design decisions vs. the simpler `citationService.convertAllCitations`:
 *
 * 1. Two-phase pipeline: parse → transform. Parse builds a complete picture
 *    of the file's citation landscape (numeric refs, hex refs, inline
 *    citations, orphans, collisions) before any transformation runs.
 * 2. Multi-form handling: `[1, 2, 3]` (Google AI) and `[1][2][3]` (Perplexity
 *    adjacent) are recognized and expanded into space-separated hex markers
 *    matching Lossless inline-citation conventions.
 * 3. Already-Lossless preservation: any `[^hex]` inline or `[^hex]:` ref def
 *    is left untouched. Mid-file human conversions are preserved.
 * 4. Collision detection: if the same numeric reference is defined twice
 *    (suggests two LLM-output clusters with overlapping numbering), that
 *    number is flagged and skipped — auto-transformation is unsafe.
 * 5. Orphan flagging: inline citations without ref defs, and ref defs
 *    without inline citations, are surfaced in the flags list. Not fatal,
 *    not auto-fixed.
 *
 * Pure TypeScript — no Obsidian imports — so the service is testable from
 * a CLI harness without spinning up the plugin host.
 */

export type TokenKind =
    | 'inline-numeric-single'        // [12]
    | 'inline-numeric-multi-comma'   // [1, 2, 3] — Google AI
    | 'inline-numeric-multi-adjacent'// [1][2][3] (no space) — Perplexity
    | 'inline-hex'                   // [^abc123]
    | 'refdef-numeric'               // line-anchored: [N] [Title](url) or [N]: text
    | 'refdef-hex';                  // line-anchored: [^abc123]: text

export interface CitationToken {
    kind: TokenKind;
    raw: string;
    /** 1-indexed line number. */
    line: number;
    /** 0-indexed column where the citation starts on the line. */
    col: number;
    /** For numeric tokens: ['1','2','3']. For hex tokens: ['abc123']. Always lowercase for hex. */
    numbers: string[];
    /** For refdef-* tokens: everything after the `[N]` or `[^hex]:`. */
    refDefBody?: string;
}

export type FlagSeverity = 'info' | 'warning' | 'error';

export interface ParseFlag {
    severity: FlagSeverity;
    code: string;
    message: string;
    line?: number;
    relatedNumber?: string;
}

export interface ParseResult {
    tokens: CitationToken[];
    /** Map from numeric ID to its ref-def token. Excludes collisions. */
    numericRefs: Map<string, CitationToken>;
    /** Map from hex ID to its ref-def token. */
    hexRefs: Map<string, CitationToken>;
    inlineNumeric: CitationToken[];
    inlineHex: CitationToken[];
    flags: ParseFlag[];
}

export interface TransformStats {
    numericCitationsConverted: number;
    refDefsConverted: number;
    hexCitationsPreserved: number;
    flagsRaised: number;
    inlineRepetitionsCollapsed: number;
}

export interface TransformResult {
    content: string;
    stats: TransformStats;
    flags: ParseFlag[];
    /** Mapping of numeric → generated hex for traceability. */
    numericToHex: Map<string, string>;
}

const HEX_INLINE_RE = /\[\^([a-z0-9]+)\](?!:)/gi;
const NUM_INLINE_SINGLE_RE = /\[(\d+)\](?!:)/g;
const NUM_INLINE_MULTI_COMMA_RE = /\[(\d+(?:\s*,\s*\d+)+)\]/g;
const REFDEF_HEX_RE = /^(\s*)\[\^([a-z0-9]+)\]:\s*(.*)$/i;
const REFDEF_NUM_RE = /^(\s*)\[(\d+)\](:?)\s+(.*)$/;

export class LlmCitationParserService {
    public parse(content: string): ParseResult {
        const lines = content.split('\n');
        const tokens: CitationToken[] = [];
        const numericRefs = new Map<string, CitationToken>();
        const hexRefs = new Map<string, CitationToken>();
        const inlineNumeric: CitationToken[] = [];
        const inlineHex: CitationToken[] = [];
        const flags: ParseFlag[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line === undefined) continue;
            const lineTokens = this.tokenizeLine(line, i + 1);
            for (const tok of lineTokens) {
                tokens.push(tok);
                switch (tok.kind) {
                    case 'refdef-numeric': {
                        const n = tok.numbers[0];
                        if (n === undefined) break;
                        if (numericRefs.has(n)) {
                            flags.push({
                                severity: 'warning',
                                code: 'duplicate-numeric-ref',
                                message: `Numeric ref [${n}] defined more than once — auto-transform skipped (likely two LLM-output clusters with overlapping numbering)`,
                                line: tok.line,
                                relatedNumber: n,
                            });
                        } else {
                            numericRefs.set(n, tok);
                        }
                        break;
                    }
                    case 'refdef-hex': {
                        const h = tok.numbers[0];
                        if (h !== undefined) hexRefs.set(h, tok);
                        break;
                    }
                    case 'inline-numeric-single':
                    case 'inline-numeric-multi-comma':
                    case 'inline-numeric-multi-adjacent':
                        inlineNumeric.push(tok);
                        break;
                    case 'inline-hex':
                        inlineHex.push(tok);
                        break;
                }
            }
        }

        // Orphan: inline numeric citation with no matching ref def
        const numericUsed = new Set<string>();
        for (const tok of inlineNumeric) for (const n of tok.numbers) numericUsed.add(n);
        for (const n of numericUsed) {
            if (!numericRefs.has(n)) {
                flags.push({
                    severity: 'warning',
                    code: 'orphan-inline-numeric',
                    message: `Inline citation [${n}] used but no reference definition found`,
                    relatedNumber: n,
                });
            }
        }
        // Orphan: numeric ref def with no inline citation pointing at it
        for (const [n] of numericRefs) {
            if (!numericUsed.has(n)) {
                flags.push({
                    severity: 'info',
                    code: 'orphan-numeric-ref',
                    message: `Reference [${n}] defined but never cited inline`,
                    relatedNumber: n,
                });
            }
        }

        // Same for hex
        const hexUsed = new Set<string>();
        for (const tok of inlineHex) {
            const h = tok.numbers[0];
            if (h !== undefined) hexUsed.add(h);
        }
        for (const h of hexUsed) {
            if (!hexRefs.has(h)) {
                flags.push({
                    severity: 'warning',
                    code: 'orphan-inline-hex',
                    message: `Inline citation [^${h}] used but no reference definition found`,
                    relatedNumber: h,
                });
            }
        }
        for (const [h] of hexRefs) {
            if (!hexUsed.has(h)) {
                flags.push({
                    severity: 'info',
                    code: 'orphan-hex-ref',
                    message: `Hex reference [^${h}] defined but never cited inline`,
                    relatedNumber: h,
                });
            }
        }

        return { tokens, numericRefs, hexRefs, inlineNumeric, inlineHex, flags };
    }

    /**
     * Pre-compute the numeric → hex mapping for every transformable numeric.
     * Used by UI layers (the modal) to preview transformations before any
     * write happens. Excludes collision numbers; includes every numeric that
     * has a ref def and no collision.
     *
     * `additionalUsedHexes` lets a caller (e.g. the paste-LLM-content modal)
     * exclude hex IDs that exist in some other context (the active document
     * the pasted content will be inserted into) so generated hexes don't
     * collide with citations already in that surrounding context.
     */
    public proposeHexMapping(
        parseResult: ParseResult,
        additionalUsedHexes?: Set<string>
    ): Map<string, string> {
        const collisionNumbers = new Set<string>();
        for (const flag of parseResult.flags) {
            if (flag.code === 'duplicate-numeric-ref' && flag.relatedNumber) {
                collisionNumbers.add(flag.relatedNumber);
            }
        }
        const numericToHex = new Map<string, string>();
        const usedHexes = new Set<string>(parseResult.hexRefs.keys());
        if (additionalUsedHexes) {
            for (const h of additionalUsedHexes) usedHexes.add(h);
        }
        const sortedNums = [...parseResult.numericRefs.keys()]
            .filter(n => !collisionNumbers.has(n))
            .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
        for (const n of sortedNums) {
            const hex = this.generateUniqueHex(usedHexes);
            usedHexes.add(hex);
            numericToHex.set(n, hex);
        }
        return numericToHex;
    }

    /**
     * Transform the content. Optionally pass `selectedNumbers` to restrict
     * which numerics actually get converted, and `mapping` to use a
     * pre-computed numeric → hex mapping (so a UI preview shows the same
     * hexes that get written). When mapping is omitted, fresh hexes are
     * generated.
     */
    public transform(
        content: string,
        parseResult: ParseResult,
        options?: { selectedNumbers?: Set<string>; mapping?: Map<string, string> }
    ): TransformResult {
        const mapping = options?.mapping ?? this.proposeHexMapping(parseResult);
        const selectedNumbers = options?.selectedNumbers;

        // Filter the mapping by selection (if any).
        const numericToHex = new Map<string, string>();
        for (const [n, h] of mapping) {
            if (!selectedNumbers || selectedNumbers.has(n)) {
                numericToHex.set(n, h);
            }
        }

        let numericCitationsConverted = 0;
        let refDefsConverted = 0;
        const hexCitationsPreserved = parseResult.hexRefs.size + parseResult.inlineHex.length;

        const inLines = content.split('\n');
        const outLines: string[] = [];
        for (const line of inLines) {
            // Hex ref defs: preserve verbatim.
            if (REFDEF_HEX_RE.test(line)) {
                outLines.push(line);
                continue;
            }
            // Numeric ref defs: replace if transformable, otherwise preserve.
            // When transforming, also restructure the body into the Lossless
            // canonical shape (markdown-link-wrapped title) when it isn't
            // already — handles Perplexity's `Title https://url` form.
            const numRefMatch = line.match(REFDEF_NUM_RE);
            if (numRefMatch && this.looksLikeRefDefBody(numRefMatch[4] ?? '')) {
                const indent = numRefMatch[1] ?? '';
                const num = numRefMatch[2] ?? '';
                const body = numRefMatch[4] ?? '';
                const hex = numericToHex.get(num);
                if (hex) {
                    outLines.push(`${indent}[^${hex}]: ${this.reformatRefDefBodyAsMarkdownLink(body)}`);
                    refDefsConverted++;
                } else {
                    outLines.push(line);
                }
                continue;
            }

            // Inline transformations applied in this order:
            //   1. multi-comma   [1, 2, 3]   → [^a] [^b] [^c]
            //   2. adjacent-multi [1][2][3]  → [^a] [^b] [^c]
            //   3. single        [12]         → [^h]
            // Order matters: multi-comma first so its `[N, M]` doesn't get
            // partially eaten by single-N regex.
            let updated = line;

            updated = updated.replace(NUM_INLINE_MULTI_COMMA_RE, (match, group: string) => {
                const nums = group.split(/\s*,\s*/).map(s => s.trim());
                // Partial conversion: convert whatever has a hex, leave orphans
                // as-is (still numeric). Only rewrite the bracket form if at
                // least one number is convertible — otherwise pure-orphan
                // multi-commas stay visually intact for human review.
                const someTransformable = nums.some(n => numericToHex.has(n));
                if (!someTransformable) return match;
                const parts = nums.map(n => {
                    const hex = numericToHex.get(n);
                    if (hex) {
                        numericCitationsConverted++;
                        return `[^${hex}]`;
                    }
                    return `[${n}]`;
                });
                return parts.join(' ');
            });

            // Adjacent-multi: collapse runs of `[N1][N2]...` (no space) to
            // space-separated hex markers. Run iteratively to handle 3+ in a row.
            const adjacentRe = /\[(\d+)\]\[(\d+)\]/;
            let safetyCounter = 0;
            while (adjacentRe.test(updated) && safetyCounter < 50) {
                updated = updated.replace(adjacentRe, (_match, a: string, b: string) => {
                    const ha = numericToHex.get(a);
                    const hb = numericToHex.get(b);
                    if (ha !== undefined && hb !== undefined) {
                        numericCitationsConverted += 2;
                        return `[^${ha}] [^${hb}]`;
                    }
                    if (ha !== undefined) {
                        numericCitationsConverted += 1;
                        return `[^${ha}] [${b}]`;
                    }
                    if (hb !== undefined) {
                        numericCitationsConverted += 1;
                        return `[${a}] [^${hb}]`;
                    }
                    // Neither transformable — break adjacency by inserting a
                    // single space; the loop exits on the next iteration since
                    // the regex requires zero space between brackets.
                    return `[${a}] [${b}]`;
                });
                safetyCounter++;
            }

            updated = updated.replace(NUM_INLINE_SINGLE_RE, (match, num: string) => {
                const hex = numericToHex.get(num);
                if (hex) {
                    numericCitationsConverted++;
                    return `[^${hex}]`;
                }
                return match;
            });

            // Final whitespace normalization: ensure a single space between
            // closing punctuation and an inline `[^hex]`, and between any
            // two adjacent `[^hex]` markers. Lossless spec requires this
            // shape; LLM source outputs almost never include the spaces.
            updated = this.normalizeInlineCitationSpacing(updated);

            outLines.push(updated);
        }

        // Collapse runs of the same hex marker repeated on the same line
        // (e.g. `[^abc] [^abc] [^abc]`). LLM outputs frequently emit
        // `[1, 1, 1]` or `[1][1][1]` which this transform expands to identical
        // adjacent hex markers; without this pass they'd surface as visual
        // noise in the user's prose.
        const collapseRe = /(\[\^([a-z0-9]+)\])(?:[ \t]+\[\^\2\])+/g;
        let inlineRepetitionsCollapsed = 0;
        const finalContent = outLines.join('\n').replace(collapseRe, (_match, first: string) => {
            inlineRepetitionsCollapsed++;
            return first;
        });

        return {
            content: finalContent,
            stats: {
                numericCitationsConverted,
                refDefsConverted,
                hexCitationsPreserved,
                flagsRaised: parseResult.flags.length,
                inlineRepetitionsCollapsed,
            },
            flags: parseResult.flags,
            numericToHex,
        };
    }

    public parseAndTransform(content: string): TransformResult {
        return this.transform(content, this.parse(content));
    }

    // ─── private helpers ────────────────────────────────────────────────

    private tokenizeLine(line: string, lineNum: number): CitationToken[] {
        const hexRefMatch = line.match(REFDEF_HEX_RE);
        if (hexRefMatch && hexRefMatch[2] !== undefined) {
            return [{
                kind: 'refdef-hex',
                raw: line,
                line: lineNum,
                col: (hexRefMatch[1] ?? '').length,
                numbers: [hexRefMatch[2].toLowerCase()],
                refDefBody: hexRefMatch[3] ?? '',
            }];
        }

        const numRefMatch = line.match(REFDEF_NUM_RE);
        if (numRefMatch && numRefMatch[2] !== undefined && this.looksLikeRefDefBody(numRefMatch[4] ?? '')) {
            return [{
                kind: 'refdef-numeric',
                raw: line,
                line: lineNum,
                col: (numRefMatch[1] ?? '').length,
                numbers: [numRefMatch[2]],
                refDefBody: numRefMatch[4] ?? '',
            }];
        }

        return this.scanInline(line, lineNum);
    }

    /**
     * Heuristic: a refdef line's body should contain a URL somewhere.
     *
     * Originally this only recognized two specific shapes: markdown link at
     * line-start (`[Title](url)`, Google AI / Lossless style) and bare URL
     * at line-start (Lossless `@URL` shorthand). That missed Perplexity's
     * format entirely:
     *
     *     [1] Understanding GitHub Actions https://docs.github.com/articles/...
     *
     * Title text comes first, URL at the end. Loosening to "URL appears
     * anywhere in the body" catches all three formats. The risk of a false
     * positive — a body of pure prose containing an embedded URL — is real
     * but low, because the line-anchored `[N]` prefix already filters out
     * almost everything that isn't a reference definition.
     */
    private looksLikeRefDefBody(body: string): boolean {
        return /https?:\/\//.test(body);
    }

    private scanInline(line: string, lineNum: number): CitationToken[] {
        type Cand = { kind: TokenKind; numbers: string[]; col: number; raw: string };
        const cands: Cand[] = [];
        const claimed = new Set<number>();

        const claim = (start: number, end: number): void => {
            for (let p = start; p < end; p++) claimed.add(p);
        };

        // Multi-comma is captured first because it's the longest pattern;
        // marking its bytes as claimed prevents the single-numeric pass from
        // re-matching the inner numbers.
        let m: RegExpExecArray | null;
        const mc = new RegExp(NUM_INLINE_MULTI_COMMA_RE.source, 'g');
        while ((m = mc.exec(line)) !== null) {
            const nums = (m[1] ?? '').split(/\s*,\s*/).map(s => s.trim());
            cands.push({
                kind: 'inline-numeric-multi-comma',
                numbers: nums,
                col: m.index,
                raw: m[0],
            });
            claim(m.index, m.index + m[0].length);
        }

        const sn = new RegExp(NUM_INLINE_SINGLE_RE.source, 'g');
        while ((m = sn.exec(line)) !== null) {
            if (claimed.has(m.index)) continue;
            cands.push({
                kind: 'inline-numeric-single',
                numbers: [m[1] ?? ''],
                col: m.index,
                raw: m[0],
            });
            claim(m.index, m.index + m[0].length);
        }

        const hx = new RegExp(HEX_INLINE_RE.source, 'gi');
        while ((m = hx.exec(line)) !== null) {
            if (claimed.has(m.index)) continue;
            cands.push({
                kind: 'inline-hex',
                numbers: [(m[1] ?? '').toLowerCase()],
                col: m.index,
                raw: m[0],
            });
            claim(m.index, m.index + m[0].length);
        }

        cands.sort((a, b) => a.col - b.col);

        // Detect adjacency: consecutive inline-numeric-singles where the next
        // token's column equals previous-token's col + raw.length.
        const out: CitationToken[] = [];
        let i = 0;
        while (i < cands.length) {
            const c = cands[i];
            if (!c) break;
            if (c.kind === 'inline-numeric-single') {
                const run: Cand[] = [c];
                while (i + run.length < cands.length) {
                    const last = run[run.length - 1];
                    const next = cands[i + run.length];
                    if (!last || !next) break;
                    if (next.kind === 'inline-numeric-single' && next.col === last.col + last.raw.length) {
                        run.push(next);
                    } else break;
                }
                if (run.length > 1) {
                    out.push({
                        kind: 'inline-numeric-multi-adjacent',
                        line: lineNum,
                        col: run[0]?.col ?? 0,
                        raw: run.map(r => r.raw).join(''),
                        numbers: run.flatMap(r => r.numbers),
                    });
                    i += run.length;
                    continue;
                }
            }
            out.push({ ...c, line: lineNum });
            i++;
        }
        return out;
    }

    /**
     * Insert a single space between any non-whitespace character and an
     * inline `[^hex]` that follows it directly. Covers three Lossless-spec
     * requirements at once:
     *
     *   - punctuation-then-cite (`text. [^hex]`)
     *   - word-then-cite (`changes [^hex]`) — common in Perplexity source
     *   - cite-then-cite (`[^a] [^b]`) — `]` is non-space too
     *
     * Iterates so chains like `text[^a][^b][^c]` resolve fully — each pass
     * fixes one boundary, then the regex re-scans the modified string.
     */
    private normalizeInlineCitationSpacing(line: string): string {
        let result = line;
        const re = /(\S)(\[\^[a-z0-9]+\])/i;
        let safety = 0;
        while (re.test(result) && safety < 100) {
            result = result.replace(re, '$1 $2');
            safety++;
        }
        return result;
    }

    /**
     * Reformat a reference-definition body into the Lossless markdown-link
     * shape `[Title](URL)` when it isn't already. Catches Perplexity's
     * common `Title https://url` form (title text first, URL at end).
     *
     * Skip when the body already contains any markdown link — preserves
     * Lossless / Google-AI inputs that arrive correctly shaped, and avoids
     * double-wrapping anything mid-line that's already a link.
     */
    private reformatRefDefBodyAsMarkdownLink(body: string): string {
        if (/\[.+\]\(.+\)/.test(body)) return body;

        const urlMatch = body.match(/https?:\/\/[^\s)]+/);
        if (!urlMatch || urlMatch.index === undefined) return body;

        const url = urlMatch[0];
        const titleText = body.substring(0, urlMatch.index).trim();
        const suffix = body.substring(urlMatch.index + url.length).trim();

        if (!titleText) {
            return suffix ? `[${url}](${url}) ${suffix}` : `[${url}](${url})`;
        }
        return suffix ? `[${titleText}](${url}) ${suffix}` : `[${titleText}](${url})`;
    }

    private generateUniqueHex(used: Set<string>): string {
        for (let attempt = 0; attempt < 100; attempt++) {
            const num = Math.floor(Math.random() * Math.pow(36, 6));
            const hex = num.toString(36).padStart(6, '0');
            if (!used.has(hex) && /[a-z]/.test(hex) && /\d/.test(hex)) return hex;
        }
        throw new Error('Failed to generate unique hex code after 100 attempts');
    }
}

export const llmCitationParserService = new LlmCitationParserService();
