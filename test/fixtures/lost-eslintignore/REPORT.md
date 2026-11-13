# eslint10-parity: CHANGED

Lint now fails (exit 0 -> 1) with 3 new errors; 1 file newly linted.

| Side | ESLint | Config | Linted | Ignored | Not matched | Crashed | Errors | Warnings | Exit |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| before | 9.39.5 | eslintrc | 1 | 1 | 2 | 0 | 0 | 0 | 0 |
| after | 10.14.0 | flat | 3 | 0 | 1 | 0 | 3 | 0 | 1 |

Changes: 0 high, 2 medium, 3 low or expected.

## Files that started being linted (1)

- **1 file**: ignored -> linted, matched by an ignore pattern (.eslintignore / ignorePatterns) (3 findings on the linted side)
  `generated/schema.js`

## Resolved config changes

Files linted on both sides whose effective config differs, grouped by identical change set.

### MEDIUM: 1 file

`src/index.js`

- [medium] sourceType script -> commonjs
- [low] 12 globals added (can hide no-undef): CloseEvent, ErrorEvent, Navigator, Performance, QuotaExceededError, Storage, Temporal, URLPattern (+4 more)
- [low] 1 globals removed: Intl
- [low] unused disable directives reported as off -> warn

## Upgrade checks (static)

- **warning** `eslintignore` `.eslintignore`: .eslintignore (1 pattern) is not read by flat config. ESLint 9 and 10 only print an ESLintIgnoreWarning and lint those paths. ([docs](https://eslint.org/docs/latest/use/configure/migration-guide#ignore-files))
  Fix: Move them into the config: `globalIgnores(["generated/"])` from "eslint/config", then delete .eslintignore.
- **warning** `undeclared-eslint-package` `eslint.config.cjs:1`: eslint.config.cjs imports globals, but no package.json declares it. ESLint 9 installs globals through @eslint/eslintrc (unless another package also pulls it in) and ESLint 10 does not, so after the bump the config can fail with "Cannot find package 'globals'". The migration guide does not list this. ([docs](https://eslint.org/docs/latest/use/migrate-to-10.0.0))
  Fix: Add `"globals": "^14.0.0"` to devDependencies.

## How each side was linted

- Before `.`: package.json scripts.lint: ESLINT_USE_FLAT_CONFIG=false eslint ., eslintrc config, exit 0
- After `.`: package.json scripts.lint: eslint ., flat config, exit 1
  - warning: ESLintIgnoreWarning: The ".eslintignore" file is no longer supported. Switch to using the "ignores" property in "eslint.config.js": https://eslint.org/docs/latest/use/configure/migration-guide#ignore-files

Package versions that changed:

- `@eslint/eslintrc` 3.3.7 -> absent
- `@eslint/js` 9.39.5 -> 10.0.1
- `eslint` 9.39.5 -> 10.14.0

## Files present on one side only

- removed: `.eslintrc.json`
- added: `eslint.config.cjs`
