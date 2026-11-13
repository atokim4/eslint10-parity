# eslint10-parity: SILENT CHANGE

2 files now lint more weakly (rules dropped or downgraded, or plugin, parser or config file changed); 2 findings disappeared, and the lint exit code did not get worse (1 -> 0), so CI would not notice.

| Side | ESLint | Config | Linted | Ignored | Not matched | Crashed | Errors | Warnings | Exit |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| before | 9.39.5 | flat | 4 | 0 | 3 | 0 | 2 | 0 | 1 |
| after | 10.14.0 | flat | 4 | 0 | 3 | 0 | 0 | 0 | 0 |

Changes: 6 high, 0 medium, 1 low or expected.

## Resolved config changes

Files linted on both sides whose effective config differs, grouped by identical change set.

### HIGH: 2 files

`packages/web/eslint.config.js`, `packages/web/src/main.js`

- [high] config file eslint.config.js -> packages/web/eslint.config.js
- [high] rule no-console (error) is no longer configured
- [high] rule no-debugger (error) is no longer configured
- [high] rule prefer-const (error) is no longer configured
- [low] 10 globals removed: Buffer, __dirname, __filename, clearImmediate, exports, global, module, process (+2 more)

## Findings that changed

| Impact | Rule | Change | Count | Files | Cause | Example |
| --- | --- | --- | ---: | ---: | --- | --- |
| high | `no-console` | vanished | 1 | 1 | rule no longer enabled for this file | `packages/web/src/main.js:2:1` Unexpected console statement. |
| high | `prefer-const` | vanished | 1 | 1 | rule no longer enabled for this file | `packages/web/src/main.js:1:5` 'title' is never reassigned. Use 'const' instead. |

## Upgrade checks (static)

- **warning** `undeclared-eslint-package` `eslint.config.js:1`: eslint.config.js imports globals, but no package.json declares it. ESLint 9 installs globals through @eslint/eslintrc (unless another package also pulls it in) and ESLint 10 does not, so after the bump the config can fail with "Cannot find package 'globals'". The migration guide does not list this. ([docs](https://eslint.org/docs/latest/use/migrate-to-10.0.0))
  Fix: Add `"globals": "^14.0.0"` to devDependencies.
- **warning** `nested-config-lookup` `packages/web/eslint.config.js`: 1 nested eslint.config file (packages/web/eslint.config.js). ESLint 9 used the root config for every file when run from the root; ESLint 10 uses the nearest config to each file, so those folders switch config. ([docs](https://eslint.org/docs/latest/use/migrate-to-10.0.0#config-lookup-from-file))
  Fix: Keep the old behaviour with an explicit `--config eslint.config.js`, or check that each nested config is complete.
- **warning** `undeclared-eslint-package` `packages/web/eslint.config.js:2`: packages/web/eslint.config.js imports globals, but no package.json declares it. ESLint 9 installs globals through @eslint/eslintrc (unless another package also pulls it in) and ESLint 10 does not, so after the bump the config can fail with "Cannot find package 'globals'". The migration guide does not list this. ([docs](https://eslint.org/docs/latest/use/migrate-to-10.0.0))
  Fix: Add `"globals": "^14.0.0"` to devDependencies.

## How each side was linted

- Before `.`: package.json scripts.lint: eslint ., flat config, exit 1
- After `.`: package.json scripts.lint: eslint ., flat config, exit 0

Package versions that changed:

- `@eslint/eslintrc` 3.3.7 -> absent
- `@eslint/js` 9.39.5 -> 10.0.1
- `eslint` 9.39.5 -> 10.14.0
