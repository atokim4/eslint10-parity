import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { collect } from "./collector/collect.js";
import { findEslintCommand, parseEslintArgs, shellWords } from "./collector/invocation.js";
import { diffSnapshots, exitFor, FAIL_LEVELS } from "./diff.js";
import { renderMarkdown, renderStaticMarkdown } from "./report/markdown.js";
import { scopeToLintedFiles, staticChecks, type StaticFinding } from "./static/index.js";
import { readRepoFiles } from "./static/read.js";
import type { Invocation, Snapshot } from "./types.js";

const VERSION = "0.1.0";

const HELP = `eslint10-parity ${VERSION}
Proves an ESLint 9 -> 10 upgrade did not silently change what gets linted.

Usage:
  eslint10-parity compare --before <dir> [--after <dir>] [options]
  eslint10-parity snapshot <dir> [--eslint <engine>] [--out snapshot.json]
  eslint10-parity diff <before.json> <after.json> [options]
  eslint10-parity static <dir> [--json <file>]

compare: lints both checkouts the way their package.json lint script does and
diffs per-file coverage, resolved config and findings. Without --after, the
same checkout is linted again with ESLint 10 (what a bare version bump does).

Options:
  --before-eslint <engine>  repo (default) | 9 | 10 | path to an eslint install
  --after-eslint <engine>   repo (default when --after is given) | 9 | 10 | path
  --args "<eslint args>"    lint both sides with this command line instead of the scripts
  --cwd <dir>               run --args in this repo subfolder (default ".")
  --md <file>               write the Markdown report there (default: stdout)
  --json <file>             write the full diff (and both snapshots) as JSON
  --fail-on <level>         exit 1 on changes at this impact or above: high (default) | medium | low | never
  --timeout <minutes>       per lint unit (default 15)
  -h, --help | -v, --version

Engines "9" and "10" are the pinned installs in engines/ (npm run engines).
Exit codes: 0 parity (or below --fail-on), 1 changes at --fail-on level, 2 no baseline, usage or tool error.`;

function fail(message: string): never {
  process.stderr.write(`eslint10-parity: ${message}\n`);
  process.exit(2);
}

function argsUnits(args: string | undefined, cwd: string | undefined): Invocation[] | undefined {
  if (args === undefined) return undefined;
  // Accept a full command ("ESLINT_USE_FLAT_CONFIG=false eslint src") or just the arguments.
  const found = findEslintCommand(args);
  const eslintArgs = found?.args ?? shellWords(args);
  return [
    parseEslintArgs(eslintArgs, { cwd: cwd ?? ".", source: "--args", command: args, env: found?.env ?? {}, nodeFlags: found?.nodeFlags ?? [] }),
  ];
}

function output(markdown: string, mdFile: string | undefined): void {
  if (mdFile) writeFileSync(mdFile, markdown);
  else process.stdout.write(markdown);
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      before: { type: "string" },
      after: { type: "string" },
      "before-eslint": { type: "string" },
      "after-eslint": { type: "string" },
      eslint: { type: "string" },
      args: { type: "string" },
      cwd: { type: "string" },
      md: { type: "string" },
      json: { type: "string" },
      out: { type: "string" },
      "fail-on": { type: "string", default: "high" },
      timeout: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const failOn = values["fail-on"] ?? "high";
  if (!FAIL_LEVELS.includes(failOn)) fail(`--fail-on must be high, medium, low or never (got ${failOn})`);
  const timeoutMs = values.timeout ? Number(values.timeout) * 60_000 : undefined;
  if (timeoutMs !== undefined && !(timeoutMs > 0)) fail("--timeout must be a positive number of minutes");
  const units = argsUnits(values.args, values.cwd);
  const [command = "compare", ...rest] = positionals;

  if (command === "static") {
    const root = path.resolve(rest[0] ?? values.before ?? ".");
    const findings = staticChecks(readRepoFiles(root));
    if (values.json) writeFileSync(values.json, `${JSON.stringify(findings, null, 2)}\n`);
    output(renderStaticMarkdown(path.basename(root), findings), values.md);
    return findings.some((f) => f.severity === "error") && failOn !== "never" ? 1 : 0;
  }

  if (command === "snapshot") {
    const root = rest[0] ?? fail("snapshot needs a directory");
    const snap = await collect({ root, label: path.basename(path.resolve(root)), engine: values.eslint ?? "repo", units, timeoutMs });
    const json = `${JSON.stringify(snap, null, 2)}\n`;
    if (values.out) writeFileSync(values.out, json);
    else process.stdout.write(json);
    return 0;
  }

  let before: Snapshot;
  let after: Snapshot;
  let statics: StaticFinding[] = [];
  if (command === "diff") {
    const [a, b] = rest;
    if (!a || !b) fail("diff needs two snapshot files");
    before = JSON.parse(readFileSync(a, "utf8")) as Snapshot;
    after = JSON.parse(readFileSync(b, "utf8")) as Snapshot;
  } else if (command === "compare") {
    const beforeDir = values.before ?? rest[0] ?? fail("compare needs --before <dir>");
    const afterDir = values.after ?? rest[1];
    const afterEngine = values["after-eslint"] ?? (afterDir ? "repo" : "10");
    before = await collect({ root: beforeDir, label: "before", engine: values["before-eslint"] ?? "repo", units, timeoutMs });
    after = await collect({ root: afterDir ?? beforeDir, label: "after", engine: afterEngine, units, timeoutMs });
    const status = Object.fromEntries(Object.entries(after.files).map(([file, r]) => [file, r.status]));
    statics = scopeToLintedFiles(staticChecks(readRepoFiles(path.resolve(afterDir ?? beforeDir))), status);
  } else {
    fail(`unknown command "${command}" (try --help)`);
  }

  const diff = diffSnapshots(before, after);
  if (values.json) writeFileSync(values.json, `${JSON.stringify({ tool: "eslint10-parity", version: VERSION, diff, static: statics, before, after }, null, 2)}\n`);
  output(renderMarkdown(diff, statics), values.md);
  return exitFor(diff, failOn);
}

main(process.argv.slice(2)).then(
  // exitCode, not exit(): a piped report on stdout may still be flushing.
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => fail(err instanceof Error ? err.message : String(err)),
);
