# eslint10-parity: PARITY

Parity: ESLint 9.39.5 and 10.14.0 lint the same files with the same config and findings.

| Side | ESLint | Config | Linted | Ignored | Not matched | Crashed | Errors | Warnings | Exit |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| before | 9.39.5 | flat | 2 | 0 | 1 | 0 | 0 | 0 | 0 |
| after | 10.14.0 | flat | 2 | 0 | 1 | 0 | 0 | 0 | 0 |

Changes: 0 high, 0 medium, 0 low or expected.

## How each side was linted

- Before `.`: package.json scripts.lint: eslint ., flat config, exit 0
- After `.`: package.json scripts.lint: eslint ., flat config, exit 0

Package versions that changed:

- `@eslint/eslintrc` 3.3.7 -> absent
- `@eslint/js` 9.39.5 -> 10.0.1
- `eslint` 9.39.5 -> 10.14.0
