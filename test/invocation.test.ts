import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { detectUnits, findEslintCommand, lintScript, parseEslintArgs, shellWords } from "../src/collector/invocation.js";
import { inPatternScope, legacyPluginPackage } from "../src/collector/paths.js";

describe("shellWords", () => {
  it("keeps quoted globs together and splits operators", () => {
    expect(shellWords(`eslint "src/**/*.{ts,tsx}" --max-warnings=0 && tsc`)).toEqual(["eslint", "src/**/*.{ts,tsx}", "--max-warnings=0", "&&", "tsc"]);
    expect(shellWords("a;b|c")).toEqual(["a", ";", "b", "|", "c"]);
    expect(shellWords(`x ''`)).toEqual(["x", ""]);
  });
});

describe("parseEslintArgs", () => {
  it("does not take option values as file patterns", () => {
    const inv = parseEslintArgs(["--cache", "--cache-file", ".cache/eslintcache", "--suppress-rule", "no-console", "src"], { cwd: ".", source: "t" });
    expect(inv.patterns).toEqual(["src"]);
  });

  it("keeps ESLINT_FLAGS from the script's env prefix", () => {
    const inv = parseEslintArgs(["src"], { cwd: ".", source: "t", env: { ESLINT_FLAGS: "v10_config_lookup_from_file, unstable_native_nodejs_ts_config" } });
    expect(inv.flags).toEqual(["v10_config_lookup_from_file", "unstable_native_nodejs_ts_config"]);
  });
});

describe("findEslintCommand", () => {
  it.each([
    ["eslint .", {}, ["."]],
    ["ESLINT_USE_FLAT_CONFIG=false eslint src --ext .ts", { ESLINT_USE_FLAT_CONFIG: "false" }, ["src", "--ext", ".ts"]],
    ["cross-env ESLINT_USE_FLAT_CONFIG=false eslint .", { ESLINT_USE_FLAT_CONFIG: "false" }, ["."]],
    ["prettier --check . && npx eslint --cache lib", {}, ["--cache", "lib"]],
    ["pnpm exec eslint .", {}, ["."]],
    ["eslint . > lint.txt", {}, ["."]],
    ["eslint src 2>&1 | tee out", {}, ["src"]],
    ["npx --no-install eslint src", {}, ["src"]],
  ])("%s", (cmd, env, args) => {
    expect(findEslintCommand(cmd)).toEqual({ env, args, nodeFlags: [] });
  });

  it("keeps node flags for memory-hungry repos", () => {
    expect(findEslintCommand("NODE_OPTIONS=--max-old-space-size=4096 node --stack-size=2000 node_modules/.bin/eslint .")).toEqual({
      env: { NODE_OPTIONS: "--max-old-space-size=4096" },
      args: ["."],
      nodeFlags: ["--stack-size=2000"],
    });
    const inv = parseEslintArgs(["."], { cwd: ".", source: "t", env: { NODE_OPTIONS: "--max-old-space-size=4096" }, nodeFlags: ["--stack-size=2000"] });
    expect(inv.nodeOptions).toBe("--max-old-space-size=4096 --stack-size=2000");
  });

  it("ignores scripts that only mention eslint", () => {
    expect(findEslintCommand("eslint-config-prettier-check")).toBeNull();
    expect(findEslintCommand("next lint")).toBeNull();
  });
});

describe("parseEslintArgs", () => {
  it("reads the options that change what gets linted", () => {
    const inv = parseEslintArgs(
      ["src", "test", "--ext", "js,.vue", "--ext=.ts", "-c", "cfg.js", "--ignore-path", ".gitignore", "--max-warnings", "0", "--flag", "x", "-f", "json", "--no-eslintrc", "--no-error-on-unmatched-pattern"],
      { cwd: ".", source: "t", env: { ESLINT_FLAGS: "a,b" } },
    );
    expect(inv.patterns).toEqual(["src", "test"]);
    expect(inv.extensions).toEqual([".js", ".vue", ".ts"]);
    expect(inv.configFile).toBe("cfg.js");
    expect(inv.ignorePath).toBe(".gitignore");
    expect(inv.maxWarnings).toBe(0);
    expect(inv.flags).toEqual(["a", "b", "x"]);
    expect(inv.noConfigLookup).toBe(true);
    expect(inv.errorOnUnmatchedPattern).toBe(false);
  });

  it("defaults to the current directory, and --stats takes no value", () => {
    expect(parseEslintArgs(["--fix"], { cwd: ".", source: "t" }).patterns).toEqual(["."]);
    expect(parseEslintArgs(["--stats", "src"], { cwd: ".", source: "t" }).patterns).toEqual(["src"]);
  });
});

describe("lint units", () => {
  const root = mkdtempSync(path.join(tmpdir(), "e10p-inv-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const write = (rel: string, data: unknown) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), JSON.stringify(data));
  };

  it("prefers lint:eslint over lint and skips non-eslint scripts", () => {
    expect(lintScript({ scripts: { lint: "eslint .", "lint:eslint": "eslint src" } })?.name).toBe("lint:eslint");
    expect(lintScript({ scripts: { lint: "turbo lint", check: "eslint ." } })?.name).toBe("check");
    expect(lintScript({ scripts: { cfg: "eslint --print-config src/a.js", "lint:fix": "eslint --fix .", z: "eslint src" } })?.name).toBe("z");
    expect(lintScript({ scripts: { "lint:fix": "eslint --fix .", cfg: "eslint --print-config a.js" } })?.name).toBe("lint:fix");
  });

  it("falls back to workspace packages when the root script delegates", () => {
    write("package.json", { workspaces: ["packages/*"], scripts: { lint: "turbo run lint" } });
    write("packages/a/package.json", { scripts: { lint: "eslint src --max-warnings 0" } });
    write("packages/b/package.json", { scripts: { build: "tsc" } });
    writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - 'tools/*' # internal tools\n  - '!tools/legacy'\n");
    write("tools/legacy/package.json", { scripts: { lint: "eslint ." } });
    write("tools/c/package.json", { scripts: { lint: "eslint ." } });
    const units = detectUnits(root);
    expect(units.map((u) => [u.cwd, u.patterns, u.maxWarnings])).toEqual([
      ["packages/a", ["src"], 0],
      ["tools/c", ["."], undefined],
    ]);
  });
});

describe("path helpers", () => {
  it("scopes files to CLI patterns", () => {
    expect(inPatternScope("/r/src/a.js", "/r", ["src"])).toBe(true);
    expect(inPatternScope("/r/lib/a.js", "/r", ["src"])).toBe(false);
    expect(inPatternScope("/r/src/x/a.ts", "/r", ["src/**/*.ts"])).toBe(true);
    expect(inPatternScope("/r/src/x/a.js", "/r", ["src/**/*.ts"])).toBe(false);
    expect(inPatternScope("/other/a.js", "/r", ["."])).toBe(false);
  });

  it("maps eslintrc plugin names to packages", () => {
    expect(legacyPluginPackage("react")).toBe("eslint-plugin-react");
    expect(legacyPluginPackage("@typescript-eslint")).toBe("@typescript-eslint/eslint-plugin");
    expect(legacyPluginPackage("@scope/foo")).toBe("@scope/eslint-plugin-foo");
    expect(legacyPluginPackage("eslint-plugin-vue")).toBe("eslint-plugin-vue");
  });
});
