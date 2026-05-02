---
title: "Obsidian Plugin Type Safety — Rules, Patterns, and Cite-Wide Conventions"
purpose: "Reference document for everyone (human or AI) working in the cite-wide codebase. Captures the actual rejection criteria from Obsidian's community plugin review, the patterns we use to satisfy them, and the YAML-frontmatter coercion strategy that keeps content-creator drift from breaking the type system."
status: Authoritative
last_verified: 2026-05-01
applies_to: cite-wide Obsidian community plugin
authors:
  - Michael Staton
augmented_with: Claude Code (Opus 4.7, 1M context)
---

## Why This Document Exists

Cite-Wide was rejected from the Obsidian community plugin store for "lack of
type safety." Concretely, reviewers flagged the use of `any` types. This is the
**single most common reason for plugin rejection**, and the rule is enforced
not by the published prose docs but by an automated linter (`ObsidianReviewBot`)
that runs on every submission PR. The rule is unambiguous and there is **no
appeal mechanism** for `any` violations: even disabling the lint rule via
`eslint-disable` comments is itself flagged as a rejection reason.

This document is the source-of-truth for what we do and don't do with types in
this repo. Read it before adding any non-trivial code, and especially before
opening a re-submission PR.

## Section 1 — The Rules (As Actually Enforced)

### 1.1 Hard "must" rules — violation guarantees rejection

| Rule | Source | Verbatim from review bot |
|---|---|---|
| **No `any`** | `@typescript-eslint/no-explicit-any` run by `ObsidianReviewBot` | *"Unexpected any. Specify a different type."* |
| **No silencing the no-`any` rule** | Bot inspects PRs for suppression directives | *"Disabling '@typescript-eslint/no-explicit-any' is not allowed."* |
| **No unnecessary type assertions** | `@typescript-eslint/no-unnecessary-type-assertion` | *"This assertion is unnecessary since it does not change the type of the expression."* |
| **No unused eslint-disable directives** | bot flag | *"Unused eslint-disable directive..."* |
| **Promises must be handled** | `@typescript-eslint/no-floating-promises` | *"Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator."* |
| **No `[object Object]` in template strings** | `@typescript-eslint/no-base-to-string` | *"'result.error' will use Object's default stringification format ('[object Object]') when stringified."* |

### 1.2 Soft "should" rules — from the prose docs

From <https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines>:

- *"Prefer `const` and `let` over `var`."*
- *"Prefer async/await over Promise."* (Reinforced as hard by the bot's promise rules.)

### 1.3 The `tsconfig.json` baseline

Obsidian's `obsidian-sample-plugin` tsconfig is the **de facto baseline**.
**Cite-Wide's `tsconfig.json` already exceeds this baseline** — we have
`strict: true` plus every individual strict flag including `noImplicitAny`,
`useUnknownInCatchVariables`, `noUncheckedIndexedAccess`, and
`exactOptionalPropertyTypes`. **Do not weaken it.** If a strict flag is causing
friction, the answer is to fix the code, not relax the flag.

## Section 2 — How We Replace `any`

### 2.1 The five replacements that cover ~95% of cases

| If you were going to write… | Use instead | Why |
|---|---|---|
| `function foo(x: any)` | `function foo(x: unknown)` + narrow | `unknown` forces the caller's value to be checked before use |
| `catch (e: any)` | (nothing — `useUnknownInCatchVariables` makes `e` already `unknown`) | Tsconfig flag covers this for free |
| `data as any` (to access a field) | Define a real interface OR coerce with a guard function | The cast hides the risk; the guard surfaces it |
| `Record<string, any>` | `Record<string, unknown>` | Same pattern at the dictionary level |
| `(window as any).foo` | Augment `Window` in a `.d.ts` with `foo: unknown` (or a real type), then narrow | One-time declaration; no `any` leakage |

### 2.2 When you genuinely need a cast

A type assertion is acceptable **only when narrowing cannot express what you
know to be true**. Canonical example accepted by Obsidian reviewers:

```ts
// OK — TS cannot narrow the array element type through a filter predicate alone
const mdFiles = files.filter(f => f instanceof TFile) as TFile[];
```

Three rules for casts:
1. **Never `as any`.** That is a `no-explicit-any` violation regardless of the
   `as` clause.
2. **Never assert into a wider type than is justified.** If the value could be
   `null`, do not assert it as `T`; assert it as `T | null` and narrow.
3. **Never assert what TypeScript can already infer.** That trips
   `no-unnecessary-type-assertion`.

### 2.3 The Obsidian API extension shims

Some Obsidian APIs (e.g. `app.commands`, `window.activeEditor`) are not in the
public `obsidian.d.ts`. Existing shims live in `src/types/obsidian.d.ts`.

**Rule:** shim them with `unknown` or a minimal documented interface, never
`any`. If the shape is unknown, use `unknown` and narrow at use sites with
`typeof` / `in` / `instanceof` guards.

**Audit note (2026-05-01):** the current shim declares `interface App {
commands: any; }` — this is a known violation and one of the things the
type-safety pass needs to remove. Replace with a typed interface describing
the methods we actually call, or with `unknown` if usage is one-off.

## Section 3 — YAML Frontmatter: The Coercion Boundary

### 3.1 The problem

Obsidian users (including our own content creators) author YAML frontmatter by
hand. The same logical field arrives in inconsistent shapes:

| Field's intended type | What content creators actually write |
|---|---|
| `string` | unquoted string (parses fine) |
| `string` | a number (`year: 2024`) — YAML emits a `number` |
| `string` | a boolean-looking word (`status: yes`) — YAML emits `true` |
| `string[]` | a single string (`tags: blog`) — YAML emits `'blog'`, not `['blog']` |
| `string[]` | an inline array (`tags: [a, b]`) — YAML emits `['a', 'b']` |
| `string[]` | a block list (`tags:\n  - a\n  - b`) — YAML emits `['a', 'b']` |
| `number` | a quoted numeric string (`count: "5"`) — YAML emits `'5'`, not `5` |

A naïve `metadata.tags.map(...)` will throw on a string. A naïve
`metadata.count + 1` on a string yields concatenation, not addition.

### 3.2 The strategy: coerce at the boundary

We treat **YAML frontmatter as untrusted input**, identical in trust level to
network responses. The strategy has three layers:

```
┌──────────────────────────────────────────────────────────────────┐
│  YAML on disk (any shape)                                        │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  Layer 1 — Parse with Obsidian's API, NOT a hand-rolled regex    │
│    • app.metadataCache.getFileCache(file)?.frontmatter           │
│    • app.fileManager.processFrontMatter(file, fn)                │
│  Returns values typed as `any` / weakly typed; treat as          │
│  `Record<string, unknown>` regardless.                           │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  Layer 2 — Coerce per field with small guard functions           │
│    • asString(v: unknown): string | undefined                    │
│    • asNumber(v: unknown): number | undefined                    │
│    • asStringArray(v: unknown): string[]                         │
│    • asDate(v: unknown): string | undefined  // ISO string       │
│  These never throw; they return undefined / [] for unusable      │
│  input and leave caller-side null-handling explicit.             │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  Layer 3 — Strict typed object inside our code                   │
│    • CitationMetadata { hexId: string; tags: string[]; ... }     │
│  Once we cross the coercion boundary, types are real and the     │
│  rest of the codebase trusts them.                               │
└──────────────────────────────────────────────────────────────────┘
```

### 3.3 The coercer functions (recommended shape)

These belong in `src/utils/coerce.ts` (file does not yet exist). The functions
are intentionally **lossy and non-throwing** — content creators get garbage
out for garbage in, but the plugin never crashes.

```ts
export function asString(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
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
    return v.map(asString).filter((s): s is string => s !== undefined);
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

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
```

Note the use of **type predicates** (`v is string`, `v is Record<...>`) — these
are how you replace `any` for narrowing. The TypeScript compiler honors them
and the result is fully strict.

### 3.4 Use Obsidian's frontmatter APIs, not regex

Cite-Wide currently hand-rolls a YAML parser
(`src/services/citationFileService.ts:404` `parseFrontmatter`). This is both a
type-safety problem (it uses `(metadata as any)[key]`) and a correctness
problem (the parser splits on `:` so any URL value will be mangled).

**Replace** with one of:

- **Read:** `this.app.metadataCache.getFileCache(file)?.frontmatter`. Returns
  the parsed object or `undefined`.
- **Read+Write atomically:** `this.app.fileManager.processFrontMatter(file,
  (frontmatter) => { ... mutate ... })`. Obsidian handles parse, mutation
  callback, and re-serialization. This is the **preferred path for any code
  that modifies frontmatter** — it avoids hand-rolled YAML emission too.

Both APIs return values weakly typed (Obsidian's d.ts types frontmatter as a
loose object). Treat them as `Record<string, unknown>` and pipe through the
coercers above.

## Section 4 — Local Enforcement (the gap to close)

The Obsidian review bot runs `@typescript-eslint/no-explicit-any` on every
submission PR, but **we currently have no eslint config in this repo** — the
deps are installed but `.eslintrc*` and `eslint.config.*` don't exist. That
means the rule first surfaces during community-store review, which is the
worst possible time.

**Action item (separate ticket):** add a flat-config `eslint.config.mjs` that
mirrors the rules the review bot runs, and gate `pnpm build` on it. At
minimum:

- `@typescript-eslint/no-explicit-any: error`
- `@typescript-eslint/no-unnecessary-type-assertion: error`
- `@typescript-eslint/no-floating-promises: error`
- `@typescript-eslint/no-base-to-string: error`
- `no-unused-disable-directives` (eslint built-in via `--report-unused-disable-directives`)

## Section 5 — Quick Reference: Common Mistakes Found in This Repo

These are the patterns to **stop writing** and the corrections.

### 5.1 Modal constructors

```ts
// ❌ Wrong (main.ts:541)
class ConfirmDuplicateCitationModal extends Modal {
  constructor(app: any, ...) { super(app); }
}

// ✅ Right
import { App } from 'obsidian';
class ConfirmDuplicateCitationModal extends Modal {
  constructor(app: App, ...) { super(app); }
}
```

The Obsidian `Modal` constructor is typed as `constructor(app: App)`. There is
no reason to widen it.

### 5.2 Generic logger payloads

```ts
// ❌ Wrong (src/utils/logger.ts:81 etc.)
private addEntry(level: ..., message: string, details?: any) { ... }

// ✅ Right
private addEntry(level: ..., message: string, details?: unknown) { ... }
```

The logger doesn't operate on the structure of `details` — it just stringifies
it. `unknown` is the correct type and forces any caller-side access to narrow.

### 5.3 Window / private API access

```ts
// ❌ Wrong (src/services/cleanReferencesSectionService.ts:40)
const editor = (window as any).activeEditor?.editor;

// ✅ Right (use the documented public API)
const editor = this.app.workspace.activeEditor?.editor;
```

`activeEditor` is on `app.workspace`. Going through `window` is undocumented
and unnecessary.

### 5.4 External JSON responses (Jina.ai Reader)

```ts
// ❌ Wrong (src/services/urlCitationService.ts:114)
private parseReaderResponse(data: any, originalUrl: string) { ... }

// ✅ Right
interface JinaReaderResponse {
  data?: {
    title?: unknown;
    content?: unknown;
    url?: unknown;
    publishedTime?: unknown;
  };
}
private parseReaderResponse(data: unknown, originalUrl: string) {
  if (!isRecord(data)) return null;
  const inner = isRecord(data.data) ? data.data : undefined;
  const title = asString(inner?.title);
  // ... etc.
}
```

Sketch a minimal interface for the response, accept `unknown`, narrow with the
coercers from §3.3.

### 5.5 Singleton initialization

```ts
// ❌ Wrong (src/services/citationFileService.ts:645)
export const citationFileService = new CitationFileService(null as any);
// later: (citationFileService as any).app = app;

// ✅ Right — defer the singleton until you have an App
let _instance: CitationFileService | null = null;
export function getCitationFileService(app: App): CitationFileService {
  if (!_instance) _instance = new CitationFileService(app);
  return _instance;
}
```

The `null as any` + later `as any` runtime patch is solving an initialization-
order problem with type-system damage. A getter-with-lazy-init solves it
honestly.

## Section 6 — Authoritative Sources

Verified 2026-05-01:

- <https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines>
- <https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins>
- <https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin>
- <https://docs.obsidian.md/Developer+policies>
- <https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/tsconfig.json> (the de facto strictness baseline)
- <https://github.com/obsidianmd/obsidian-releases/blob/master/.github/PULL_REQUEST_TEMPLATE.md>
- <https://typescript-eslint.io/rules/no-explicit-any/>

Example rejection PRs with verbatim review-bot quotes (good for understanding
the bot's tone and what gets through `/skip`):

- <https://github.com/obsidianmd/obsidian-releases/pull/8131>
- <https://github.com/obsidianmd/obsidian-releases/pull/9166>
- <https://github.com/obsidianmd/obsidian-releases/pull/10160>
- <https://github.com/obsidianmd/obsidian-releases/pull/10723>
