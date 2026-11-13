# eslint10-parity: BROKEN

ESLint 10.14.0 crashes on this repo (exit 2); 1 file stopped being linted.

| Side | ESLint | Config | Linted | Ignored | Not matched | Crashed | Errors | Warnings | Exit |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| before | 9.39.5 | eslintrc | 1 | 0 | 2 | 0 | 0 | 0 | 0 |
| after | 10.14.0 | flat | 0 | 0 | 0 | 3 | 0 | 0 | 2 |

Changes: 1 high, 0 medium, 0 low or expected.

## Files that stopped being linted (1)

- **1 file**: linted -> fatal, lint run crashed
  `src/index.js`

## Upgrade checks (static)

- **error** `eslintrc-only` `.eslintrc.cjs`: Only eslintrc config found (.eslintrc.cjs). ESLint 10 cannot read it and exits 2 with "couldn't find an eslint.config.* file" (with --no-config-lookup it lints with no rules at all). ([docs](https://eslint.org/docs/latest/use/migrate-to-10.0.0#remove-eslintrc))
  Fix: Port with `npx @eslint/migrate-config <file>` and review the result; the config codemod is only partial.
- **error** `flat-config-env` `package.json:3`: ESLINT_USE_FLAT_CONFIG=false keeps ESLint 9 on eslintrc. ESLint 10 ignores the variable and looks for eslint.config.*. ([docs](https://eslint.org/docs/latest/use/migrate-to-10.0.0#remove-eslintrc))
- **warning** `node-engine` `package.json`: engines.node ">=18" allows Node below 20.19; ESLint 10 needs ^20.19.0 || ^22.13.0 || >=24. ([docs](https://eslint.org/docs/latest/use/migrate-to-10.0.0#drop-old-node))

## How each side was linted

- Before `.`: package.json scripts.lint: ESLINT_USE_FLAT_CONFIG=false eslint src, eslintrc config, exit 0
- After `.`: package.json scripts.lint: ESLINT_USE_FLAT_CONFIG=false eslint src, flat config, exit 2
  - crashed: Could not find config file.
  - likely cause: ESLint 10 only reads eslint.config.* files, and this checkout has none. Fix: port the eslintrc config to eslint.config.js (npx @eslint/migrate-config, then review it). ([docs](https://eslint.org/docs/latest/use/migrate-to-10.0.0#remove-eslintrc))

Package versions that changed:

- `@eslint/eslintrc` 3.3.7 -> absent
- `@eslint/js` 9.39.5 -> 10.0.1
- `eslint` 9.39.5 -> 10.14.0
