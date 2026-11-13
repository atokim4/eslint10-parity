/**
 * Builds a Snapshot of one checkout: finds candidate files and lint units,
 * runs one worker process per unit with the chosen ESLint install, merges.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Invocation, Snapshot, WorkerInput, WorkerOutput } from "../types.js";
import { detectUnits } from "./invocation.js";

/** Extensions worth asking ESLint about. Anything ESLint lints on its own is added too. */
export const CANDIDATE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx", ".vue", ".svelte", ".astro",
  ".md", ".mdx", ".json", ".jsonc", ".json5", ".css", ".html",
]);

const SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".svn"]);

/** Packages whose version changes what ESLint reports. */
export const TRACKED_PACKAGES = [
  "eslint", "@eslint/js", "@eslint/eslintrc", "@eslint/compat", "typescript-eslint", "@typescript-eslint/parser",
  "@typescript-eslint/eslint-plugin", "eslint-plugin-vue", "vue-eslint-parser", "eslint-plugin-react",
  "eslint-plugin-react-hooks", "@eslint-react/eslint-plugin", "eslint-config-next", "@nuxt/eslint", "eslint-plugin-import",
  "eslint-plugin-import-x", "eslint-plugin-svelte", "jiti", "globals",
];

function walk(root: string, dir = root, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(root, path.join(dir, entry.name), out);
    } else if (entry.isFile()) out.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join("/"));
  }
  return out;
}

/** Repo-relative files to classify: git's view (tracked + untracked, not gitignored) when there is a repo. */
export function candidateFiles(root: string): string[] {
  let files: string[];
  try {
    // Works in a subfolder of a checkout too (paths come out relative to it); fails outside a git repo.
    const out = execFileSync("git", ["ls-files", "-z", "-c", "-o", "--exclude-standard"], {
      cwd: root,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString("utf8");
    files = out.split("\0").filter((f) => f && existsSync(path.join(root, f)));
  } catch {
    files = walk(root);
  }
  return files.filter((f) => CANDIDATE_EXTENSIONS.has(path.extname(f).toLowerCase()) && !f.split("/").some((p) => SKIP_DIRS.has(p))).sort();
}

/** Version of `name` as Node would resolve it from `dir`. */
export function resolvedVersion(name: string, dir: string, stopAt = "/"): string | undefined {
  let current = dir;
  for (;;) {
    const file = path.join(current, "node_modules", name, "package.json");
    if (existsSync(file)) {
      try {
        return String((JSON.parse(readFileSync(file, "utf8")) as { version?: string }).version);
      } catch {
        return undefined;
      }
    }
    if (current === stopAt) return undefined;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export interface EngineChoice {
  /** "repo" = the eslint the checkout itself installed; otherwise a directory holding node_modules/eslint. */
  kind: "repo" | "dir";
  dir?: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** Project root of eslint10-parity itself (dist/ or src/collector/ sit two levels below at most). */
export function toolRoot(): string {
  let dir = here;
  while (!existsSync(path.join(dir, "engines")) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  return dir;
}

/** Turns "repo" | "9" | "10" | a path into the directory of an eslint package. */
export function resolveEngine(spec: string, unitDir: string, root = unitDir): string {
  if (spec === "repo") {
    // Never above the checkout: an ancestor folder's eslint would silently stand in for a missing install.
    let dir = unitDir;
    for (;;) {
      const candidate = path.join(dir, "node_modules", "eslint");
      if (existsSync(path.join(candidate, "package.json"))) return candidate;
      const parent = path.dirname(dir);
      if (dir === root || parent === dir) {
        throw new Error(`no eslint installed in ${path.basename(root)} (run the repo's install first, or pass an engine)`);
      }
      dir = parent;
    }
  }
  if (spec === "9" || spec === "10") {
    const dir = path.join(toolRoot(), "engines", `v${spec}`, "node_modules", "eslint");
    if (!existsSync(path.join(dir, "package.json"))) {
      throw new Error(`pinned ESLint ${spec} is not installed: run \`npm run engines\` in ${toolRoot()}`);
    }
    return dir;
  }
  const abs = path.resolve(spec);
  const asPkg = existsSync(path.join(abs, "node_modules", "eslint", "package.json")) ? path.join(abs, "node_modules", "eslint") : abs;
  if (!existsSync(path.join(asPkg, "package.json"))) throw new Error(`no eslint package at ${spec}`);
  return asPkg;
}

function workerPath(): string {
  const built = path.join(here, "worker.mjs");
  if (existsSync(built)) return built;
  return path.join(toolRoot(), "dist", "worker.mjs");
}

function workerEnv(invocation: Invocation): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ESLINT_USE_FLAT_CONFIG;
  delete env.ESLINT_FLAGS;
  delete env.NODE_OPTIONS;
  if (invocation.nodeOptions) env.NODE_OPTIONS = invocation.nodeOptions;
  if (invocation.useFlatConfigEnv !== undefined) env.ESLINT_USE_FLAT_CONFIG = invocation.useFlatConfigEnv;
  return env;
}

function runWorker(input: WorkerInput, timeoutMs: number): Promise<WorkerOutput> {
  const dir = mkdtempSync(path.join(tmpdir(), "e10p-w-"));
  const inFile = path.join(dir, "in.json");
  writeFileSync(inFile, JSON.stringify({ ...input, outFile: path.join(dir, "out.json") }));
  const cwd = path.join(input.root, input.invocation.cwd);
  if (!existsSync(cwd)) {
    rmSync(dir, { recursive: true, force: true });
    return Promise.reject(new Error(`lint folder ${input.invocation.cwd} does not exist`));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings=ExperimentalWarning", workerPath(), inFile], {
      cwd,
      env: workerEnv(input.invocation),
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-8000);
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true });
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      try {
        const outFile = path.join(dir, "out.json");
        if (!existsSync(outFile)) {
          const how = timedOut ? `timed out after ${Math.round(timeoutMs / 60_000)} min` : signal ? `was killed (${signal})` : `exited ${code}`;
          // The worker prints "worker crashed: <message>\n<stack>": keep the message, not node:internal frames.
          const crash = /worker crashed: (.*)/.exec(stderr)?.[1];
          const tail = (crash ?? stderr.trim().split("\n").slice(-4).join(" ")).split(input.root).join("<root>").slice(-600);
          reject(new Error(`lint process ${how}${tail ? `: ${tail}` : ""}`));
          return;
        }
        resolve(JSON.parse(readFileSync(outFile, "utf8")) as WorkerOutput);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}

/** ESLINT_USE_FLAT_CONFIG set for the whole job in a GitHub workflow. */
export function workflowFlatEnv(root: string): string | undefined {
  const dir = path.join(root, ".github", "workflows");
  if (!existsSync(dir)) return undefined;
  for (const name of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const text = readFileSync(path.join(dir, name), "utf8")
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    const m = /ESLINT_USE_FLAT_CONFIG\s*[:=]\s*["']?(true|false)/.exec(text);
    if (m) return m[1];
  }
  return undefined;
}

export interface CollectOptions {
  root: string;
  label: string;
  engine: string;
  /** Override the detected units (same command line for one cwd). */
  units?: Invocation[];
  timeoutMs?: number;
}

export async function collect(options: CollectOptions): Promise<Snapshot> {
  const root = path.resolve(options.root);
  const candidates = candidateFiles(root);
  const flatEnv = workflowFlatEnv(root);
  const units = (options.units ?? detectUnits(root)).map((u) =>
    u.useFlatConfigEnv === undefined && flatEnv !== undefined ? { ...u, useFlatConfigEnv: flatEnv } : u,
  );
  // A file belongs to the deepest unit that contains it.
  const owner = (file: string): string => {
    let best = "";
    let found: string | null = null;
    for (const u of units) {
      const prefix = u.cwd === "." ? "" : `${u.cwd}/`;
      if (file.startsWith(prefix) && prefix.length >= best.length) {
        best = prefix;
        found = u.cwd;
      }
    }
    return found ?? "";
  };

  const snapshot: Snapshot = {
    tool: "eslint10-parity",
    schema: 1,
    label: options.label,
    // Shown in reports: relative to where the tool was run, never the machine layout.
    root: path.relative(process.cwd(), root).split(path.sep).join("/") || ".",
    eslint: { version: "", path: "" },
    packages: {},
    units: [],
    files: {},
    configs: {},
    ruleDefaults: {},
  };
  for (const name of TRACKED_PACKAGES) {
    const v = resolvedVersion(name, root, root);
    if (v) snapshot.packages[name] = v;
  }

  for (const unit of units) {
    const unitDir = path.join(root, unit.cwd);
    const mine = candidates.filter((f) => owner(f) === unit.cwd);
    let out: WorkerOutput;
    try {
      const eslintDir = resolveEngine(options.engine, unitDir, root);
      out = await runWorker({ root, eslintDir, invocation: unit, candidates: mine, outFile: "" }, options.timeoutMs ?? 15 * 60_000);
      const inRepo = eslintDir.startsWith(root + path.sep);
      snapshot.eslint = { version: out.eslintVersion, path: inRepo ? path.relative(root, eslintDir).split(path.sep).join("/") : `pinned ${path.basename(path.dirname(path.dirname(eslintDir)))}` };
    } catch (err) {
      // One unit that cannot run (no install, OOM, timeout) is a crashed unit, not a crashed comparison.
      out = failedUnit(unit, mine, err instanceof Error ? err.message : String(err));
    }
    snapshot.units.push(out.unit);
    for (const [file, record] of Object.entries(out.files)) {
      // Keep the first linted record if two units reach the same file.
      if (!snapshot.files[file] || (snapshot.files[file].status !== "linted" && record.status === "linted")) {
        snapshot.files[file] = record;
      }
    }
    Object.assign(snapshot.configs, out.configs);
    Object.assign(snapshot.ruleDefaults, out.ruleDefaults);
  }
  // Workspace mode: files no unit reaches still get a record, so both sides list the same files.
  for (const file of candidates) {
    snapshot.files[file] ??= { status: "outside", unit: "", reason: "not inside any lint unit" };
  }
  return snapshot;
}

function failedUnit(invocation: Invocation, candidates: string[], message: string): WorkerOutput {
  const files: WorkerOutput["files"] = {};
  for (const file of candidates) files[file] = { status: "fatal", unit: invocation.cwd, reason: message };
  return {
    eslintVersion: "",
    unit: { invocation, mode: null, fatal: { message }, exitCode: 2, errorCount: 0, warningCount: 0, processWarnings: [] },
    files,
    configs: {},
    ruleDefaults: {},
  };
}
