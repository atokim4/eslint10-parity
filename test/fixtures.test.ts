import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { fixturesDir, runFixture, type FixtureRun } from "./harness.js";

/** Each fixture is one failure class; REPORT.md next to it is exactly what the tool prints. */
const runs = new Map<string, FixtureRun>();
const names = ["port-lost-globs", "lost-eslintignore", "monorepo-lookup", "v10-findings", "eslintrc-bump", "parity-ok", "cli-options"];

beforeAll(async () => {
  for (const name of names) runs.set(name, await runFixture(name));
}, 180_000);

const run = (name: string): FixtureRun => {
  const r = runs.get(name);
  if (!r) throw new Error(`fixture ${name} did not run`);
  return r;
};

describe.each(names)("%s report", (name) => {
  it("matches REPORT.md", async () => {
    await expect(run(name).markdown).toMatchFileSnapshot(path.join(fixturesDir, name, "REPORT.md"));
  });
});

describe("eslintrc -> flat port that forgot globs", () => {
  it("flags .vue and .cts files that stopped being linted while CI got greener", () => {
    const { diff } = run("port-lost-globs");
    expect(diff.stoppedLinting.map((c) => c.file)).toEqual(["src/Widget.vue", "src/legacy.cts"]);
    expect(diff.stoppedLinting.every((c) => c.after === "unmatched")).toBe(true);
    expect(diff.verdict.silent).toBe(true);
    expect(diff.before.exitCode).toBe(1);
    expect(diff.after.exitCode).toBe(0);
  });

  it("reports the no-console downgrade but not the parser rename or merged defaults", () => {
    const items = run("port-lost-globs").diff.configGroups.flatMap((g) => g.items);
    expect(items.some((i) => i.kind === "severity" && i.text.includes("no-console") && i.impact === "high")).toBe(true);
    expect(items.some((i) => i.kind === "parser")).toBe(false);
    expect(items.some((i) => i.kind === "options")).toBe(false);
  });
});

describe("lost .eslintignore", () => {
  it("shows the generated file now linted and the static warning", () => {
    const { diff, statics } = run("lost-eslintignore");
    expect(diff.startedLinting.map((c) => [c.file, c.before])).toEqual([["generated/schema.js", "ignored"]]);
    expect(statics.find((s) => s.id === "eslintignore")?.fix).toContain('globalIgnores(["generated/"])');
  });
});

describe("monorepo config lookup", () => {
  it("catches ESLint 10 switching packages/web to its nested config", () => {
    const { diff, before, after } = run("monorepo-lookup");
    expect(before.files["packages/web/src/main.js"]?.configFile).toBe("eslint.config.js");
    expect(after.files["packages/web/src/main.js"]?.configFile).toBe("packages/web/eslint.config.js");
    expect(after.files["packages/api/src/server.js"]?.configFile).toBe("eslint.config.js");
    const vanished = diff.findings.filter((f) => f.direction === "vanished").map((f) => f.ruleId).sort();
    expect(vanished).toEqual(["no-console", "prefer-const"]);
    expect(diff.verdict.silent).toBe(true);
  });
});

describe("ESLint 10 behaviour changes on an unchanged flat config", () => {
  it("labels every changed finding with its documented cause", () => {
    const { diff } = run("v10-findings");
    const causes = diff.findings.map((f) => [f.ruleId, f.direction, f.expected]);
    expect(causes).toContainEqual(["(core)", "appeared", true]);
    expect(causes).toContainEqual(["preserve-caught-error", "appeared", true]);
    expect(causes).toContainEqual(["no-unused-vars", "vanished", true]);
    expect(diff.verdict.high).toBe(0);
    expect(diff.verdict.medium).toBe(0);
  });
});

describe("eslintrc repo with a bare ESLint 10 bump", () => {
  it("is broken, not silent", () => {
    const { diff, statics } = run("eslintrc-bump");
    expect(diff.verdict.status).toBe("broken");
    expect(diff.verdict.silent).toBe(false);
    expect(diff.after.units[0]?.fatal).toMatch(/Could not find config file/);
    expect(statics.map((s) => s.id)).toEqual(expect.arrayContaining(["eslintrc-only", "flat-config-env", "node-engine"]));
  });
});

describe("parity", () => {
  it("reports nothing when only defaultOptions became explicit", () => {
    const { diff, before, after } = run("parity-ok");
    // ESLint 10 gives no-constant-binary-expression a default option ESLint 9 did not have.
    expect(after.ruleDefaults["no-constant-binary-expression"]).toBeDefined();
    expect(before.ruleDefaults["no-constant-binary-expression"]).toBeUndefined();
    expect(diff.verdict.status).toBe("ok");
  });
});

describe("the lint command line, as the ESLint CLI builds it", () => {
  it("honours --ext, --ignore-pattern and --rule in flat mode and never applies --fix", () => {
    const { before, after, diff } = run("cli-options");
    for (const snap of [before, after]) {
      expect(snap.files["src/total.ts"]?.status).toBe("linted");
      expect(snap.files["src/total.ts"]?.messages?.map((m) => m.ruleId)).toEqual(["prefer-const"]);
      expect(snap.files["dist/out.js"]?.status).toBe("ignored");
      expect(Object.values(snap.configs).some((c) => c.rules["no-var"]?.severity === 2)).toBe(true);
    }
    // prefer-const is fixable: still being reported proves --fix was not applied to the checkout.
    expect(diff.verdict.status).toBe("ok");
  });
});
