/**
 * Boundary coercers — convert untrusted `unknown` values (YAML frontmatter,
 * JSON API responses, undocumented Obsidian APIs) into well-typed shapes.
 *
 * Lossy and non-throwing on purpose: garbage input yields `undefined` / `[]`
 * rather than an exception, so the plugin never crashes on bad frontmatter.
 *
 * See context-v/reminders/Obsidian-Type-Safety.md §3 for the strategy.
 */

export function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function asString(v: unknown): string | undefined {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'boolean') return String(v);
    return undefined;
}

export function asNumber(v: unknown): number | undefined {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
}

export function asStringArray(v: unknown): string[] {
    if (Array.isArray(v)) {
        const out: string[] = [];
        for (const item of v) {
            const s = asString(item);
            if (s !== undefined) out.push(s);
        }
        return out;
    }
    const single = asString(v);
    return single === undefined ? [] : [single];
}

export function asDate(v: unknown): string | undefined {
    const s = asString(v);
    if (s === undefined) return undefined;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
