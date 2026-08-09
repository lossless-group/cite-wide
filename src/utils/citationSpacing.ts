// cite-wide/src/utils/citationSpacing.ts

/**
 * Inline-citation spacing, per the Lossless Citation Spec:
 *
 *   "A single space must stand between the content and the citation."
 *
 * This is a correctness constraint, not a style preference — Obsidian only
 * gives a footnote its hover-preview and click-to-jump behavior when the
 * marker is separated from the preceding text. Same for the Lossless web
 * renderers. A citation glued to the previous character renders as inert
 * literal text.
 *
 * ## Why a lookahead instead of a character class
 *
 * The previous implementation enumerated which characters were allowed to
 * precede a citation:
 *
 *     /([A-Za-z0-9.,:;!?])\s*(\[\^[^\]]+\])/g
 *
 * An allowlist can only ever be incomplete. That one silently skipped
 * straight and curly quotes, closing parens and brackets, en/em dashes,
 * ellipses, `%`, `*` (so any bolded phrase), and every non-ASCII letter —
 * `café[^abc]` was left glued because `é` isn't in `A-Za-z`. See
 * lossless-group/cite-wide#23.
 *
 * The rule we actually want is "any non-whitespace character", so this
 * matches on `\S` and lets the character class go. Expressed as a zero-width
 * insertion — lookbehind for content, lookahead for the marker — so nothing
 * is consumed and a chain like `text[^a][^b][^c]` resolves in a single pass
 * rather than needing an iterate-until-stable loop.
 *
 * ## What it deliberately does not touch
 *
 * - **Reference definitions.** `[^abc]: body` sits at line start (or behind
 *   indentation), so there is no non-whitespace character to its left and the
 *   lookbehind never fires. The `(?!:)` guard covers the pathological case of
 *   a refdef appearing mid-line.
 * - **Markdown reference links.** `[text][ref]` is left alone. The old
 *   `/\](\s*)\[/g → '] ['` rule matched any `][` boundary and split these
 *   into `[text] [ref]`, breaking the link. Citation-to-citation adjacency
 *   (`[^a][^b]`) is still handled here, because `]` is non-whitespace and the
 *   lookahead requires a `[^` marker specifically.
 * - **Numeric citations.** `[1][2]` adjacency is expanded during numeric →
 *   hex conversion in `llmCitationParserService`, which is where it belongs.
 * - **Fenced code blocks.** Neither this nor the implementation it replaces
 *   tracks fences; a literal `foo[^bar]` inside a code block will be spaced.
 *   Pre-existing, noted rather than fixed.
 */

/** An inline `[^hex]` marker — the `(?!:)` excludes reference definitions. */
const INLINE_MARKER = String.raw`\[\^[a-z0-9]+\](?!:)`;

/** Zero-width position: preceded by content, followed by a marker. */
const MISSING_SPACE_RE = new RegExp(`(?<=\\S)(?=${INLINE_MARKER})`, 'gi');

/** Two or more spaces/tabs directly before a marker. */
const EXTRA_SPACE_RE = new RegExp(`[ \\t]{2,}(?=${INLINE_MARKER})`, 'gi');

/**
 * Guarantee exactly one space between any content character and the inline
 * citation that follows it. Idempotent — running it on already-correct text
 * is a no-op. Operates on a single line; callers split on newlines so line
 * breaks are never disturbed.
 */
export function assureSpaceBeforeInlineCitations(line: string): string {
    return line
        .replace(MISSING_SPACE_RE, ' ')
        .replace(EXTRA_SPACE_RE, ' ');
}

/** Line-by-line convenience wrapper for whole-document callers. */
export function assureSpaceBeforeInlineCitationsInDocument(content: string): string {
    return content
        .split('\n')
        .map(assureSpaceBeforeInlineCitations)
        .join('\n');
}
