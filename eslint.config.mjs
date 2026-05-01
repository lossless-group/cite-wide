import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

/**
 * Flat config mirroring the rules ObsidianReviewBot enforces on community
 * plugin submissions. Type-aware rules require `parserOptions.project`,
 * which makes lint runs read tsconfig.json — slower on cold start, but
 * the type-aware rules (no-floating-promises, no-base-to-string,
 * no-unnecessary-type-assertion) cannot fire without it.
 *
 * See context-v/reminders/Obsidian-Type-Safety.md §1 for the rule sources
 * and §4 for the local-enforcement rationale.
 */
export default [
    {
        ignores: ['main.js', 'node_modules/**', 'examples/**', '*.mjs'],
    },
    {
        files: ['**/*.ts'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: './tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
        },
        linterOptions: {
            reportUnusedDisableDirectives: 'error',
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unnecessary-type-assertion': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-base-to-string': 'error',
        },
    },
];
