import { describe, expect, it } from "vitest";
import { diffSnapshots, exitFor } from "../src/diff.js";
import type { FileRecord, NormalConfig, Snapshot } from "../src/types.js";

const baseConfig = (over: Partial<NormalConfig> = {}): NormalConfig => ({
  rules: {},
  plugins: [],
  parser: "espree",
  language: "js/js",
  processor: null,
  ecmaVersion: "latest",
  sourceType: "module",
  globals: {},
  unresolvedEnvs: [],
  parserOptions: {},
  settings: {},
  reportUnusedDisableDirectives: 1,
  ...over,
});

function snap(version: string, files: Record<string, FileRecord>, configs: Record<string, NormalConfig>, extra: Partial<Snapshot> = {}): Snapshot {
  return {
    tool: "eslint10-parity",
    schema: 1,
    label: version,
    root: "/r",
    eslint: { version, path: "" },
    packages: {},
    units: [{ invocation: { cwd: ".", patterns: ["."], flags: [], source: "t" }, mode: "flat", exitCode: 0, errorCount: 0, warningCount: 0, processWarnings: [] }],
    files,
    configs,
    ruleDefaults: {},
    ...extra,
  };
}

const linted = (config: string, messages: FileRecord["messages"] = []): FileRecord => ({ status: "linted", unit: ".", config, configFile: "eslint.config.js", messages });

describe("rule options", () => {
  it("does not report a default ESLint 10 made explicit, but does report a changed default", () => {
    const before = snap("9.39.5", { "a.js": linted("c") }, { c: baseConfig({ rules: { r: { severity: 2, options: [] }, s: { severity: 2, options: [{ x: false }] } } }) }, {
      ruleDefaults: { s: [{ x: false }] },
    });
    const after = snap("10.14.0", { "a.js": linted("c") }, { c: baseConfig({ rules: { r: { severity: 2, options: [{ strict: false }] }, s: { severity: 2, options: [{ x: true }] } } }) }, {
      ruleDefaults: { r: [{ strict: false }], s: [{ x: true }] },
    });
    const items = diffSnapshots(before, after).configGroups.flatMap((g) => g.items);
    expect(items).toEqual([expect.objectContaining({ kind: "options", impact: "low", text: expect.stringContaining("rule s options") })]);
  });

  it("reports a user option change at medium", () => {
    const before = snap("9.39.5", { "a.js": linted("c") }, { c: baseConfig({ rules: { q: { severity: 2, options: ["double"] } } }) });
    const after = snap("10.14.0", { "a.js": linted("c") }, { c: baseConfig({ rules: { q: { severity: 2, options: ["single"] } } }) });
    expect(diffSnapshots(before, after).configGroups[0]?.items[0]).toMatchObject({ kind: "options", impact: "medium" });
  });
});

describe("findings", () => {
  const m = (ruleId: string | null, line: number, severity: 1 | 2 = 2, message = "x") => ({ ruleId, line, column: 1, severity, message });

  it("matches duplicates as a multiset and reports severity drops", () => {
    const c = { c: baseConfig({ rules: { r: { severity: 2, options: [] } } }) };
    const before = snap("9.39.5", { "a.js": linted("c", [m("r", 1), m("r", 1), m("r", 2)]) }, c);
    const after = snap("10.14.0", { "a.js": linted("c", [m("r", 1), m("r", 2, 1)]) }, c);
    const groups = diffSnapshots(before, after).findings;
    expect(groups.map((g) => [g.direction, g.count, g.impact]).sort()).toEqual([
      ["severity", 1, "high"],
      ["vanished", 1, "high"],
    ]);
  });

  it("treats a finding that only moved column as unchanged", () => {
    const c = { c: baseConfig({ rules: { r: { severity: 2, options: [] } } }) };
    const moved = { ruleId: "r", line: 3, column: 9, severity: 2 as const, message: "x" };
    const before = snap("9.39.5", { "a.js": linted("c", [m("r", 3)]) }, c);
    const after = snap("10.14.0", { "a.js": linted("c", [moved]) }, c);
    expect(diffSnapshots(before, after).findings).toEqual([]);
  });

  it("counts JSX tracking as expected in .js files with JSX enabled", () => {
    const jsx = baseConfig({ rules: { "no-unused-vars": { severity: 2, options: [] } }, parserOptions: { ecmaFeatures: { jsx: true } } });
    const before = snap("9.39.5", { "a.js": linted("c", [m("no-unused-vars", 1)]) }, { c: jsx });
    const after = snap("10.14.0", { "a.js": linted("c") }, { c: jsx });
    expect(diffSnapshots(before, after).findings[0]).toMatchObject({ expected: true, cause: expect.stringContaining("JSX") });
  });

  it("does not count findings of files that stopped being linted twice", () => {
    const before = snap("9.39.5", { "a.vue": linted("c", [m("r", 1)]) }, { c: baseConfig() });
    const after = snap("10.14.0", { "a.vue": { status: "unmatched", unit: ".", reason: "no config object's `files` matches this file" } }, {});
    const d = diffSnapshots(before, after);
    expect(d.stoppedLinting).toEqual([expect.objectContaining({ file: "a.vue", findings: 1 })]);
    expect(d.findings).toEqual([]);
    expect(d.verdict).toMatchObject({ status: "changed", silent: true, high: 1 });
  });
});

describe("verdict and exitFor", () => {
  const one = (v: string) => snap(v, { "a.js": linted("c") }, { c: baseConfig() });
  it("has no baseline when the before side crashed or nothing was linted", () => {
    const crashed = snap("9.39.5", { "a.js": { status: "fatal", unit: ".", reason: "x" } }, {});
    crashed.units[0] = { ...(crashed.units[0] as Snapshot["units"][number]), fatal: { message: "Cannot find module 'x'" }, exitCode: 2 };
    const both = diffSnapshots(crashed, crashed);
    expect(both.verdict.status).toBe("inconclusive");
    expect(exitFor(both, "never")).toBe(2);
    expect(diffSnapshots(snap("9.39.5", {}, {}), snap("10.14.0", {}, {})).verdict.status).toBe("inconclusive");
  });

  it("passes parity and respects --fail-on", () => {
    const ok = diffSnapshots(one("9.39.5"), one("10.14.0"));
    expect(ok.verdict.status).toBe("ok");
    expect(exitFor(ok, "low")).toBe(0);
    const changed = { ...ok, verdict: { ...ok.verdict, status: "changed" as const, medium: 2 } };
    expect(exitFor(changed, "high")).toBe(0);
    expect(exitFor(changed, "medium")).toBe(1);
    expect(exitFor(changed, "never")).toBe(0);
    expect(exitFor({ ...ok, verdict: { ...ok.verdict, status: "broken" } }, "high")).toBe(1);
  });

  it("says so when documented ESLint 10 findings turn a green lint red", () => {
    const after = snap("10.14.0", { "a.js": linted("c", [{ ruleId: "no-useless-assignment", line: 3, column: 5, severity: 2, message: "x" }]) }, {
      c: baseConfig({ rules: { "no-useless-assignment": { severity: 2, options: [] } } }),
    });
    after.units[0] = { ...(after.units[0] as Snapshot["units"][number]), exitCode: 1, errorCount: 1 };
    const d = diffSnapshots(one("9.39.5"), after);
    expect(d.verdict.status).toBe("changed");
    expect(d.verdict.headline).toBe("Lint now fails (exit 0 -> 1) with 1 new error, all from documented ESLint 10 changes.");
  });

  it("does not blame ESLint for a crash a co-bumped package causes", () => {
    const after = snap("10.12.0", { "a.js": { status: "fatal", unit: ".", reason: "x" } }, {});
    after.units[0] = { ...(after.units[0] as Snapshot["units"][number]), fatal: { message: "typescript-eslint does not support TS 7.0." }, exitCode: 2 };
    const d = diffSnapshots(one("10.2.0"), after);
    expect(d.verdict.status).toBe("broken");
    expect(d.verdict.headline).toMatch(/^Lint crashes after the bump \(exit 2\), caused by typescript-eslint refusing TypeScript 7\.0/);
  });
});

describe("defaultDriven", () => {
  it("accepts changes where each side only holds its own default", async () => {
    const { defaultDriven } = await import("../src/diff.js");
    const dB = [{ capIsNew: true, capIsNewExceptions: ["Array"] }];
    const dA = [{ capIsNew: true, capIsNewExceptions: [] }];
    expect(defaultDriven([{ capIsNew: false, capIsNewExceptions: ["Array"] }], [{ capIsNew: false, capIsNewExceptions: [] }], dB, dA)).toBe(true);
    expect(defaultDriven([{ capIsNew: false, capIsNewExceptions: ["Array"] }], [{ capIsNew: true, capIsNewExceptions: [] }], dB, dA)).toBe(false);
    expect(defaultDriven(["always"], ["never"], ["always"], ["never"])).toBe(true);
    expect(defaultDriven(["always"], ["always"], ["always"], ["never"])).toBe(false);
    expect(defaultDriven([{ a: 1 }], [{ a: 2 }], undefined, [{ a: 2 }])).toBe(false);
  });
});
