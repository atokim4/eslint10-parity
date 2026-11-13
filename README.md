# eslint10-parity

Checks that an ESLint 9 to 10 upgrade still lints what it linted before.

A version bump PR can go green for the wrong reason. If the new config no longer matches your `.vue` files, if a nested `eslint.config.js` in a monorepo package quietly takes over, or if `.eslintignore` stops being read, ESLint reports fewer problems and CI is happy. This tool lints both checkouts the way CI does and compares, file by file:

- **coverage**: is the file linted, ignored, or matched by no config at all
- **resolved config**: rules with severity and options, plugins, parser, language, processor, ecmaVersion, sourceType, globals, parserOptions, settings
- **findings**: every rule, line and column, matched as a multiset, with a cause attached when ESLint 10 is known to change it

The exit code is meant for CI: it fails when files stopped being linted, rules got dropped or weaker, or findings disappeared, even if ESLint itself exits 0.

## What a report looks like

This is an excerpt of the output for one of the test fixtures (`test/fixtures/port-lost-globs`, full report in its `REPORT.md`): an eslintrc config ported to flat config, where the port forgot the `.vue` and `.cts` globs and turned `no-console` into a warning.

```
# eslint10-parity: SILENT CHANGE

2 files stopped being linted; 2 files now lint more weakly (rules dropped or downgraded, or plugin,
parser or config file changed), and the lint exit code did not get worse (1 -> 0), so CI would not notice.

| Side   | ESLint  | Config   | Linted | Ignored | Not matched | Crashed | Errors | Warnings | Exit |
| before | 9.39.5  | eslintrc | 4      | 0       | 2           | 0       | 3      | 0        | 1    |
| after  | 10.14.0 | flat     | 3      | 0       | 3           | 0       | 0      | 0        | 0    |

## Files that stopped being linted (2)

- 2 files: linted -> unmatched, no config object's `files` matches this file (3 findings on the linted side)
  `src/Widget.vue`, `src/legacy.cts`

### HIGH: 2 files
`src/app.js`, `src/util.ts`
- [high] rule no-console severity error -> warn
```

Every fixture has its full report next to it in `REPORT.md`, and the tests fail if the output changes.

## Failure classes it detects

| Class | How it shows up |
| --- | --- |
| eslintrc port misses `files` globs (`.vue`, `.cts`, `.mts`, `.jsx`) | files move from linted to "no config object's `files` matches" |
| `.eslintignore` no longer read | ignored files start being linted; ESLint only prints a warning |
| per-file config lookup in monorepos (ESLint 10 default) | `config file eslint.config.js -> packages/web/eslint.config.js`, plus the rules that file lost |
| rules dropped, turned off, downgraded, options changed | per file, grouped by identical change set |
| plugin, parser, processor or language lost | per file, high impact |
| new `eslint:recommended` rules (`no-unassigned-vars`, `no-useless-assignment`, `preserve-caught-error`) | new findings, marked expected |
| `/* eslint-env */` comments | new core errors, marked expected |
| JSX reference tracking | `no-unused-vars` false positives on JSX components disappear, marked expected |
| rule defaults that changed (`no-shadow-restricted-names` reportGlobalThis, `new-cap` exceptions) | reported as low "the rule's default options changed" |
| eslintrc-only repo with a bare bump | ESLint 10 crashes ("Could not find config file"), verdict BROKEN |
| CLI options ESLint 10 rejects (`--rulesdir`, `--ignore-path`, `--env`, `--no-eslintrc`, `--resolve-plugins-relative-to`) | the command line is checked with ESLint's own option parser |

Rule options are compared after filling in both versions' `meta.defaultOptions`, the same way ESLint merges them. ESLint 10 made several defaults explicit (for example `no-constant-binary-expression`), and without this step every upgrade would look like a config change.

### Static checks (no install needed)

`eslint10-parity static <dir>` reads files only: eslintrc-only configs, leftover `.eslintrc*` next to a flat config, nested `eslint.config.*` files, `.eslintignore` (with a ready `globalIgnores([...])` line), `eslint-env` comments, `ESLINT_USE_FLAT_CONFIG`, the removed `v10_config_lookup_from_file` flag, eslintrc-only CLI flags in scripts, `engines.node`, `.nvmrc` and CI `node-version` below `^20.19.0 || ^22.13.0 || >=24`, jiti below 2.2.0 for `eslint.config.ts`, typescript-eslint below 8.56.0 (below 8.54.0 it crashes on ESLint 10), configs importing `@eslint/js`, `@eslint/eslintrc` or `globals` without declaring them, `radix` "as-needed", `jsx-uses-vars`, and `LegacyESLint` / `FlatESLint` imports. The engine (`src/static/index.ts`, built to `dist/static.mjs`) has no Node imports, so it also runs in a browser.

## Usage

Needs Node 22.5 or newer (`path.matchesGlob`). Install the dependencies of each checkout first (`npm ci`, `pnpm i`...), since the tool uses the ESLint and plugins the repo itself installed.

```sh
git clone https://github.com/atokim4/eslint10-parity && cd eslint10-parity
npm ci && npm run engines && npm run build

# main branch vs the Renovate/Dependabot PR branch, both installed
node dist/cli.mjs compare --before ../app-main --after ../app-pr --md report.md --json report.json

# no PR yet: same checkout, ESLint 9 from the repo vs the pinned ESLint 10.14.0
node dist/cli.mjs compare --before ../app-main

# your own command line instead of the package.json script
node dist/cli.mjs compare --before ../a --after ../b --args "eslint src --ext .ts,.vue"

# file checks only
node dist/cli.mjs static ../app-main
```

| Option | Meaning |
| --- | --- |
| `--before-eslint`, `--after-eslint` | `repo` (the checkout's own eslint), `9` or `10` (pinned installs in `engines/`), or a path |
| `--args "<cmd>"` | lint both sides with this command; `ESLINT_USE_FLAT_CONFIG=false eslint .` works too |
| `--cwd <dir>` | subfolder for `--args` |
| `--md`, `--json` | write the report files; Markdown goes to stdout otherwise |
| `--fail-on` | `high` (default), `medium`, `low`, `never` |
| `--timeout <min>` | per lint unit, default 15 |

`snapshot <dir> --eslint <engine> --out s.json` and `diff a.json b.json` split the two steps, for example to lint in two CI jobs.

Exit codes of `compare` and `diff`: `0` parity or only changes below `--fail-on`, `1` changes at that level or the after side crashes, `2` no baseline (the before side crashed or nothing was linted), usage or tool error. With `--fail-on never` only `2` remains. `static` exits `1` when it finds an error-level item (any `--fail-on` other than `never`).

### GitHub Action

On a pull request (for example the Renovate or Dependabot ESLint bump), the action checks out the base branch next to the head, installs both, compares them and puts the report in the job summary.

```yaml
on: pull_request
permissions:
  contents: read
jobs:
  eslint-parity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - uses: atokim4/eslint10-parity@main
        with:
          fail-on: high          # high | medium | low | never
          # working-directory: packages/app
          # install-command: pnpm install --frozen-lockfile   (default: picked from the lockfile)
          # args: eslint src --ext .ts
```

The action installs both checkouts (lifecycle scripts included, as your normal CI does) and loads their ESLint configs and plugins, so it runs the pull request's code. Use it on `pull_request`, never on `pull_request_target`, and keep the token read-only as above.

Outputs: `status` (`ok`, `changed`, `broken`, `inconclusive`), `silent` (`true` when something got weaker and the exit code did not show it), `report` (path of the Markdown file). For pnpm or Yarn Berry, enable corepack or add `pnpm/action-setup` before it.

### How it decides what CI lints

It reads the first package.json script that runs `eslint` (`lint:eslint`, `eslint`, `lint:js`, `lint`, `lint:ci`, `test:lint`, then any other), including `ESLINT_USE_FLAT_CONFIG=` / `cross-env` prefixes and options such as `--ext`, `--config`, `--max-warnings`, `--flag`. When the root script delegates (`turbo run lint`, `pnpm -r lint`), each workspace package with its own eslint script becomes a separate unit. With no script it runs `eslint .`. `ESLINT_USE_FLAT_CONFIG` set in a GitHub workflow is picked up as well.

Candidate files come from `git ls-files` (tracked and untracked, not gitignored; outside a git checkout, a directory walk) filtered to source-like extensions, plus everything ESLint actually linted. "Not matched" in the report counts candidates that no config object matches or that the lint command's patterns do not cover.

## Census: 68 real ESLint 10 bump PRs (2026-11-13/14)

I ran the tool on open Renovate and Dependabot PRs that move public repos from ESLint 8 or 9 to 10: the PR's merge ref against its base, each side installed with the repo's own package manager (scripts off), and every result checked by hand against the crash message, the lockfile and the plugin's published source. 84 PRs were measured; 16 had no usable baseline (lint already failing on main, a lockfile that does not install, an incomplete workspace install, or only one package of a monorepo measured) and are left out.

| What happens after the bump | PRs |
| --- | ---: |
| crash: typescript-eslint < 8.54 in the lockfile (`Class extends value undefined`) | 17 |
| crash: a plugin calls a removed context method | 9 |
| same files and findings | 8 |
| crash: parser without `addGlobals()` (@babel/eslint-parser 7) | 8 |
| same files and findings, but `npm ci` fails (lockfile not regenerated) | 7 |
| same files, new errors from ESLint 10's recommended rules | 7 |
| crash: config imports `@eslint/js`, `@eslint/eslintrc` or `globals` without declaring them | 5 |
| crash: only `.eslintrc`, no flat config | 3 |
| crash: typescript-eslint 8.54/8.55 (`no-deprecated` reads `context.parserOptions`) | 2 |
| crash: the same PR bumps TypeScript to 7, which typescript-eslint refuses | 1 |
| new recommended-rule errors, and the lockfile does not install | 1 |

45 of the 68 lint zero files after the bump (ESLint 9 linted 1,606 files in those repos). 38 of the 45 had a failed check on the PR; 7 showed nothing red. No PR had a silent config change: where the resolved configs differed, it was ESLint 10's documented default changes.

<details><summary>Per-repo results</summary>

| Repo | PR | ESLint | Files linted | Result | CI on the PR |
| --- | ---: | --- | --- | --- | --- |
| 4m-mazi/fixup-twitter-link | [#1346](https://github.com/4m-mazi/fixup-twitter-link/pull/1346) | 9.39.5 -> 10.14.0 | 11 -> 0 | crash: typescript-eslint < 8.54 in the lockfile | failed check |
| adobe/structured-data-validator | [#66](https://github.com/adobe/structured-data-validator/pull/66) | 9.39.3 -> 10.14.0 | 72 -> 72 | same files, new errors from ESLint 10's recommended rules | failed check |
| aggre/ullr | [#1029](https://github.com/aggre/ullr/pull/1029) | 9.39.5 -> 10.14.0 | 12 -> 0 | crash: config imports `@eslint/js`, `@eslint/eslintrc` or `globals` without declaring them | failed check |
| apify/fingerprint-suite | [#517](https://github.com/apify/fingerprint-suite/pull/517) | 9.39.4 -> 10.14.0 | 6 -> 0 | crash: a plugin calls a removed context method | failed check |
| brave/slim-list-lambda | [#197](https://github.com/brave/slim-list-lambda/pull/197) | 9.39.5 -> 10.14.0 | 17 -> 17 | same files and findings | none reported |
| C2FO/fast-csv | [#1191](https://github.com/C2FO/fast-csv/pull/1191) | 9.39.5 -> 10.14.0 | 55 -> 55 | same files and findings | failed check |
| chihebnabil/lovable-boilerplate | [#34](https://github.com/chihebnabil/lovable-boilerplate/pull/34) | 9.39.1 -> 10.14.0 | 63 -> 0 | crash: typescript-eslint < 8.54 in the lockfile | failed check |
| convex/convex-helpers | [#929](https://github.com/convex/convex-helpers/pull/929) | 9.39.5 -> 10.14.0 | 111 -> 111 | same files and findings, but `npm ci` fails (lockfile not regenerated) | failed check |
| convex/static-hosting | [#16](https://github.com/convex/static-hosting/pull/16) | 9.39.5 -> 10.14.0 | 33 -> 33 | same files and findings, but `npm ci` fails (lockfile not regenerated) | failed check |
| convex/templates | [#275](https://github.com/convex/templates/pull/275) | 9.39.5 -> 10.14.0 | 17 -> 17 | same files and findings, but `npm ci` fails (lockfile not regenerated) | failed check |
| convex/workos-authkit | [#26](https://github.com/convex/workos-authkit/pull/26) | 9.39.5 -> 10.14.0 | 26 -> 26 | same files and findings, but `npm ci` fails (lockfile not regenerated) | none reported |
| daku10/github-merge-guardian | [#139](https://github.com/daku10/github-merge-guardian/pull/139) | 9.39.4 -> 10.14.0 | 17 -> 0 | crash: a plugin calls a removed context method | failed check |
| data-catering/insta-infra | [#1438](https://github.com/data-catering/insta-infra/pull/1438) | 9.39.5 -> 10.14.0 | 52 -> 0 | crash: a plugin calls a removed context method | failed check |
| ddterm/gnome-shell-extension-ddterm | [#1751](https://github.com/ddterm/gnome-shell-extension-ddterm/pull/1751) | 9.39.5 -> 10.14.0 | 72 -> 0 | crash: config imports `@eslint/js`, `@eslint/eslintrc` or `globals` without declaring them | **nothing red** |
| descope/auth-hosting | [#1094](https://github.com/descope/auth-hosting/pull/1094) | 8.57.1 -> 10.13.0 | 23 -> 0 | crash: only `.eslintrc`, no flat config | failed check |
| descope/mcp-express | [#154](https://github.com/descope/mcp-express/pull/154) | 9.39.4 -> 10.14.0 | 29 -> 29 | same files, new errors from ESLint 10's recommended rules | failed check |
| descope/node-sdk | [#683](https://github.com/descope/node-sdk/pull/683) | 8.19.0 -> 10.14.0 | 68 -> 0 | crash: only `.eslintrc`, no flat config | failed check |
| discord/cloudflare-sample-app | [#99](https://github.com/discord/cloudflare-sample-app/pull/99) | 9.1.0 -> 10.14.0 | 6 -> 6 | same files and findings | none reported |
| dolezel/react-csv-downloader | [#516](https://github.com/dolezel/react-csv-downloader/pull/516) | 9.39.1 -> 10.14.0 | 7 -> 0 | crash: typescript-eslint < 8.54 in the lockfile | **nothing red** |
| ember-bootstrap/ember-bootstrap | [#2145](https://github.com/ember-bootstrap/ember-bootstrap/pull/2145) | 8.57.1 -> 10.14.0 | 55 -> 0 | crash: only `.eslintrc`, no flat config | failed check |
| ember-bootstrap/ember-bootstrap-changeset-validations | [#121](https://github.com/ember-bootstrap/ember-bootstrap-changeset-validations/pull/121) | 9.39.5 -> 10.14.0 | 23 -> 0 | crash: parser without `addGlobals()` | failed check |
| ember-bootstrap/ember-bootstrap-cp-validations | [#352](https://github.com/ember-bootstrap/ember-bootstrap-cp-validations/pull/352) | 9.39.4 -> 10.14.0 | 23 -> 0 | crash: parser without `addGlobals()` | failed check |
| ember-bootstrap/ember-bootstrap-power-select | [#449](https://github.com/ember-bootstrap/ember-bootstrap-power-select/pull/449) | 9.39.5 -> 10.14.0 | 21 -> 0 | crash: parser without `addGlobals()` | failed check |
| emish89/smile2emoji | [#654](https://github.com/emish89/smile2emoji/pull/654) | 9.39.5 -> 10.14.0 | 2 -> 2 | same files and findings | green |
| gabe565/mnemonic-ninja | [#564](https://github.com/gabe565/mnemonic-ninja/pull/564) | 9.17.0 -> 10.14.0 | 28 -> 0 | crash: a plugin calls a removed context method | failed check |
| gabe565/portfolio | [#661](https://github.com/gabe565/portfolio/pull/661) | 9.23.0 -> 10.14.0 | 21 -> 0 | crash: a plugin calls a removed context method | failed check |
| gabe565/streamdeck-stopwatch | [#78](https://github.com/gabe565/streamdeck-stopwatch/pull/78) | 9.2.0 -> 10.14.0 | 7 -> 7 | same files and findings | green |
| gocd/gocd | [#14214](https://github.com/gocd/gocd/pull/14214) | 9.39.5 -> 10.14.0 | 186 -> 0 | crash: config imports `@eslint/js`, `@eslint/eslintrc` or `globals` without declaring them | **nothing red** |
| google/gts | [#959](https://github.com/google/gts/pull/959) | 9.39.1 -> 10.14.0 | 8 -> 0 | crash: typescript-eslint < 8.54 in the lockfile | **nothing red** |
| harkkozz/react-ts-vite-pnpm | [#132](https://github.com/harkkozz/react-ts-vite-pnpm/pull/132) | 9.39.4 -> 10.14.0 | 16 -> 0 | crash: a plugin calls a removed context method | failed check |
| iconify/tools | [#108](https://github.com/iconify/tools/pull/108) | 9.39.4 -> 10.14.0 | 91 -> 91 | same files, new errors from ESLint 10's recommended rules | failed check |
| jburrow/monaco-editor-code-review | [#641](https://github.com/jburrow/monaco-editor-code-review/pull/641) | 9.39.5 -> 10.14.0 | 6 -> 6 | same files, new errors from ESLint 10's recommended rules | failed check |
| jelhan/ember-autoresize-modifier | [#264](https://github.com/jelhan/ember-autoresize-modifier/pull/264) | 9.39.4 -> 10.14.0 | 7 -> 0 | crash: parser without `addGlobals()` | failed check |
| jelhan/ember-local-storage-decorator | [#100](https://github.com/jelhan/ember-local-storage-decorator/pull/100) | 9.39.4 -> 10.13.0 | 20 -> 0 | crash: a plugin calls a removed context method | failed check |
| jelhan/ember-style-modifier | [#348](https://github.com/jelhan/ember-style-modifier/pull/348) | 9.39.5 -> 10.14.0 | 16 -> 0 | crash: typescript-eslint < 8.54 in the lockfile | failed check |
| jest-community/create-jest-runner | [#400](https://github.com/jest-community/create-jest-runner/pull/400) | 9.39.1 -> 10.14.0 | 34 -> 0 | crash: typescript-eslint < 8.54 in the lockfile | failed check |
| joe-re/eyes-on-claude-code | [#51](https://github.com/joe-re/eyes-on-claude-code/pull/51) | 9.39.2 -> 10.14.0 | 26 -> 26 | same files and findings | none reported |
| JoshuaKGoldberg/are-docs-informative | [#989](https://github.com/JoshuaKGoldberg/are-docs-informative/pull/989) | 9.39.0 -> 10.14.0 | 42 -> 0 | crash: typescript-eslint < 8.54 in the lockfile | failed check |
| JoshuaKGoldberg/github-username-to-emails | [#855](https://github.com/JoshuaKGoldberg/github-username-to-emails/pull/855) | 9.39.1 -> 10.14.0 | 52 -> 0 | crash: typescript-eslint < 8.54 in the lockfile | failed check |
| JoshuaKGoldberg/import-local-or-npx | [#297](https://github.com/JoshuaKGoldberg/import-local-or-npx/pull/297) | 9.39.0 -> 10.14.0 | 44 -> 0 | crash: typescript-eslint < 8.54 in the lockfile | **nothing red** |
| JoshuaKGoldberg/refined-saved-replies | [#1343](https://github.com/JoshuaKGoldberg/refined-saved-replies/pull/1343) | 9.39.1 -> 10.14.0 | 52 -> 0 | crash: typescript-eslint < 8.54 in the lockfile | failed check |
| JoshuaKGoldberg/should-semantic-release | [#840](https://github.com/JoshuaKGoldberg/should-semantic-release/pull/840) | 9.39.0 -> 10.13.0 | 51 -> 0 | crash: typescript-eslint < 8.54 in the lockfile | failed check |
| JoshuaKGoldberg/wifi-share-link | [#168](https://github.com/JoshuaKGoldberg/wifi-share-link/pull/168) | 9.39.0 -> 10.14.0 | 37 -> 0 | crash: typescript-eslint < 8.54 in the lockfile | failed check |
| lucasew/pesquisarr | [#625](https://github.com/lucasew/pesquisarr/pull/625) | 9.39.5 -> 10.13.0 | 54 -> 54 | same files and findings, but `npm ci` fails (lockfile not regenerated) | failed check |
| mainmatter/ember-cookies | [#1173](https://github.com/mainmatter/ember-cookies/pull/1173) | 9.39.4 -> 10.14.0 | 9 -> 0 | crash: typescript-eslint < 8.54 in the lockfile | failed check |
| mainmatter/ember-simple-auth | [#3078](https://github.com/mainmatter/ember-simple-auth/pull/3078) | 9.39.2 -> 10.14.0 | 28 -> 0 | crash: parser without `addGlobals()` | failed check |
| mainmatter/sheepdog | [#363](https://github.com/mainmatter/sheepdog/pull/363) | 9.37.0 -> 10.14.0 | 23 -> 0 | crash: typescript-eslint < 8.54 in the lockfile | failed check |
| masonmcelvain/hop | [#1317](https://github.com/masonmcelvain/hop/pull/1317) | 9.39.5 -> 10.14.0 | 37 -> 37 | same files and findings | failed check |
| mato533/rollup-plugin-gas | [#352](https://github.com/mato533/rollup-plugin-gas/pull/352) | 9.29.0 -> 10.14.0 | 12 -> 0 | crash: typescript-eslint < 8.54 in the lockfile | failed check |
| nandenjin/twinkle-parser | [#347](https://github.com/nandenjin/twinkle-parser/pull/347) | 9.39.5 -> 10.14.0 | 11 -> 0 | crash: config imports `@eslint/js`, `@eslint/eslintrc` or `globals` without declaring them | failed check |
| nestjs/azure-database | [#1426](https://github.com/nestjs/azure-database/pull/1426) | 9.39.5 -> 10.14.0 | 23 -> 23 | same files, new errors from ESLint 10's recommended rules | **nothing red** |
| nuxt-ui-templates/starter-laravel | [#27](https://github.com/nuxt-ui-templates/starter-laravel/pull/27) | 9.39.1 -> 10.14.0 | 10 -> 0 | crash: typescript-eslint < 8.54 in the lockfile | failed check |
| opencollective/opencollective-pdf | [#1219](https://github.com/opencollective/opencollective-pdf/pull/1219) | 9.39.5 -> 10.14.0 | 55 -> 55 | same files and findings, but `npm ci` fails (lockfile not regenerated) | failed check |
| OptiVorbis/OptiVorbis | [#178](https://github.com/OptiVorbis/OptiVorbis/pull/178) | 9.39.5 -> 10.14.0 | 8 -> 8 | same files and findings, but `npm ci` fails (lockfile not regenerated) | failed check |
| reactjs/react-tabs | [#603](https://github.com/reactjs/react-tabs/pull/603) | 9.39.5 -> 10.14.0 | 7 -> 0 | crash: parser without `addGlobals()` | failed check |
| scummvm/scummvm-web | [#725](https://github.com/scummvm/scummvm-web/pull/725) | 9.39.5 -> 10.14.0 | 16 -> 0 | crash: parser without `addGlobals()` | failed check |
| simonihmig/responsive-image | [#2386](https://github.com/simonihmig/responsive-image/pull/2386) | 9.39.5 -> 10.14.0 | 15 -> 0 | crash: parser without `addGlobals()` | **nothing red** |
| socius-org/RedditHarbor | [#322](https://github.com/socius-org/RedditHarbor/pull/322) | 9.39.5 -> 10.14.0 | 44 -> 0 | crash: a plugin calls a removed context method | failed check |
| sodenn/2do-txt | [#1443](https://github.com/sodenn/2do-txt/pull/1443) | 9.39.2 -> 10.14.0 | 122 -> 0 | crash: typescript-eslint 8.54/8.55 | failed check |
| sodenn/lexical-beautiful-mentions | [#1130](https://github.com/sodenn/lexical-beautiful-mentions/pull/1130) | 9.39.2 -> 10.14.0 | 59 -> 0 | crash: typescript-eslint 8.54/8.55 | failed check |
| sveltejs/ai-tools | [#159](https://github.com/sveltejs/ai-tools/pull/159) | 9.39.2 -> 10.14.0 | 106 -> 106 | same files, new errors from ESLint 10's recommended rules | failed check |
| tensorlakeai/tensorlake | [#1078](https://github.com/tensorlakeai/tensorlake/pull/1078) | 9.39.5 -> 10.14.0 | 91 -> 0 | crash: the same PR bumps TypeScript to 7, which typescript-eslint refuses | failed check |
| terrestris/ol-util | [#2218](https://github.com/terrestris/ol-util/pull/2218) | 9.39.5 -> 10.14.0 | 17 -> 17 | new recommended-rule errors, and the lockfile does not install | failed check |
| timoa/workflow-metrics | [#34](https://github.com/timoa/workflow-metrics/pull/34) | 9.39.3 -> 10.14.0 | 78 -> 78 | same files, new errors from ESLint 10's recommended rules | failed check |
| tokuhirom/mindcheese | [#1258](https://github.com/tokuhirom/mindcheese/pull/1258) | 9.39.5 -> 10.14.0 | 44 -> 0 | crash: config imports `@eslint/js`, `@eslint/eslintrc` or `globals` without declaring them | failed check |
| TylorS/effect-sql-kysely | [#45](https://github.com/TylorS/effect-sql-kysely/pull/45) | 9.39.5 -> 10.14.0 | 14 -> 14 | same files and findings | failed check |
| vuejs/repl | [#378](https://github.com/vuejs/repl/pull/378) | 9.32.0 -> 10.14.0 | 18 -> 0 | crash: typescript-eslint < 8.54 in the lockfile | **nothing red** |
| zett-8/hono-react-router | [#268](https://github.com/zett-8/hono-react-router/pull/268) | 9.39.4 -> 10.2.1 | 30 -> 0 | crash: a plugin calls a removed context method | failed check |

</details>


## Limits

- It compares what ESLint does in two checkouts. It does not migrate your config; use the official `npx codemod @eslint/v9-to-v10` and `@eslint/migrate-config`, then run this to see what changed.
- A config that imports `@eslint/js` resolves it from the checkout. With `--after-eslint 10` on an unchanged checkout, `eslint:recommended` still comes from the repo's `@eslint/js` 9.
- eslintrc envs that come from plugins are expanded only when the plugin can be loaded; otherwise they are listed as unresolved.
- Bulk suppressions (`eslint-suppressions.json`) are applied by the ESLint CLI, not by the `ESLint` class this tool uses. When the file exists the report says so, and counts and exit codes include the suppressed violations.
- Globals added by a newer `globals` package are reported as low impact. Actual `no-undef` differences show up in the findings diff.

## Development

```sh
npm ci && npm run engines
npm run check   # tsc, build, vitest (fixtures run real ESLint 9.39.5 and 10.14.0)
```

Sources used: the ESLint [v10 migration guide](https://eslint.org/docs/latest/use/migrate-to-10.0.0), the [flat config migration guide](https://eslint.org/docs/latest/use/configure/migration-guide), and the `ESLint` class source in eslint 9.39.5 and 10.14.0 (`calculateConfigForFile`, `findConfigFile`, `lintText` with `warnIgnored`, `lib/options.js`).

## License

MIT, Sunnatulla E
