/**
 * Turns a config returned by ESLint's calculateConfigForFile (flat or eslintrc)
 * into one comparable NormalConfig. Everything here works on plain values
 * so the diff never depends on which ESLint major produced them.
 */
import type { GlobalAccess, NormalConfig, NormalRule } from "./types.js";

type Dict = Record<string, unknown>;

const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);

export function normaliseSeverity(value: unknown): 0 | 1 | 2 {
  // eslintrc lowercases string severities, so "Error" is valid there.
  const v = typeof value === "string" ? value.toLowerCase() : value;
  if (v === 2 || v === "error") return 2;
  if (v === 1 || v === "warn") return 1;
  return 0;
}

/** ESLint's own deepMergeArrays (lib/shared/deep-merge-arrays.js), used for rule defaultOptions. */
export function mergeRuleOptions(defaults: unknown[] | undefined, options: unknown[]): unknown[] {
  if (!defaults || defaults.length === 0) return options;
  return [
    ...defaults.map((value, i) => mergeObjects(value, i < options.length ? options[i] : undefined)),
    ...options.slice(defaults.length),
  ];
}

function mergeObjects(first: unknown, second: unknown): unknown {
  if (second === undefined) return first;
  if (!isDict(first) || !isDict(second)) return second;
  const result: Dict = { ...first, ...second };
  for (const key of Object.keys(second)) {
    if (Object.prototype.propertyIsEnumerable.call(first, key)) result[key] = mergeObjects(first[key], second[key]);
  }
  return result;
}

export function normaliseRule(entry: unknown, defaults?: unknown[], root?: string): NormalRule {
  const list = Array.isArray(entry) ? entry : [entry];
  const severity = normaliseSeverity(list[0]);
  return { severity, options: toPlain(mergeRuleOptions(defaults, list.slice(1)), root) as unknown[] };
}

export function normaliseAccess(value: unknown): GlobalAccess {
  if (value === "off") return "off";
  if (value === true || value === "writable" || value === "writeable") return "writable";
  return "readonly";
}

/**
 * JSON-safe copy with sorted keys. Functions and class instances become a
 * short tag, absolute paths under `root` become "<root>/..." so two checkouts
 * in different folders compare equal.
 */
export function toPlain(value: unknown, root?: string, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    if (root && (value === root || value.startsWith(root + "/"))) return "<root>" + value.slice(root.length);
    return value;
  }
  if (typeof value === "function") return "[function]";
  if (typeof value === "bigint" || typeof value === "symbol") return String(value);
  if (value instanceof RegExp) return value.toString();
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((v) => toPlain(v, root, seen));
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return `[${proto?.constructor?.name ?? "object"}]`;
    const out: Dict = {};
    for (const key of Object.keys(value).sort()) out[key] = toPlain((value as Dict)[key], root, seen);
    return out;
  } finally {
    seen.delete(value);
  }
}

/** ".../node_modules/@typescript-eslint/parser/dist/index.js" -> "@typescript-eslint/parser". */
export function packageFromPath(file: string): string {
  const parts = file.split(/[\\/]/);
  const at = parts.lastIndexOf("node_modules");
  if (at === -1 || at + 1 >= parts.length) return file;
  const first = parts[at + 1] ?? file;
  return first.startsWith("@") && parts[at + 2] ? `${first}/${parts[at + 2]}` : first;
}

/** Year form for ecmaVersion so 6 and 2015 compare equal. */
export function normaliseEcmaVersion(value: unknown): string {
  if (value === undefined || value === null) return "unset";
  if (value === "latest") return "latest";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(n >= 2015 ? n : n >= 6 ? n + 2009 : n);
}

/** Helpers the caller supplies; they need the live ESLint install. */
export interface NormaliseContext {
  root: string;
  ruleDefaults: (ruleId: string, config: Dict) => unknown[] | undefined;
  /** Globals of an eslintrc env name, undefined when the env can't be resolved. */
  envGlobals: (env: string) => Record<string, unknown> | undefined;
  /** ecmaVersion implied by an eslintrc env ("es2021" -> 12), if any. */
  envEcmaVersion: (env: string) => number | undefined;
}

/**
 * Parsers name themselves differently in eslintrc (package path) and flat
 * (meta.name): "@typescript-eslint/parser" vs "typescript-eslint/parser".
 * Compare without the leading "@".
 */
export function canonicalParser(name: string): string {
  return name.replace(/^@/, "");
}

function namedThing(value: unknown, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value.includes("node_modules") ? packageFromPath(value) : value;
  if (isDict(value) || typeof value === "function") {
    const meta = (value as Dict).meta;
    if (isDict(meta) && typeof meta.name === "string") return meta.name;
    if (typeof (value as Dict).name === "string" && (value as Dict).name) return String((value as Dict).name);
  }
  return "unknown";
}

function sortedRules(rules: Record<string, NormalRule>): Record<string, NormalRule> {
  return Object.fromEntries(Object.entries(rules).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function sortedGlobals(globals: Record<string, GlobalAccess>): Record<string, GlobalAccess> {
  return Object.fromEntries(Object.entries(globals).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function readRules(raw: unknown, config: Dict, ctx: NormaliseContext): Record<string, NormalRule> {
  const rules: Record<string, NormalRule> = {};
  if (!isDict(raw)) return rules;
  for (const [id, entry] of Object.entries(raw)) rules[id] = normaliseRule(entry, ctx.ruleDefaults(id, config), ctx.root);
  return sortedRules(rules);
}

function stripLanguageKeys(parserOptions: unknown, root: string): unknown {
  if (!isDict(parserOptions)) return {};
  const { ecmaVersion: _e, sourceType: _s, ...rest } = parserOptions;
  return toPlain(rest, root);
}

export function normaliseFlat(config: Dict, ctx: NormaliseContext): NormalConfig {
  const lo = isDict(config.languageOptions) ? config.languageOptions : {};
  const globals: Record<string, GlobalAccess> = {};
  if (isDict(lo.globals)) for (const [k, v] of Object.entries(lo.globals)) globals[k] = normaliseAccess(v);
  const plugins = isDict(config.plugins) ? Object.keys(config.plugins).filter((p) => p !== "@").sort() : [];
  const linterOptions = isDict(config.linterOptions) ? config.linterOptions : {};
  return {
    rules: readRules(config.rules, config, ctx),
    plugins,
    parser: canonicalParser(namedThing(lo.parser, "espree")),
    language: typeof config.language === "string" ? config.language : "js/js",
    processor: config.processor ? namedThing(config.processor, "unknown") : null,
    ecmaVersion: normaliseEcmaVersion(lo.ecmaVersion),
    sourceType: typeof lo.sourceType === "string" ? lo.sourceType : "unset",
    globals: sortedGlobals(globals),
    unresolvedEnvs: [],
    parserOptions: stripLanguageKeys(lo.parserOptions, ctx.root),
    settings: toPlain(config.settings ?? {}, ctx.root),
    reportUnusedDisableDirectives: normaliseSeverity(
      linterOptions.reportUnusedDisableDirectives === true ? "warn" : linterOptions.reportUnusedDisableDirectives,
    ),
  };
}

/**
 * eslintrc keeps env names, a parser path and string severities. Expanding
 * envs to globals makes "env: { node: true }" comparable to
 * "languageOptions.globals: globals.node".
 */
export function normaliseEslintrc(config: Dict, ctx: NormaliseContext): NormalConfig {
  const globals: Record<string, GlobalAccess> = {};
  const unresolvedEnvs: string[] = [];
  let envEcma: number | undefined;
  const env = isDict(config.env) ? config.env : {};
  for (const [name, enabled] of Object.entries(env)) {
    if (!enabled) continue;
    // ES version envs (es6, es2021...) only add builtins, which flat config derives from ecmaVersion.
    if (!/^es\d+$/.test(name)) {
      const g = ctx.envGlobals(name);
      if (g) for (const [k, v] of Object.entries(g)) globals[k] = normaliseAccess(v);
      else unresolvedEnvs.push(name);
    }
    const ev = ctx.envEcmaVersion(name);
    if (ev !== undefined) envEcma = Math.max(envEcma ?? 0, ev);
  }
  if (isDict(config.globals)) for (const [k, v] of Object.entries(config.globals)) globals[k] = normaliseAccess(v);
  const parserOptions = isDict(config.parserOptions) ? config.parserOptions : {};
  const plugins = Array.isArray(config.plugins) ? config.plugins.map(String).sort() : [];
  return {
    rules: readRules(config.rules, config, ctx),
    plugins,
    parser: canonicalParser(namedThing(config.parser, "espree")),
    language: "js/js",
    // eslintrc's calculateConfigForFile drops `processor` (toCompatibleObjectAsConfigFileContent), so it is unknown.
    processor: undefined,
    // espree under eslintrc defaults to ES5 scripts; flat defaults to "latest" modules.
    ecmaVersion: normaliseEcmaVersion(parserOptions.ecmaVersion ?? envEcma ?? 5),
    sourceType: typeof parserOptions.sourceType === "string" ? parserOptions.sourceType : "script",
    globals: sortedGlobals(globals),
    unresolvedEnvs: unresolvedEnvs.sort(),
    parserOptions: stripLanguageKeys(parserOptions, ctx.root),
    settings: toPlain(config.settings ?? {}, ctx.root),
    // In a config file `true` means "warn" (linter.js); only the CLI flag means "error", and that is not part of the config.
    reportUnusedDisableDirectives: config.reportUnusedDisableDirectives === true ? 1 : normaliseSeverity(config.reportUnusedDisableDirectives),
  };
}

/** Stable JSON used for hashing and equality. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(toPlain(value));
}
