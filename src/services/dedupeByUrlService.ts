/**
 * Find and consolidate footnote-style citations that point at the same URL.
 *
 * Workflow context: users paste research from multiple LLM/search sources
 * (Perplexity, Google AI, Claude) into the same markdown file across a
 * session, often citing the same article more than once with different
 * hex IDs. This service detects those collisions and rewrites the file
 * so a single canonical hex ID is used for each unique URL.
 */

export interface DuplicateOccurrence {
    /** The hex citation id at this occurrence (`[^hexId]` or `[^hexId]: ...`). */
    hexId: string;
    /** 1-indexed line number, ready to display. */
    lineNumber: number;
    /** Full text of the line for preview rendering. */
    lineContent: string;
    /** True when the occurrence is a reference-section line `[^id]: ...`. */
    isReference: boolean;
    /** Character offset of the citation marker within the line. */
    indexInLine: number;
}

export interface DuplicateGroup {
    /** Normalized URL all hex IDs in this group point at. */
    url: string;
    /** The hex ID we keep (first by inline appearance, falling back to first reference). */
    canonicalHexId: string;
    /** Hex IDs that will be rewritten to canonicalHexId on apply. */
    duplicateHexIds: string[];
    /** All occurrences (inline + reference) sorted by line number. */
    occurrences: DuplicateOccurrence[];
}

export interface DedupeStats {
    groupsDeduped: number;
    inlineReplacements: number;
    referenceLinesRemoved: number;
}

export interface DedupeResult {
    content: string;
    stats: DedupeStats;
}

interface ReferenceEntry {
    hexId: string;
    url: string;
    lineNumber: number;
    lineContent: string;
}

interface InlineOccurrence {
    lineNumber: number;
    lineContent: string;
    index: number;
}

const REFERENCE_LINE_RE = /^\s*\[\^([a-z0-9]+)\]:\s*(.+)$/i;
const ANY_REFERENCE_LINE_RE = /^\s*\[\^[a-z0-9]+\]:/i;

export class DedupeByUrlService {
    /**
     * Analyze content and return groups of citations that share a URL.
     * Only URLs with 2+ reference entries become groups.
     */
    public findDuplicateUrlGroups(content: string): DuplicateGroup[] {
        const lines = content.split('\n');
        const referenceEntries = this.parseReferenceEntries(lines);
        const byUrl = this.groupByUrl(referenceEntries);

        const groups: DuplicateGroup[] = [];
        for (const [url, entries] of byUrl) {
            if (entries.length < 2) continue;

            const allHexIds = entries.map(e => e.hexId);
            const inlineByHex = this.findInlineOccurrences(lines, allHexIds);
            const canonicalHexId = this.pickCanonical(allHexIds, inlineByHex, entries);
            if (!canonicalHexId) continue;

            const occurrences = this.assembleOccurrences(allHexIds, inlineByHex, entries);
            const duplicateHexIds = allHexIds.filter(h => h !== canonicalHexId);

            groups.push({ url, canonicalHexId, duplicateHexIds, occurrences });
        }

        groups.sort((a, b) => {
            const aFirst = a.occurrences[0]?.lineNumber ?? Number.MAX_SAFE_INTEGER;
            const bFirst = b.occurrences[0]?.lineNumber ?? Number.MAX_SAFE_INTEGER;
            return aFirst - bFirst;
        });

        return groups;
    }

    /**
     * Apply consolidation for the chosen groups: rewrite each duplicate
     * hex ID's inline references to the canonical, then remove the
     * duplicate's reference-section line.
     */
    public applyDedup(content: string, groupsToDedupe: DuplicateGroup[]): DedupeResult {
        if (groupsToDedupe.length === 0) {
            return { content, stats: { groupsDeduped: 0, inlineReplacements: 0, referenceLinesRemoved: 0 } };
        }

        const replacementMap = new Map<string, string>();
        const referenceLinesToRemove = new Set<string>();
        for (const group of groupsToDedupe) {
            for (const dupHex of group.duplicateHexIds) {
                replacementMap.set(dupHex, group.canonicalHexId);
                referenceLinesToRemove.add(dupHex);
            }
        }

        let inlineReplacements = 0;
        let referenceLinesRemoved = 0;

        const inLines = content.split('\n');
        const outLines: string[] = [];

        for (const line of inLines) {
            const refMatch = line.match(REFERENCE_LINE_RE);
            if (refMatch && refMatch[1] && referenceLinesToRemove.has(refMatch[1].toLowerCase())) {
                referenceLinesRemoved++;
                continue;
            }

            let updated = line;
            for (const [oldHex, canonicalHex] of replacementMap) {
                const re = new RegExp(`\\[\\^${this.escapeRegex(oldHex)}\\](?!:)`, 'gi');
                updated = updated.replace(re, () => {
                    inlineReplacements++;
                    return `[^${canonicalHex}]`;
                });
            }
            outLines.push(updated);
        }

        return {
            content: outLines.join('\n'),
            stats: {
                groupsDeduped: groupsToDedupe.length,
                inlineReplacements,
                referenceLinesRemoved,
            },
        };
    }

    private parseReferenceEntries(lines: string[]): ReferenceEntry[] {
        const out: ReferenceEntry[] = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            const m = line.match(REFERENCE_LINE_RE);
            if (!m || !m[1] || !m[2]) continue;
            const url = this.extractPrimaryUrl(m[2]);
            if (!url) continue;
            out.push({
                hexId: m[1].toLowerCase(),
                url: this.normalizeUrl(url),
                lineNumber: i + 1,
                lineContent: line,
            });
        }
        return out;
    }

    private groupByUrl(entries: ReferenceEntry[]): Map<string, ReferenceEntry[]> {
        const byUrl = new Map<string, ReferenceEntry[]>();
        for (const entry of entries) {
            const existing = byUrl.get(entry.url);
            if (existing) {
                existing.push(entry);
            } else {
                byUrl.set(entry.url, [entry]);
            }
        }
        return byUrl;
    }

    private findInlineOccurrences(lines: string[], hexIds: string[]): Map<string, InlineOccurrence[]> {
        const result = new Map<string, InlineOccurrence[]>();
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            if (ANY_REFERENCE_LINE_RE.test(line)) continue;

            for (const hexId of hexIds) {
                const re = new RegExp(`\\[\\^${this.escapeRegex(hexId)}\\](?!:)`, 'gi');
                let m: RegExpExecArray | null;
                while ((m = re.exec(line)) !== null) {
                    let arr = result.get(hexId);
                    if (!arr) {
                        arr = [];
                        result.set(hexId, arr);
                    }
                    arr.push({ lineNumber: i + 1, lineContent: line, index: m.index });
                }
            }
        }
        return result;
    }

    private pickCanonical(
        hexIds: string[],
        inlineByHex: Map<string, InlineOccurrence[]>,
        entries: ReferenceEntry[]
    ): string | undefined {
        let canonicalHexId: string | undefined;
        let earliestLine = Number.MAX_SAFE_INTEGER;
        for (const hexId of hexIds) {
            const occs = inlineByHex.get(hexId);
            if (!occs || occs.length === 0) continue;
            const first = occs[0];
            if (first && first.lineNumber < earliestLine) {
                earliestLine = first.lineNumber;
                canonicalHexId = hexId;
            }
        }
        if (canonicalHexId) return canonicalHexId;

        // Fallback: no inline appearances at all — use the first reference entry by line.
        const sortedRefs = [...entries].sort((a, b) => a.lineNumber - b.lineNumber);
        return sortedRefs[0]?.hexId;
    }

    private assembleOccurrences(
        hexIds: string[],
        inlineByHex: Map<string, InlineOccurrence[]>,
        entries: ReferenceEntry[]
    ): DuplicateOccurrence[] {
        const occurrences: DuplicateOccurrence[] = [];
        for (const hexId of hexIds) {
            const inline = inlineByHex.get(hexId) ?? [];
            for (const o of inline) {
                occurrences.push({
                    hexId,
                    lineNumber: o.lineNumber,
                    lineContent: o.lineContent,
                    isReference: false,
                    indexInLine: o.index,
                });
            }
            for (const ref of entries.filter(e => e.hexId === hexId)) {
                occurrences.push({
                    hexId,
                    lineNumber: ref.lineNumber,
                    lineContent: ref.lineContent,
                    isReference: true,
                    indexInLine: 0,
                });
            }
        }
        occurrences.sort((a, b) => a.lineNumber - b.lineNumber);
        return occurrences;
    }

    /**
     * Pull the article URL out of a reference-line tail. Convention: the
     * first markdown link `[Title | Site](url)` if present (the article
     * URL by Jina-extraction format), otherwise the first bare URL.
     */
    private extractPrimaryUrl(text: string): string | undefined {
        const linkMatch = text.match(/\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/);
        if (linkMatch && linkMatch[1]) return linkMatch[1];

        const bareMatch = text.match(/https?:\/\/[^\s)]+/);
        if (bareMatch) return bareMatch[0].replace(/^@/, '');

        return undefined;
    }

    /**
     * Normalize URLs for matching: lowercase host, drop fragment, drop
     * common tracking params, strip trailing punctuation and slash.
     * Survives invalid URLs by returning the lightly-cleaned input.
     */
    private normalizeUrl(url: string): string {
        const cleaned = url.replace(/[.,;:)\]]+$/, '');
        try {
            const parsed = new URL(cleaned);
            const dropParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
            for (const p of dropParams) parsed.searchParams.delete(p);
            parsed.hostname = parsed.hostname.toLowerCase();
            parsed.hash = '';
            if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
                parsed.pathname = parsed.pathname.replace(/\/+$/, '');
            }
            return parsed.toString();
        } catch {
            return cleaned;
        }
    }

    private escapeRegex(literal: string): string {
        return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

export const dedupeByUrlService = new DedupeByUrlService();
