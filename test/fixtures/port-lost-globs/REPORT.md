# eslint10-parity: SILENT CHANGE

2 files stopped being linted; 2 files now lint more weakly (rules dropped or downgraded, or plugin, parser or config file changed), and the lint exit code did not get worse (1 -> 0), so CI would not notice.

| Side | ESLint | Config | Linted | Ignored | Not matched | Crashed | Errors | Warnings | Exit |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| before | 9.39.5 | eslintrc | 4 | 0 | 2 | 0 | 3 | 0 | 1 |
| after | 10.14.0 | flat | 3 | 0 | 3 | 0 | 0 | 0 | 0 |

Changes: 2 high, 0 medium, 3 low or expected.

## Files that stopped being linted (2)

- **2 files**: linted -> unmatched, no config object's `files` matches this file (3 findings on the linted side)
  `src/Widget.vue`, `src/legacy.cts`

## Resolved config changes

Files linted on both sides whose effective config differs, grouped by identical change set.

### HIGH: 2 files

`src/app.js`, `src/util.ts`

- [high] rule no-console severity error -> warn
- [low] 474 globals added (can hide no-undef): AI, AICreateMonitor, AITextSession, AbsoluteOrientationSensor, AbstractRange, Accelerometer, AnimationEffect, AudioData (+466 more)
- [low] 23 globals removed: AnimationEffectReadOnly, AnimationEffectTiming, AnimationEffectTimingReadOnly, ApplicationCache, ApplicationCacheErrorEvent, AudioWorkletGlobalScope, AudioWorkletProcessor, BudgetService (+15 more)
- [low] unused disable directives reported as off -> warn

## Upgrade checks (static)

- **warning** `undeclared-eslint-package` `eslint.config.js:2`: eslint.config.js imports globals, but no package.json declares it. ESLint 9 installs globals through @eslint/eslintrc (unless another package also pulls it in) and ESLint 10 does not, so after the bump the config can fail with "Cannot find package 'globals'". The migration guide does not list this. ([docs](https://eslint.org/docs/latest/use/migrate-to-10.0.0))
  Fix: Add `"globals": "^14.0.0"` to devDependencies.

## How each side was linted

- Before `.`: package.json scripts.lint: ESLINT_USE_FLAT_CONFIG=false eslint . --ext .js,.ts,.cts,.vue, eslintrc config, exit 1
- After `.`: package.json scripts.lint: eslint ., flat config, exit 0

Package versions that changed:

- `@eslint/eslintrc` 3.3.7 -> absent
- `@eslint/js` 9.39.5 -> 10.0.1
- `eslint` 9.39.5 -> 10.14.0

## Files present on one side only

- removed: `.eslintrc.json`
- added: `eslint.config.js`
