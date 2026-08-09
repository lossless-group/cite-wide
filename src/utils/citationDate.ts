// cite-wide/src/utils/citationDate.ts

/**
 * Lossless citation date convention: `YYYY, Mon DD`, day zero-padded.
 *
 *   2025, Apr 28
 *   2025, Apr 06   ← days 1–9 are padded, never bare
 *
 * Year-major so citations sort chronologically as plain strings, and so a
 * reference section reads its most load-bearing field first. The comma sits
 * after the year only; the period that closes the date expression is NOT
 * added here — `formatCitation` joins every citation part with `. `, so the
 * helper returning a trailing period would double it.
 *
 * Precision is preserved rather than invented: a source that only published
 * `2025-04` yields `2025, Apr`, and a bare `2025` yields `2025`. We never
 * fabricate a day the publisher didn't state.
 */

const MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * Format a published-time string (ISO 8601 or anything `Date` can parse)
 * into the Lossless citation convention. Returns `undefined` when the input
 * is unparseable, so callers can decide whether to warn or omit the field.
 */
export function formatCitationDate(publishedTime: string): string | undefined {
    const raw = publishedTime.trim();
    if (!raw) return undefined;

    // Year-only and year-month sources carry no day to render.
    const yearOnly = /^(\d{4})$/.exec(raw);
    if (yearOnly && yearOnly[1]) return yearOnly[1];

    const yearMonth = /^(\d{4})-(\d{2})$/.exec(raw);
    if (yearMonth && yearMonth[1] && yearMonth[2]) {
        const month = MONTHS[Number(yearMonth[2]) - 1];
        return month ? `${yearMonth[1]}, ${month}` : yearMonth[1];
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return undefined;

    // UTC getters throughout: a date-only string like `2022-04-28` is parsed as
    // UTC midnight, so local getters would slide it back a day west of Greenwich.
    const year = parsed.getUTCFullYear();
    const month = MONTHS[parsed.getUTCMonth()];
    const day = String(parsed.getUTCDate()).padStart(2, '0');

    return month ? `${year}, ${month} ${day}` : String(year);
}
