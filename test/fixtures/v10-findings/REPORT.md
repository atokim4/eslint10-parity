# eslint10-parity: CHANGED

Only low-impact or expected ESLint 10 changes.

| Side | ESLint | Config | Linted | Ignored | Not matched | Crashed | Errors | Warnings | Exit |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| before | 9.39.5 | flat | 3 | 0 | 2 | 0 | 3 | 0 | 1 |
| after | 10.14.0 | flat | 3 | 0 | 2 | 0 | 4 | 0 | 1 |

Changes: 0 high, 0 medium, 7 low or expected.

## Resolved config changes

Files linted on both sides whose effective config differs, grouped by identical change set.

### LOW: 3 files

`src/Badge.jsx`, `src/Card.jsx`, `src/load.js`

- [low] rule no-shadow-restricted-names options [{"reportGlobalThis":false}] -> [{"reportGlobalThis":true}] (the rule's default options changed)
- [low] rule no-unassigned-vars now error (added to eslint:recommended in ESLint 10)
- [low] rule no-useless-assignment now error (added to eslint:recommended in ESLint 10)
- [low] rule preserve-caught-error now error (added to eslint:recommended in ESLint 10)

## Findings that changed

| Impact | Rule | Change | Count | Files | Cause | Example |
| --- | --- | --- | ---: | ---: | --- | --- |
| expected | `(core)` | appeared | 1 | 1 | /* eslint-env */ comments are reported as errors in ESLint 10 | `src/load.js:1:1` /* eslint-env */ comments are no longer supported. |
| expected | `preserve-caught-error` | appeared | 1 | 1 | rule added to eslint:recommended in ESLint 10 | `src/load.js:9:5` There is no `cause` attached to the symptom error being thrown. |
| expected | `no-unused-vars` | vanished | 1 | 1 | ESLint 10 tracks JSX references (scope analysis fix) | `src/Card.jsx:1:10` 'Badge' is defined but never used. |

## Upgrade checks (static)

- **warning** `undeclared-eslint-package` `eslint.config.js:2`: eslint.config.js imports globals, but no package.json declares it. ESLint 9 installs globals through @eslint/eslintrc (unless another package also pulls it in) and ESLint 10 does not, so after the bump the config can fail with "Cannot find package 'globals'". The migration guide does not list this. ([docs](https://eslint.org/docs/latest/use/migrate-to-10.0.0))
  Fix: Add `"globals": "^14.0.0"` to devDependencies.
- **warning** `eslint-env-comment` `src/load.js:1`: /* eslint-env node */ is an error in ESLint 10 (and ignored by flat config in ESLint 9). ([docs](https://eslint.org/docs/latest/use/migrate-to-10.0.0#eslint-env-comments))
  Fix: Remove the comment and add the globals in config, e.g. `languageOptions: { globals: { ...globals.node } }` for this file.

## How each side was linted

- Before `.`: package.json scripts.lint: eslint src, flat config, exit 1
  - warning: ESLintEnvWarning: /* eslint-env */ comments are no longer recognized when linting with flat config and will be reported as errors as of v10.0.0. Replace them with /* global */ comments or define globals in your config file. See https://eslint.org/docs/latest/use/configure/migration-guide#eslint-env-
- After `.`: package.json scripts.lint: eslint src, flat config, exit 1

Package versions that changed:

- `@eslint/eslintrc` 3.3.7 -> absent
- `@eslint/js` 9.39.5 -> 10.0.1
- `eslint` 9.39.5 -> 10.14.0
