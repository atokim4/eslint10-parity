/** Runs a fixture the way a user would: two checkouts, each with its own installed ESLint. */
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collect } from "../src/collector/collect.js";
import { diffSnapshots, type ParityDiff } from "../src/diff.js";
import { renderMarkdown } from "../src/report/markdown.js";
import { staticChecks, type StaticFinding } from "../src/static/index.js";
import { readRepoFiles } from "../src/static/read.js";
import type { Snapshot } from "../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, "..");
export const fixturesDir = path.join(here, "fixtures");

export interface FixtureRun {
  before: Snapshot;
  after: Snapshot;
  diff: ParityDiff;
  statics: StaticFinding[];
  markdown: string;
}

/** Copies one side into `dir` and links the pinned ESLint toolchain in as its node_modules. */
function checkout(src: string, dir: string, engine: "v9" | "v10"): void {
  cpSync(src, dir, { recursive: true });
  symlinkSync(path.join(projectRoot, "engines", engine, "node_modules"), path.join(dir, "node_modules"), "dir");
}

/**
 * before/ runs on ESLint 9. after/ runs on ESLint 10; a fixture without
 * after/ is the same checkout with only the ESLint version bumped.
 */
export async function runFixture(name: string): Promise<FixtureRun> {
  const src = path.join(fixturesDir, name);
  const tmp = mkdtempSync(path.join(tmpdir(), `e10p-fx-${name}-`));
  try {
    const beforeDir = path.join(tmp, "before");
    const afterDir = path.join(tmp, "after");
    checkout(path.join(src, "before"), beforeDir, "v9");
    checkout(path.join(src, existsSync(path.join(src, "after")) ? "after" : "before"), afterDir, "v10");
    const before = await collect({ root: beforeDir, label: "before", engine: "repo" });
    const after = await collect({ root: afterDir, label: "after", engine: "repo" });
    const diff = diffSnapshots(before, after);
    const statics = staticChecks(readRepoFiles(afterDir));
    const markdown = renderMarkdown(diff, statics).replaceAll(tmp, "<tmp>");
    return { before, after, diff, statics, markdown };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
