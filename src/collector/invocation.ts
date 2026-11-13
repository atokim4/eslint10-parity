/**
 * Works out how CI runs ESLint in a checkout: which directories ("units")
 * and with which command line, read from package.json scripts.
 */
import { existsSync, globSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Invocation } from "../types.js";
import { findEslintCommand, isAuxiliaryEslint } from "./shell.js";

export { findEslintCommand, shellWords } from "./shell.js";

const SCRIPT_PREFERENCE = ["lint:eslint", "eslint", "lint:js", "lint", "lint:ci", "test:lint"];

/** Options that take a value in either config system (so the value is not taken as a pattern). */
const VALUE_OPTIONS = new Set([
  "-c", "--config", "--ext", "--ignore-path", "--ignore-pattern", "-f", "--format", "-o", "--output-file",
  "--max-warnings", "--parser", "--parser-options", "--env", "--global", "--plugin", "--rule", "--rulesdir",
  "--resolve-plugins-relative-to", "--cache-location", "--cache-strategy", "--fix-type", "--flag",
  "--report-unused-disable-directives-severity", "--report-unused-inline-configs", "--concurrency",
  "--suppressions-location", "--cache-file", "--stdin-filename", "--suppress-rule", "--print-config",
]);

export function parseEslintArgs(
  args: string[],
  base: { cwd: string; source: string; command?: string; env?: Record<string, string>; nodeFlags?: string[] },
): Invocation {
  const inv: Invocation = { cwd: base.cwd, args, patterns: [], flags: [], source: base.source };
  if (base.command) inv.command = base.command;
  // Memory flags matter for big repos: `node --max-old-space-size=8192 eslint` or NODE_OPTIONS=... in the script.
  const nodeOptions = [base.env?.NODE_OPTIONS, ...(base.nodeFlags ?? [])].filter(Boolean).join(" ");
  if (nodeOptions) inv.nodeOptions = nodeOptions;
  const env = base.env ?? {};
  if (env.ESLINT_USE_FLAT_CONFIG !== undefined) inv.useFlatConfigEnv = env.ESLINT_USE_FLAT_CONFIG;
  if (env.ESLINT_FLAGS) inv.flags.push(...env.ESLINT_FLAGS.split(",").map((f) => f.trim()).filter(Boolean));
  for (let i = 0; i < args.length; i++) {
    const raw = args[i] as string;
    const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
    const name = eq > 0 ? raw.slice(0, eq) : raw;
    const takesValue = VALUE_OPTIONS.has(name);
    const value = eq > 0 ? raw.slice(eq + 1) : takesValue ? args[++i] : undefined;
    switch (name) {
      case "-c":
      case "--config":
        inv.configFile = value;
        break;
      case "--ext":
        inv.extensions = [
          ...(inv.extensions ?? []),
          ...String(value).split(",").map((e) => e.trim()).filter(Boolean).map((e) => (e.startsWith(".") ? e : `.${e}`)),
        ];
        break;
      case "--ignore-path":
        inv.ignorePath = value;
        break;
      case "--no-eslintrc":
      case "--no-config-lookup":
        inv.noConfigLookup = true;
        break;
      case "--max-warnings":
        inv.maxWarnings = Number(value);
        break;
      case "--flag":
        if (value) inv.flags.push(value);
        break;
      case "--no-error-on-unmatched-pattern":
        inv.errorOnUnmatchedPattern = false;
        break;
      default:
        if (!takesValue && !raw.startsWith("-")) inv.patterns.push(raw);
    }
  }
  if (inv.patterns.length === 0) inv.patterns = ["."];
  return inv;
}

function readPackage(dir: string): Record<string, unknown> | null {
  const file = path.join(dir, "package.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** First package.json script that runs eslint, by preference order. */
export function lintScript(pkg: Record<string, unknown> | null): { name: string; command: string } | null {
  const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
  const names = [...SCRIPT_PREFERENCE.filter((n) => n in scripts), ...Object.keys(scripts).filter((n) => !SCRIPT_PREFERENCE.includes(n))];
  // The lint check, not a fix or print-config helper; a fixing script only when nothing else exists.
  let fallback: { name: string; command: string } | null = null;
  for (const name of names) {
    const command = scripts[name];
    if (typeof command !== "string") continue;
    const found = findEslintCommand(command);
    if (!found) continue;
    if (!isAuxiliaryEslint(found.args)) return { name, command };
    if (!fallback && !found.args.some((a) => /^--(print-config|inspect-config|init|env-info|help|version)/.test(a))) fallback = { name, command };
  }
  return fallback;
}

/** Workspace package directories (npm/yarn `workspaces`, pnpm-workspace.yaml). */
export function workspaceDirs(root: string): string[] {
  const pkg = readPackage(root);
  let patterns: string[] = [];
  const ws = pkg?.workspaces;
  if (Array.isArray(ws)) patterns = ws.map(String);
  else if (ws && typeof ws === "object" && Array.isArray((ws as { packages?: unknown }).packages)) {
    patterns = ((ws as { packages: unknown[] }).packages).map(String);
  }
  const pnpm = path.join(root, "pnpm-workspace.yaml");
  if (existsSync(pnpm)) {
    let inPackages = false;
    for (const line of readFileSync(pnpm, "utf8").split("\n")) {
      if (/^packages\s*:/.test(line)) inPackages = true;
      else if (inPackages && /^\s*-\s*/.test(line)) {
        patterns.push(line.replace(/\s+#.*$/, "").replace(/^\s*-\s*/, "").replace(/["']/g, "").trim());
      }
      else if (inPackages && /^\S/.test(line)) inPackages = false;
    }
  }
  const expand = (pattern: string) =>
    globSync(pattern.replace(/\/$/, ""), { cwd: root }).map((m) => m.split(path.sep).join("/"));
  const excluded = new Set(patterns.filter((p) => p.startsWith("!")).flatMap((p) => expand(p.slice(1))));
  const dirs = new Set<string>();
  for (const pattern of patterns.filter((p) => p && !p.startsWith("!"))) {
    for (const rel of expand(pattern)) {
      if (!excluded.has(rel) && !rel.includes("node_modules") && existsSync(path.join(root, rel, "package.json"))) dirs.add(rel);
    }
  }
  return [...dirs].sort();
}

/**
 * The units CI lints: the root lint script if it calls eslint directly,
 * otherwise every workspace package with its own eslint script, otherwise
 * `eslint .` at the root.
 */
export function detectUnits(root: string): Invocation[] {
  const rootScript = lintScript(readPackage(root));
  if (rootScript) return [unitFromScript(root, ".", rootScript)];
  const units: Invocation[] = [];
  for (const dir of workspaceDirs(root)) {
    const script = lintScript(readPackage(path.join(root, dir)));
    if (script) units.push(unitFromScript(root, dir, script));
  }
  if (units.length) return units;
  return [{ cwd: ".", args: ["."], patterns: ["."], flags: [], source: "default (eslint .)" }];
}

function unitFromScript(_root: string, cwd: string, script: { name: string; command: string }): Invocation {
  const found = findEslintCommand(script.command);
  const label = cwd === "." ? "package.json" : `${cwd}/package.json`;
  return parseEslintArgs(found?.args ?? [], {
    cwd,
    source: `${label} scripts.${script.name}`,
    command: script.command,
    env: found?.env ?? {},
    nodeFlags: found?.nodeFlags ?? [],
  });
}
