/**
 * Table Citation Service
 *
 * Obsidian does not render footnote markers inside table cells — a `[^hex]`
 * in a cell comes out as literal text with no superscript, no hover preview,
 * and no click-to-jump. The citation is silently dead exactly where
 * comparison-heavy research needs it most.
 *
 * This service lifts those markers out of the cells and re-emits them as one
 * attribution line beneath the table:
 *
 *     | Metric        | Benchmark                    |
 *     |---------------|------------------------------|
 *     | GMV Retention | >100% is elite [^01f3ut]     |
 *     | Take Rate     | 10–20% typical [^a4b2c9]     |
 *
 * becomes
 *
 *     | Metric        | Benchmark      |
 *     |---------------|----------------|
 *     | GMV Retention | >100% is elite |
 *     | Take Rate     | 10–20% typical |
 *
 *     Sources for Table: [^01f3ut] [^a4b2c9]
 *
 * Markers are deduped and kept in first-appearance order (left-to-right, then
 * top-to-bottom) — the reading order, which is also how the pair-bonded
 * reorderer thinks about citation sequence.
 *
 * ## Idempotence
 *
 * Running the command twice must not produce a second `Sources for Table:`
 * line or duplicate markers into the existing one. A sources line already
 * sitting below a table is parsed, merged with whatever is still in the
 * cells, and re-emitted deduped. On a second pass the cells are empty, the
 * merge is a no-op, and the output is byte-identical to the input.
 *
 * ## Blockquotes and callouts
 *
 * A table inside `> ` keeps its prefix, and so does the emitted line —
 * including the blank separator, which must be `>` rather than truly empty or
 * the callout terminates early and the sources line falls outside it.
 *
 * Pure TypeScript — no Obsidian imports — so it is exercisable from the CLI
 * harness without spinning up the plugin host, same contract as
 * `llmCitationParserService`.
 */

import { assureSpaceBeforeInlineCitations } from '../utils/citationSpacing';

export interface TableCitationStats {
    /** Tables found (whether or not they contained citations). */
    tablesFound: number;
    /** Tables whose content actually changed. */
    tablesModified: number;
    /** Total markers removed from cells (counts repeats). */
    citationsLifted: number;
    /** Total unique markers emitted across all sources lines. */
    uniqueSourcesEmitted: number;
}

export interface TableCitationResult {
    content: string;
    changed: boolean;
    stats: TableCitationStats;
}

/** Label prefixing the lifted-citation line. */
const SOURCES_LABEL = 'Sources for Table:';

/**
 * A marker plus the single space that our spacing rule guarantees precedes
 * it — removing both keeps cell padding intact, so `| text [^a] |` collapses
 * to `| text |` with no stranded double space to tidy up afterwards.
 */
const MARKER_WITH_LEADING_SPACE_RE = /[ \t]?\[\^([a-z0-9]+)\](?!:)/gi;

/** Bare marker, for reading an existing sources line. */
const MARKER_RE = /\[\^([a-z0-9]+)\](?!:)/gi;

/** A table row: optional indent, any number of blockquote markers, then `|`. */
const ROW_RE = /^([ \t]*(?:>[ \t]*)*)\|/;

/** Opening or closing fence — tables inside code blocks are examples, not data. */
const FENCE_RE = /^[ \t]*(?:```|~~~)/;

interface TableBlock {
    /** Index of the header row. */
    start: number;
    /** Index of the last body row. */
    end: number;
    /** Indent + blockquote prefix shared by the block. */
    prefix: string;
}

export class TableCitationService {
    /**
     * Lift every inline citation out of every table in the document into a
     * `Sources for Table:` line beneath its table.
     */
    public liftTableCitations(content: string): TableCitationResult {
        const lines = content.split('\n');
        const out: string[] = [];
        const stats: TableCitationStats = {
            tablesFound: 0,
            tablesModified: 0,
            citationsLifted: 0,
            uniqueSourcesEmitted: 0,
        };

        let inFence = false;
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];
            if (line === undefined) { i++; continue; }

            if (FENCE_RE.test(line)) {
                inFence = !inFence;
                out.push(line);
                i++;
                continue;
            }

            const table = inFence ? null : this.matchTableAt(lines, i);
            if (!table) {
                out.push(line);
                i++;
                continue;
            }

            stats.tablesFound++;
            i = this.emitTable(lines, table, out, stats);
        }

        const result = out.join('\n');
        return { content: result, changed: result !== content, stats };
    }

    // ─── private helpers ────────────────────────────────────────────────

    /**
     * Rewrite one table and its sources line into `out`. Returns the index of
     * the first line the caller should process next.
     */
    private emitTable(
        lines: string[],
        table: TableBlock,
        out: string[],
        stats: TableCitationStats,
    ): number {
        const { start, end, prefix } = table;
        const ordered: string[] = [];
        const seen = new Set<string>();
        let lifted = 0;

        const rewritten = lines.slice(start, end + 1).map((row, idx) => {
            // idx 1 is the delimiter row (`|---|---|`) — never contains markers.
            if (idx === 1) return row;
            return row.replace(MARKER_WITH_LEADING_SPACE_RE, (_match, hex: string) => {
                const key = hex.toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    ordered.push(key);
                }
                lifted++;
                return '';
            });
        });

        const existing = this.findExistingSourcesLine(lines, end, prefix);

        // Existing markers lead so a re-run is a no-op; newly lifted ones append.
        const merged: string[] = [];
        const mergedSeen = new Set<string>();
        for (const hex of [...(existing?.markers ?? []), ...ordered]) {
            if (mergedSeen.has(hex)) continue;
            mergedSeen.add(hex);
            merged.push(hex);
        }

        out.push(...rewritten);

        let next = end + 1;
        if (merged.length > 0) {
            out.push(this.blankLine(prefix));
            out.push(this.sourcesLine(prefix, merged));
            stats.uniqueSourcesEmitted += merged.length;
            if (existing) next = existing.index + 1;

            // Keep the sources line from being absorbed into whatever follows.
            const following = lines[next];
            if (following !== undefined && following.trim() !== '') {
                out.push(this.blankLine(prefix));
            }
        }

        stats.citationsLifted += lifted;
        if (lifted > 0 || (existing && merged.length !== existing.markers.length)) {
            stats.tablesModified++;
        }

        return next;
    }

    /**
     * A table starts where a row is immediately followed by a delimiter row
     * sharing its prefix, and runs until the first line that isn't a row.
     */
    private matchTableAt(lines: string[], index: number): TableBlock | null {
        const header = lines[index];
        const delimiter = lines[index + 1];
        if (header === undefined || delimiter === undefined) return null;

        const headerMatch = header.match(ROW_RE);
        if (!headerMatch) return null;
        const prefix = headerMatch[1] ?? '';

        if (!this.isDelimiterRow(delimiter, prefix)) return null;

        let end = index + 1;
        while (end + 1 < lines.length && this.isRowWithPrefix(lines[end + 1], prefix)) {
            end++;
        }

        return { start: index, end, prefix };
    }

    private isRowWithPrefix(line: string | undefined, prefix: string): boolean {
        if (line === undefined) return false;
        const match = line.match(ROW_RE);
        return match !== null && (match[1] ?? '') === prefix;
    }

    /** `|---|:---:|---:|` — every cell is dashes with optional alignment colons. */
    private isDelimiterRow(line: string, prefix: string): boolean {
        if (!this.isRowWithPrefix(line, prefix)) return false;
        const cells = this.splitCells(line.slice(prefix.length));
        return cells.length > 0 && cells.every(cell => /^:?-{1,}:?$/.test(cell.trim()));
    }

    /** Split a row body into cells, honouring `\|` escapes. */
    private splitCells(rowBody: string): string[] {
        let body = rowBody.trim();
        if (body.startsWith('|')) body = body.slice(1);
        if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
        return body.split(/(?<!\\)\|/);
    }

    /**
     * Look for a `Sources for Table:` line directly below the table, allowing
     * one blank separator. This is what makes the command idempotent.
     */
    private findExistingSourcesLine(
        lines: string[],
        end: number,
        prefix: string,
    ): { index: number; markers: string[] } | null {
        for (const offset of [1, 2]) {
            const index = end + offset;
            const candidate = lines[index];
            if (candidate === undefined) return null;

            const stripped = candidate.startsWith(prefix)
                ? candidate.slice(prefix.length)
                : candidate.trim();

            if (offset === 1 && stripped.trim() === '') continue;
            if (!stripped.trimStart().startsWith(SOURCES_LABEL)) return null;

            const markers: string[] = [];
            const seen = new Set<string>();
            for (const match of stripped.matchAll(MARKER_RE)) {
                const hex = (match[1] ?? '').toLowerCase();
                if (!hex || seen.has(hex)) continue;
                seen.add(hex);
                markers.push(hex);
            }
            return { index, markers };
        }
        return null;
    }

    private sourcesLine(prefix: string, markers: string[]): string {
        const rendered = markers.map(hex => `[^${hex}]`).join(' ');
        // Route through the shared spacing rule so the label-to-marker
        // boundary obeys the same invariant as everything else.
        return assureSpaceBeforeInlineCitations(`${prefix}${SOURCES_LABEL} ${rendered}`);
    }

    /**
     * A blank line inside a blockquote still needs its `>` or the quote (and
     * any callout built on it) terminates at that line.
     */
    private blankLine(prefix: string): string {
        return prefix.includes('>') ? prefix.trimEnd() : '';
    }
}

// Singleton instance
export const tableCitationService = new TableCitationService();
