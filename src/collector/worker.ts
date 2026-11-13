/**
 * Child process: loads ONE ESLint install, lints ONE unit (a cwd + command
 * line) the way CI would, and writes per-file coverage, resolved config and
 * findings to a JSON file. Running each side in its own process keeps
 * ESLint 9 and 10 (and their plugin caches) apart.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normaliseEslintrc, normaliseFlat, stableStringify, toPlain, type NormaliseContext } from "../normalise.js";
import type {
  ConfigMode,
  FileRecord,
  LintMessage,
  NormalConfig,
  UnitResult,
  WorkerInput,
  WorkerOutput,
} from "../types.js";
import { eslintrcChain, inPatternScope, legacyPluginPackage } from "./paths.js";

type Dict = Record<string, unknown>;

interface LintResultLike {
  filePath: string;
  messages: Array<Dict>;
  errorCount: number;
  warningCount: number;
  fatalErrorCount?: number;
}

interface ESLintLike {
  lintFiles(patterns: string[]): Promise<LintResultLike[]>;
  lintText(code: string, options: { filePath: string; warnIgnored: boolean }): Promise<LintResultLike[]>;
  calculateConfigForFile(filePath: string): Promise<Dict | undefined>;
  isPathIgnored(filePath: string): Promise<boolean>;
  findConfigFile?(filePath?: string): Promise<string | undefined>;
}

type ESLintCtor = new (options: Dict) => ESLintLike;

const IGNORED_MESSAGE = /^File ignored\b/;

function readJson(file: string): Dict {
  return JSON.parse(readFileSync(file, "utf8")) as Dict;
}

function toMessage(m: Dict): LintMessage {
  const msg: LintMessage = {
    ruleId: typeof m.ruleId === "string" ? m.ruleId : null,
    severity: m.severity === 2 ? 2 : 1,
    line: typeof m.line === "number" ? m.line : 0,
    column: typeof m.column === "number" ? m.column : 0,
    message: String(m.message ?? ""),
  };
  if (m.fatal) msg.fatal = true;
  return msg;
}

/** Only "File ignored ..." warnings: ESLint was handed the file but did not lint it. */
function isIgnoredResult(r: LintResultLike): boolean {
  return r.messages.length === 1 && r.messages[0]?.ruleId == null && IGNORED_MESSAGE.test(String(r.messages[0]?.message));
}

function errorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.split("\n").filter(Boolean).slice(0, 6).join("\n");
}

async function loadEslint(eslintDir: string) {
  const pkg = readJson(path.join(eslintDir, "package.json"));
  const version = String(pkg.version);
  const major = Number(version.split(".")[0]);
  const require = createRequire(path.join(eslintDir, "package.json"));
  const exportsField = pkg.exports as Dict | undefined;
  const dot = exportsField?.["."];
  const mainRel =
    typeof dot === "string" ? dot : typeof (dot as Dict | undefined)?.default === "string" ? String((dot as Dict).default) : String(pkg.main ?? "lib/api.js");
  const api = (await import(pathToFileURL(path.join(eslintDir, mainRel)).href)) as Dict;
  const mod = ((api.default as Dict | undefined) ?? api) as Dict;
  let unsupported: Dict = {};
  try {
    unsupported = require(path.join(eslintDir, "lib/unsupported-api.js")) as Dict;
  } catch {
    // Very old installs; built-in rule defaults just stay unknown.
  }
  let optionsFactory: ((flat: boolean) => { parse(args: string[]): unknown }) | undefined;
  try {
    // 8.23+ exports a factory (flat or eslintrc options); older 8.x exports one eslintrc optionator.
    const options = require(path.join(eslintDir, "lib/options.js")) as unknown;
    if (typeof options === "function") optionsFactory = options as typeof optionsFactory;
    else if (typeof (options as Dict | null)?.parse === "function") optionsFactory = () => options as { parse(args: string[]): unknown };
  } catch {
    optionsFactory = undefined;
  }
  let translateOptions: ((cli: unknown, configType: string) => Promise<Dict>) | undefined;
  try {
    // The CLI's own argv -> ESLint options mapping (9.x and 10.x): --ext, --rule, --ignore-pattern, --quiet...
    translateOptions = require(path.join(eslintDir, "lib/shared/translate-cli-options.js")) as typeof translateOptions;
  } catch {
    translateOptions = undefined;
  }
  let environments: Map<string, Dict> | undefined;
  try {
    const eslintrc = require("@eslint/eslintrc") as Dict;
    environments = (eslintrc.Legacy as Dict | undefined)?.environments as Map<string, Dict> | undefined;
  } catch {
    environments = undefined;
  }
  return { version, major, mod, unsupported, optionsFactory, translateOptions, environments };
}

/** ESLint 8 has no shared translate-cli-options: map the options this tool parses itself. */
function manualOptions(mode: ConfigMode, major: number, cwd: string, invocation: WorkerInput["invocation"]): Dict {
  const options: Dict = { cwd, errorOnUnmatchedPattern: invocation.errorOnUnmatchedPattern !== false };
  if (mode === "flat") {
    if (invocation.configFile) options.overrideConfigFile = invocation.configFile;
    else if (invocation.noConfigLookup) options.overrideConfigFile = true;
    if (invocation.flags.length && major >= 9) options.flags = invocation.flags;
  } else {
    if (invocation.extensions?.length) options.extensions = invocation.extensions;
    if (invocation.configFile) options.overrideConfigFile = invocation.configFile;
    if (invocation.ignorePath) options.ignorePath = invocation.ignorePath;
    if (invocation.noConfigLookup) options.useEslintrc = false;
  }
  return options;
}

/**
 * Absolute paths make two checkouts differ and leak the machine layout into
 * reports: the checkout becomes <root>, the ESLint install <eslint>, home ~.
 */
export function scrubPaths(json: string, root: string, eslintDir: string): string {
  const esc = (p: string) => JSON.stringify(p).slice(1, -1);
  const pairs: Array<[string, string]> = [
    [root, "<root>"],
    [path.dirname(eslintDir), "<eslint>"],
    [homedir(), "~"],
  ];
  let out = json;
  for (const [from, to] of pairs) if (from.length > 1) out = out.split(esc(from)).join(to);
  return out;
}

function decideMode(major: number, input: WorkerInput): ConfigMode {
  const env = input.invocation.useFlatConfigEnv;
  if (major >= 10) return "flat";
  if (major === 9) return env === "false" ? "eslintrc" : "flat";
  if (env === "true") return "flat";
  if (env === "false") return "eslintrc";
  const cwd = path.join(input.root, input.invocation.cwd);
  return ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs"].some((f) => existsSync(path.join(cwd, f)))
    ? "flat"
    : "eslintrc";
}

async function main(): Promise<void> {
  const input = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8")) as WorkerInput;
  const { root, invocation } = input;
  const cwd = path.resolve(root, invocation.cwd);
  process.chdir(cwd);

  const processWarnings: string[] = [];
  process.on("warning", (w) => {
    if (w.name !== "ExperimentalWarning") processWarnings.push(`${w.name}: ${w.message}`);
  });

  const engine = await loadEslint(input.eslintDir);
  const mode = decideMode(engine.major, input);
  const rel = (abs: string) => path.relative(root, abs).split(path.sep).join("/");
  const files: Record<string, FileRecord> = {};
  const configs: Record<string, NormalConfig> = {};
  const seenDefaults: Record<string, unknown[]> = {};
  const unitKey = invocation.cwd;

  const unit: UnitResult = {
    invocation,
    mode,
    exitCode: 0,
    errorCount: 0,
    warningCount: 0,
    processWarnings,
  };

  const finish = () => {
    const out: WorkerOutput = { eslintVersion: engine.version, unit, files, configs, ruleDefaults: seenDefaults };
    writeFileSync(input.outFile, scrubPaths(JSON.stringify(out), root, input.eslintDir));
  };

  const markAll = (status: "fatal", reason: string) => {
    for (const file of input.candidates) files[file] = { status, unit: unitKey, reason };
  };

  // 1. The command line itself: ESLint 10 rejects eslintrc-only flags before linting anything.
  let cliOptions: Dict | undefined;
  if (engine.optionsFactory && invocation.args) {
    try {
      cliOptions = engine.optionsFactory(mode === "flat").parse(["node", "eslint", ...invocation.args]) as Dict;
    } catch (err) {
      unit.fatal = { message: `CLI rejects the lint command: ${errorText(err)}` };
      unit.exitCode = 2;
      markAll("fatal", unit.fatal.message);
      return finish();
    }
  }

  // ESLint's own parse of the command line knows which options take a value; fall back to ours.
  const parsed = Array.isArray(cliOptions?._) ? (cliOptions._ as unknown[]).map(String) : [];
  const patterns = parsed.length ? parsed : invocation.patterns;

  // Bulk suppressions are applied by the CLI, not by the ESLint class this tool drives.
  const suppressions = invocation.args?.find((a, i, all) => all[i - 1] === "--suppressions-location" || a.startsWith("--suppressions-location="));
  const suppressionsFile = suppressions?.replace(/^--suppressions-location=/, "") ?? "eslint-suppressions.json";
  if (existsSync(path.resolve(cwd, suppressionsFile))) {
    processWarnings.push(`${suppressionsFile} exists: bulk suppressions are not applied here, so counts and the exit code include suppressed violations.`);
  }

  // 2. Build the ESLint instance the CLI would build.
  let eslint: ESLintLike;
  try {
    const loadESLint = engine.mod.loadESLint as ((o: Dict) => Promise<ESLintCtor>) | undefined;
    const Ctor: ESLintCtor = loadESLint
      ? await loadESLint({ useFlatConfig: mode === "flat" })
      : (engine.mod.ESLint as ESLintCtor);
    let options: Dict;
    if (cliOptions && engine.translateOptions) {
      options = await engine.translateOptions(cliOptions, mode);
      // Lint only: never write fixes or a cache into the checkout.
      Object.assign(options, { cwd, fix: false, cache: false });
      // ESLINT_FLAGS from the script's env prefix: the CLI reads it from the environment, which the worker clears.
      if (mode === "flat" && engine.major >= 9 && invocation.flags.length) {
        options.flags = [...new Set([...((options.flags as string[] | undefined) ?? []), ...invocation.flags])];
      }
    } else {
      options = manualOptions(mode, engine.major, cwd, invocation);
    }
    eslint = new Ctor(options);
  } catch (err) {
    unit.fatal = { message: errorText(err) };
    unit.exitCode = 2;
    markAll("fatal", unit.fatal.message);
    return finish();
  }

  // 3. Lint like CI does.
  let results: LintResultLike[];
  try {
    results = await eslint.lintFiles(patterns);
  } catch (err) {
    unit.fatal = { message: errorText(err) };
    unit.exitCode = 2;
    markAll("fatal", unit.fatal.message);
    return finish();
  }

  const pluginRequire = createRequire(path.join(cwd, "__eslint10_parity__.js"));
  const legacyPlugins = new Map<string, Dict | null>();
  const legacyPlugin = (name: string): Dict | null => {
    if (!legacyPlugins.has(name)) {
      let plugin: Dict | null = null;
      try {
        plugin = pluginRequire(legacyPluginPackage(name)) as Dict;
      } catch {
        plugin = null;
      }
      legacyPlugins.set(name, plugin);
    }
    return legacyPlugins.get(name) ?? null;
  };
  const builtinRules = engine.unsupported.builtinRules as Map<string, Dict> | undefined;

  const ruleDefaults: NormaliseContext["ruleDefaults"] = (ruleId, config) => {
    let rule: Dict | undefined;
    const slash = ruleId.lastIndexOf("/");
    if (slash === -1) rule = builtinRules?.get(ruleId);
    else {
      const ns = ruleId.slice(0, slash);
      const name = ruleId.slice(slash + 1);
      const plugins = config.plugins;
      const plugin =
        plugins && !Array.isArray(plugins) && typeof plugins === "object"
          ? ((plugins as Dict)[ns] as Dict | undefined)
          : (legacyPlugin(ns) ?? undefined);
      rule = (plugin?.rules as Dict | undefined)?.[name] as Dict | undefined;
    }
    const defaults = (rule?.meta as Dict | undefined)?.defaultOptions;
    if (!Array.isArray(defaults)) return undefined;
    seenDefaults[ruleId] ??= toPlain(defaults, root) as unknown[];
    return defaults as unknown[];
  };

  const ctx: NormaliseContext = {
    root,
    ruleDefaults,
    envGlobals: (env) => {
      const slash = env.indexOf("/");
      if (slash === -1) return engine.environments?.get(env)?.globals as Dict | undefined;
      const plugin = legacyPlugin(env.slice(0, slash));
      const envs = plugin?.environments as Dict | undefined;
      return (envs?.[env.slice(slash + 1)] as Dict | undefined)?.globals as Dict | undefined;
    },
    envEcmaVersion: (env) => {
      const v = (engine.environments?.get(env)?.parserOptions as Dict | undefined)?.ecmaVersion;
      return typeof v === "number" ? v : undefined;
    },
  };

  const configKey = (normal: NormalConfig): string => {
    const key = createHash("sha1").update(stableStringify(normal)).digest("hex").slice(0, 12);
    configs[key] ??= normal;
    return key;
  };

  const perFileLookup = mode === "flat" && (engine.major >= 10 || invocation.flags.includes("v10_config_lookup_from_file"));
  const configFileFor = async (abs: string): Promise<string | null> => {
    if (mode === "eslintrc") {
      const chain = eslintrcChain(abs, cwd, root);
      const all = invocation.configFile ? [rel(path.resolve(cwd, invocation.configFile)), ...chain] : chain;
      return all.length ? all.join(" + ") : null;
    }
    if (invocation.configFile) return rel(path.resolve(cwd, invocation.configFile));
    if (invocation.noConfigLookup) return null;
    const found = await eslint.findConfigFile?.(perFileLookup ? abs : undefined);
    return found ? rel(found) : null;
  };

  // 4. Every linted file: findings + resolved config.
  const linted = new Set<string>();
  for (const r of results) {
    const file = rel(r.filePath);
    if (file.startsWith("..")) continue;
    if (isIgnoredResult(r)) continue;
    linted.add(file);
    unit.errorCount += r.errorCount;
    unit.warningCount += r.warningCount;
    const record: FileRecord = {
      status: "linted",
      unit: unitKey,
      messages: r.messages.map(toMessage),
      configFile: await configFileFor(r.filePath),
    };
    try {
      const raw = await eslint.calculateConfigForFile(r.filePath);
      if (raw) record.config = configKey(mode === "flat" ? normaliseFlat(raw, ctx) : normaliseEslintrc(raw, ctx));
    } catch (err) {
      record.reason = `calculateConfigForFile failed: ${errorText(err)}`;
    }
    files[file] = record;
  }

  // 5. Every other candidate: why it was not linted.
  for (const file of input.candidates) {
    if (linted.has(file)) continue;
    const abs = path.join(root, file);
    if (!inPatternScope(abs, cwd, patterns)) {
      files[file] = { status: "outside", unit: unitKey, reason: "not covered by the lint command's file patterns" };
      continue;
    }
    const record: FileRecord = { status: "unmatched", unit: unitKey };
    try {
      if (mode === "eslintrc") {
        const ignored = await eslint.isPathIgnored(abs);
        record.status = ignored ? "ignored" : "unmatched";
        const dotfile = file.split("/").some((part) => part.startsWith("."));
        record.reason = !ignored
          ? "extension not linted (--ext) and no overrides[].files entry matches"
          : dotfile
            ? "eslintrc ignores dotfiles and dot-folders by default (or an ignore pattern matched)"
            : "matched by an ignore pattern (.eslintignore / ignorePatterns)";
      } else {
        const [res] = await eslint.lintText("", { filePath: abs, warnIgnored: true });
        const text = String(res?.messages[0]?.message ?? "");
        if (/matching ignore pattern/.test(text)) {
          record.status = "ignored";
          record.reason = "matched by an ignores pattern";
        } else if (/no matching configuration/.test(text)) {
          record.reason = "no config object's `files` matches this file";
        } else if (/outside of base path/.test(text)) {
          record.reason = "outside the config file's base path";
        } else {
          record.reason = text || "not linted by the lint command";
        }
      }
    } catch (err) {
      record.reason = /could not find config file/i.test(errorText(err))
        ? "no eslint.config.* found from this file's directory"
        : errorText(err);
    }
    if (mode === "flat") record.configFile = await configFileFor(abs).catch(() => null);
    files[file] = record;
  }

  const maxWarnings = invocation.maxWarnings ?? -1;
  unit.exitCode = unit.errorCount > 0 || (maxWarnings >= 0 && unit.warningCount > maxWarnings) ? 1 : 0;
  // Give pending 'warning' events (emitted on nextTick) a chance to land.
  await new Promise((resolve) => setImmediate(resolve));
  finish();
}

main().catch((err: unknown) => {
  process.stderr.write(`eslint10-parity worker crashed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(3);
});
