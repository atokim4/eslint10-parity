import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalParser,
  mergeRuleOptions,
  normaliseEcmaVersion,
  normaliseEslintrc,
  normaliseFlat,
  normaliseRule,
  normaliseSeverity,
  packageFromPath,
  toPlain,
  type NormaliseContext,
} from "../src/normalise.js";
import { projectRoot } from "./harness.js";

const require = createRequire(import.meta.url);
const eslintDeepMerge = require(path.join(projectRoot, "engines/v10/node_modules/eslint/lib/shared/deep-merge-arrays.js")) as {
  deepMergeArrays: (a: unknown[] | undefined, b: unknown[]) => unknown[];
};

const ctx: NormaliseContext = {
  root: "/repo",
  ruleDefaults: () => undefined,
  envGlobals: (env) => ({ node: { process: false, require: false }, browser: { window: false } })[env],
  envEcmaVersion: (env) => (env === "es2021" ? 12 : undefined),
};

describe("severity and rule entries", () => {
  it.each([[2, 2], ["error", 2], [1, 1], ["warn", 1], [0, 0], ["off", 0], [undefined, 0], ["Error", 2], ["WARN", 1]])("%s -> %s", (input, out) => {
    expect(normaliseSeverity(input)).toBe(out);
  });

  it("treats 'error', ['error'] and [2] the same", () => {
    expect(normaliseRule("error")).toEqual(normaliseRule([2]));
    expect(normaliseRule(["error"])).toEqual({ severity: 2, options: [] });
  });
});

describe("mergeRuleOptions matches ESLint's deepMergeArrays", () => {
  const cases: Array<[unknown[] | undefined, unknown[]]> = [
    [undefined, ["always"]],
    [[{ a: 1, b: { c: 2 } }], [{ b: { d: 3 } }]],
    [[{ a: 1 }], []],
    [["always", { x: false }], ["never"]],
    [[{ list: [1, 2] }], [{ list: [3] }]],
    [[], [{ a: 1 }]],
  ];
  it.each(cases)("defaults %j, options %j", (defaults, options) => {
    expect(mergeRuleOptions(defaults, options)).toEqual(eslintDeepMerge.deepMergeArrays(defaults, options));
  });
});

describe("small normalisers", () => {
  it("names parser packages from install paths", () => {
    expect(packageFromPath("/r/node_modules/@typescript-eslint/parser/dist/index.js")).toBe("@typescript-eslint/parser");
    expect(packageFromPath("/r/node_modules/a/node_modules/vue-eslint-parser/index.js")).toBe("vue-eslint-parser");
    expect(canonicalParser("@typescript-eslint/parser")).toBe(canonicalParser("typescript-eslint/parser"));
  });

  it("writes ecmaVersion as a year", () => {
    expect(normaliseEcmaVersion(6)).toBe("2015");
    expect(normaliseEcmaVersion(2015)).toBe("2015");
    expect(normaliseEcmaVersion(12)).toBe("2021");
    expect(normaliseEcmaVersion(5)).toBe("5");
    expect(normaliseEcmaVersion("latest")).toBe("latest");
  });

  it("makes values JSON-safe and checkout-independent", () => {
    class Program {}
    const cyclic: Record<string, unknown> = { b: 1, a: "/repo/tsconfig.json" };
    cyclic.self = cyclic;
    expect(toPlain({ fn: () => 1, inst: new Program(), re: /x/g, nested: cyclic }, "/repo")).toEqual({
      fn: "[function]",
      inst: "[Program]",
      nested: { a: "<root>/tsconfig.json", b: 1, self: "[circular]" },
      re: "/x/g",
    });
    expect(toPlain("/repository/x", "/repo")).toBe("/repository/x");
  });
});

describe("eslintrc and flat configs meet in the middle", () => {
  it("expands envs to globals and keeps eslintrc's ES5 script defaults", () => {
    const n = normaliseEslintrc(
      { env: { node: true, es2021: true, "jest/globals": true }, globals: { myGlobal: "writable" }, rules: { semi: ["warn", "always"] }, plugins: ["react"] },
      ctx,
    );
    expect(n.globals).toEqual({ myGlobal: "writable", process: "readonly", require: "readonly" });
    expect(n.unresolvedEnvs).toEqual(["jest/globals"]);
    expect(n.ecmaVersion).toBe("2021");
    expect(n.sourceType).toBe("script");
    expect(n.rules.semi).toEqual({ severity: 1, options: ["always"] });
    expect(n.plugins).toEqual(["react"]);
    expect(normaliseEslintrc({}, ctx).ecmaVersion).toBe("5");
    expect(normaliseEslintrc({ reportUnusedDisableDirectives: true }, ctx).reportUnusedDisableDirectives).toBe(1);
    expect(normaliseEslintrc({}, ctx).processor).toBeUndefined();
    expect(normaliseEslintrc({ rules: { "import/no-extraneous-dependencies": ["error", { packageDir: "/repo/pkg" }] } }, ctx).rules["import/no-extraneous-dependencies"]?.options).toEqual([
      { packageDir: "<root>/pkg" },
    ]);
  });

  it("reads flat languageOptions, plugins and linterOptions", () => {
    const parser = { meta: { name: "typescript-eslint/parser" }, parseForESLint: () => ({}) };
    const n = normaliseFlat(
      {
        plugins: { "@": {}, react: {} },
        languageOptions: { parser, ecmaVersion: 2022, sourceType: "module", globals: { window: "readonly", x: true }, parserOptions: { project: "/repo/tsconfig.json", ecmaVersion: 2022 } },
        linterOptions: { reportUnusedDisableDirectives: true },
        rules: { semi: [1, "always"] },
      },
      ctx,
    );
    expect(n.plugins).toEqual(["react"]);
    expect(n.parser).toBe("typescript-eslint/parser");
    expect(n.globals).toEqual({ window: "readonly", x: "writable" });
    expect(n.parserOptions).toEqual({ project: "<root>/tsconfig.json" });
    expect(n.reportUnusedDisableDirectives).toBe(1);
  });
});
