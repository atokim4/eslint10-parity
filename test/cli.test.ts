import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fixturesDir, projectRoot } from "./harness.js";

const cli = path.join(projectRoot, "dist", "cli.mjs");
const tmp = mkdtempSync(path.join(tmpdir(), "e10p-cli-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function side(fixture: string, name: "before" | "after", engine: "v9" | "v10"): string {
  const dir = path.join(tmp, `${fixture}-${name}`);
  cpSync(path.join(fixturesDir, fixture, name), dir, { recursive: true });
  symlinkSync(path.join(projectRoot, "engines", engine, "node_modules"), path.join(dir, "node_modules"), "dir");
  return dir;
}

describe("built CLI", () => {
  it("exits 1 on a silent change and writes Markdown + JSON", () => {
    const before = side("port-lost-globs", "before", "v9");
    const after = side("port-lost-globs", "after", "v10");
    const md = path.join(tmp, "r.md");
    const json = path.join(tmp, "r.json");
    const res = spawnSync(process.execPath, [cli, "compare", "--before", before, "--after", after, "--md", md, "--json", json]);
    expect(res.status).toBe(1);
    expect(readFileSync(md, "utf8")).toMatch(/^# eslint10-parity: SILENT CHANGE/);
    const data = JSON.parse(readFileSync(json, "utf8")) as { diff: { stoppedLinting: unknown[] }; before: { eslint: { version: string } } };
    expect(data.diff.stoppedLinting).toHaveLength(2);
    expect(data.before.eslint.version).toBe("9.39.5");
  });

  it("bumps the same checkout to the pinned ESLint 10 when --after is missing", () => {
    const dir = side("parity-ok", "before", "v9");
    const out = execFileSync(process.execPath, [cli, "compare", "--before", dir, "--fail-on", "low"]).toString();
    expect(out).toContain("# eslint10-parity: PARITY");
    expect(out).toContain("| after | 10.14.0 |");
  });

  it("runs --args instead of the package script, and static checks", () => {
    const dir = side("eslintrc-bump", "before", "v9");
    const res = spawnSync(process.execPath, [cli, "snapshot", dir, "--args", "ESLINT_USE_FLAT_CONFIG=false eslint . --max-warnings 0"]);
    expect(res.status).toBe(0);
    const snap = JSON.parse(res.stdout.toString()) as { units: Array<{ mode: string; invocation: { maxWarnings: number } }> };
    expect(snap.units[0]).toMatchObject({ mode: "eslintrc", invocation: { maxWarnings: 0 } });
    const st = spawnSync(process.execPath, [cli, "static", dir]);
    expect(st.status).toBe(1);
    expect(st.stdout.toString()).toContain("eslintrc-only");
  });

  it("rejects bad usage with exit 2", () => {
    expect(spawnSync(process.execPath, [cli, "compare"]).status).toBe(2);
    expect(spawnSync(process.execPath, [cli, "frobnicate", "x"]).status).toBe(2);
    expect(spawnSync(process.execPath, [cli, "--fail-on", "sometimes", "compare", "--before", "."]).status).toBe(2);
  });
});
