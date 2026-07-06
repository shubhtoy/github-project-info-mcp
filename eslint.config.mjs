import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      // Justified exception: github-projects-client.ts parses untyped, undocumented JSON
      // from GitHub's internal endpoints (see docs/investigation.md). There's no schema to
      // type against — GitHub doesn't publish one for these fallback paths — so `any` at the
      // parse boundary is intentional, not a shortcut. Values are narrowed into the typed
      // ProjectItem/ProjectMetadata interfaces immediately after.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
]
