import { describe, expect, it } from "vitest";
import { scopeToLintedFiles, staticChecks, unsupportedNode, wantsFile, type RepoFiles } from "../src/static/index.js";

const pkg = (data: unknown) => JSON.stringify(data);
const ids = (files: RepoFiles) => staticChecks(files).map((f) => f.id);

describe("unsupportedNode", () => {
  it.each([
    ["18", "Node 18"],
    ["18.x", "Node 18"],
    ["20", null],
    ["20.x", null],
    ["20.11.1", "Node 20.11.1"],
    ["20.19.0", null],
    ["21", "Node 21"],
    ["22.12", "Node 22.12.0"],
    ["22.13", null],
    ["v24.1.0", null],
    ["lts/*", null],
    ["${{ matrix.node }}", null],
  ])("%s -> %s", (spec, out) => {
    expect(unsupportedNode(spec)).toBe(out);
  });
});

describe("config format", () => {
  it("is an error when eslintrc is the only config and eslint 10 is allowed", () => {
    const out = staticChecks({ ".eslintrc.json": "{}", "package.json": pkg({ devDependencies: { eslint: "^10.0.0" } }) });
    expect(out[0]).toMatchObject({ id: "eslintrc-only", severity: "error" });
  });

  it("is a warning while the repo still pins eslint 9", () => {
    expect(staticChecks({ "package.json": pkg({ eslintConfig: {}, devDependencies: { eslint: "^9.0.0" } }) })[0]).toMatchObject({
      id: "eslintrc-only",
      severity: "warning",
      file: "package.json#eslintConfig",
    });
  });

  it("notes leftover eslintrc files next to a flat config, and nested flat configs", () => {
    expect(ids({ ".eslintrc.js": "", "eslint.config.js": "", "apps/web/eslint.config.mjs": "" })).toEqual(["nested-config-lookup", "eslintrc-leftover"]);
  });

  it("ignores configs inside node_modules and build output", () => {
    expect(ids({ "node_modules/x/.eslintrc.json": "{}", "dist/.eslintrc": "{}" })).toEqual([]);
  });
});

describe("ignore files, comments and flags", () => {
  it("turns .eslintignore into a globalIgnores fix once flat config is in play", () => {
    const [f] = staticChecks({ "eslint.config.js": "", ".eslintignore": "# built\ndist/\n\ncoverage\n" });
    expect(f?.id).toBe("eslintignore");
    expect(f?.fix).toContain('globalIgnores(["dist/","coverage"])');
  });

  it("finds eslint-env comments with their line", () => {
    const out = staticChecks({ "src/a.js": "// x\n/* eslint-env node, mocha -- tests */\n", "README.md": "/* eslint-env node */" });
    expect(out).toEqual([expect.objectContaining({ id: "eslint-env-comment", file: "src/a.js", line: 2, message: expect.stringContaining("node, mocha") })]);
  });

  it("only checks the eslint command's own flags", () => {
    expect(ids({ "package.json": pkg({ scripts: { test: "eslint . && jest --env=jsdom" } }) })).toEqual([]);
    expect(ids({ ".github/workflows/ci.yml": "steps:\n  - run: npx eslint --rulesdir rules .\n" })).toEqual(["removed-cli-flag"]);
  });

  it("flags engines that allow Node 22.0 to 22.12", () => {
    expect(staticChecks({ "package.json": pkg({ engines: { node: "^20.19.0 || >=22.0.0" } }) })[0]?.message).toContain("22.0 to 22.12");
    expect(ids({ "package.json": pkg({ engines: { node: "^20.19.0 || ^22.13.0 || >=24" } }) })).toEqual([]);
  });

  it("flags the removed lookup flag, ESLINT_USE_FLAT_CONFIG and eslintrc-only CLI options", () => {
    const out = staticChecks({
      "package.json": pkg({ devDependencies: { eslint: "^10.1.0" }, scripts: { lint: "ESLINT_USE_FLAT_CONFIG=false eslint . --ext .ts --rulesdir rules", x: "eslint --flag v10_config_lookup_from_file ." } }),
      "eslint.config.js": "",
    });
    expect(out.map((f) => [f.id, f.severity])).toEqual([
      ["flat-config-env", "error"],
      ["lookup-flag", "error"],
      ["removed-cli-flag", "error"],
    ]);
  });
});

describe("Node and jiti", () => {
  it("reads engines, .nvmrc and CI matrices", () => {
    const out = staticChecks({
      "package.json": pkg({ engines: { node: ">=18.18" } }),
      ".nvmrc": "20.10.0\n",
      ".github/workflows/ci.yml": "jobs:\n  t:\n    strategy:\n      matrix:\n        node-version: [18.x, 20.x, 22.x]\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n",
    });
    expect(out.map((f) => [f.id, f.line ?? 0])).toEqual([
      ["ci-node", 5],
      ["node-version-file", 1],
      ["node-engine", 0],
    ]);
  });

  it("needs jiti >= 2.2 for TypeScript configs", () => {
    const lock = pkg({ packages: { "node_modules/jiti": { version: "2.1.2" } } });
    expect(staticChecks({ "eslint.config.ts": "", "package-lock.json": lock })[0]).toMatchObject({ id: "jiti", severity: "error" });
    expect(staticChecks({ "eslint.config.mts": "", "package.json": pkg({ devDependencies: { jiti: "^2.4.0" } }) })).toEqual([]);
    expect(staticChecks({ "eslint.config.ts": "" })[0]).toMatchObject({ id: "jiti", severity: "info" });
  });
});

describe("rule options and APIs", () => {
  it("spots radix as-needed and jsx-uses-vars", () => {
    expect(ids({ "eslint.config.js": `export default [{ rules: { radix: ["error", "as-needed"], "react/jsx-uses-vars": "error" } }]` })).toEqual(["radix-option", "jsx-uses-vars"]);
  });

  it("spots removed ESLint classes only when they come from eslint", () => {
    expect(ids({ "scripts/lint.js": `const { LegacyESLint } = require("eslint/use-at-your-own-risk");` })).toEqual(["removed-api"]);
    expect(ids({ "scripts/other.js": "class FlatESLint {} // eslint" })).toEqual([]);
  });
});

it("tells a browser which files to fetch", () => {
  expect(["package.json", "a/.eslintrc.yml", ".github/workflows/ci.yaml", "src/x.vue", ".nvmrc"].every(wantsFile)).toBe(true);
  expect(["README.md", "logo.png"].some(wantsFile)).toBe(false);
});

describe("packages ESLint 10 stopped installing", () => {
  const config = 'import js from "@eslint/js";\nimport { FlatCompat } from "@eslint/eslintrc";\nexport default [js.configs.recommended];\n';

  it("flags @eslint/js and @eslint/eslintrc imported but not declared", () => {
    const out = staticChecks({ "eslint.config.mjs": config, "package.json": pkg({ devDependencies: { eslint: "^10.0.0" } }) });
    const hits = out.filter((f) => f.id === "undeclared-eslint-package");
    expect(hits.map((f) => [f.severity, f.line])).toEqual([
      ["error", 1],
      ["error", 2],
    ]);
    expect(hits[0]?.fix).toContain('"@eslint/js": "^10.0.0"');
  });

  it("flags globals too, which ESLint 9 only brought in through @eslint/eslintrc", () => {
    // aggre/ullr: eslint.config.mjs imports @eslint/js and globals, package.json declares neither.
    const ullr = "import eslint from '@eslint/js'\nimport tseslint from 'typescript-eslint'\nimport globals from 'globals'\n";
    const out = staticChecks({ "eslint.config.mjs": ullr, "package.json": pkg({ devDependencies: { eslint: "10.14.0", "typescript-eslint": "^8.53.0" } }) });
    const hits = out.filter((f) => f.id === "undeclared-eslint-package");
    expect(hits.map((f) => [f.line, f.fix])).toEqual([
      [1, 'Add `"@eslint/js": "^10.0.0"` to devDependencies.'],
      [3, 'Add `"globals": "^14.0.0"` to devDependencies.'],
    ]);
    expect(hits[1]?.message).toContain("through @eslint/eslintrc");
  });

  it("accepts a declaration in any ancestor package.json (workspace root)", () => {
    const out = staticChecks({
      "packages/web/eslint.config.js": 'const js = require("@eslint/js");\n',
      "packages/web/package.json": pkg({ devDependencies: { eslint: "^10.0.0" } }),
      "package.json": pkg({ devDependencies: { "@eslint/js": "^10.0.0" } }),
      "other/package.json": pkg({ devDependencies: { "@eslint/eslintrc": "^3.3.7" } }),
    });
    expect(out.filter((f) => f.id === "undeclared-eslint-package")).toEqual([]);
  });

  it("does not count a sibling folder's package.json", () => {
    const out = staticChecks({
      "apps/a/eslint.config.js": 'import js from "@eslint/js";\n',
      "apps/a/package.json": pkg({ devDependencies: { eslint: "^9.39.0" } }),
      "apps/b/package.json": pkg({ devDependencies: { "@eslint/js": "^9.39.0" } }),
    });
    expect(out.find((f) => f.id === "undeclared-eslint-package")).toMatchObject({ severity: "warning", file: "apps/a/eslint.config.js" });
  });
});

describe("typescript-eslint too old for ESLint 10", () => {
  const lock = (v: string) => JSON.stringify({ packages: { "node_modules/typescript-eslint": { version: v } } });

  it("errors below 8.54.0 (crash), warns for 8.54-8.55 (peer range), passes 8.56+", () => {
    const run = (locked: string) =>
      staticChecks({ "package.json": pkg({ devDependencies: { eslint: "10.14.0", "typescript-eslint": locked } }), "package-lock.json": lock(locked) })
        .filter((f) => f.id === "typescript-eslint-version")
        .map((f) => f.severity);
    expect(run("8.41.0")).toEqual(["error"]);
    expect(run("8.55.0")).toEqual(["warning"]);
    expect(run("8.56.0")).toEqual([]);
  });

  it("uses the lowest version a range allows when there is no npm lockfile, and stays quiet on ESLint 9", () => {
    const hit = staticChecks({ "package.json": pkg({ devDependencies: { eslint: "^10.0.0", "@typescript-eslint/parser": "^8.40.0" } }) });
    expect(hit.find((f) => f.id === "typescript-eslint-version")).toMatchObject({ severity: "warning", message: expect.stringContaining("package.json allows ^8.40.0") });
    const nine = staticChecks({ "package.json": pkg({ devDependencies: { eslint: "^9.39.0", "typescript-eslint": "8.41.0" } }) });
    expect(nine.some((f) => f.id === "typescript-eslint-version")).toBe(false);
  });
});

describe("scopeToLintedFiles", () => {
  it("keeps eslint-env errors only for files the run lints or crashed on (terrestris/ol-util ignores its *.spec.ts)", () => {
    const env = (file: string) => ({ id: "eslint-env-comment", severity: "error" as const, file, line: 1, message: "m", docs: "d" });
    const out = scopeToLintedFiles([env("a.spec.ts"), env("b.spec.ts"), env("tasks/x.js"), env("c.ts"), env("new.ts")], {
      "a.spec.ts": "ignored",
      "b.spec.ts": "unmatched",
      "tasks/x.js": "fatal",
      "c.ts": "linted",
    });
    expect(out.map((f) => [f.file, f.severity])).toEqual([
      ["tasks/x.js", "error"],
      ["c.ts", "error"],
      ["new.ts", "error"],
      ["a.spec.ts", "info"],
    ]);
    expect(out[3]?.message).toMatch(/^2 more/);
  });
});

