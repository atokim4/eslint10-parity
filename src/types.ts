/** Shared data model: what one ESLint run over one checkout looked like. */

export type ConfigMode = "flat" | "eslintrc";

/** A rule as it is effectively configured for one file. */
export interface NormalRule {
  /** 0 off, 1 warn, 2 error. */
  severity: 0 | 1 | 2;
  /** Options after merging the rule's `meta.defaultOptions` (when known). */
  options: unknown[];
}

export type GlobalAccess = "readonly" | "writable" | "off";

/**
 * A resolved config, reduced to the parts that decide what ESLint reports,
 * in one shape for both eslintrc and flat configs.
 */
export interface NormalConfig {
  rules: Record<string, NormalRule>;
  /** Plugin namespaces, sorted ("react", "@typescript-eslint"). The core "@" namespace is left out. */
  plugins: string[];
  /** Parser package or meta name ("espree", "@typescript-eslint/parser", "vue-eslint-parser"). */
  parser: string;
  /** Flat config `language` ("js/js" when unset). */
  language: string;
  /** null = none; undefined = unknown (eslintrc does not expose it). */
  processor?: string | null;
  ecmaVersion: string;
  sourceType: string;
  globals: Record<string, GlobalAccess>;
  /** Globals coming from env names that could not be expanded (plugin envs without a loadable plugin). */
  unresolvedEnvs: string[];
  parserOptions: unknown;
  settings: unknown;
  reportUnusedDisableDirectives: 0 | 1 | 2;
}

export interface LintMessage {
  ruleId: string | null;
  severity: 1 | 2;
  line: number;
  column: number;
  message: string;
  fatal?: boolean;
}

/**
 * linted: ESLint linted it. ignored: an ignore pattern matched. unmatched: in
 * scope but no config/extension picks it up. outside: the lint command's
 * patterns do not reach it. fatal: the run crashed before linting.
 */
export type FileStatus = "linted" | "ignored" | "unmatched" | "outside" | "fatal";

export interface FileRecord {
  status: FileStatus;
  /** Workspace unit (repo-relative cwd) that produced this record. */
  unit: string;
  /** Config file that applies (repo-relative), null when none applies. */
  configFile?: string | null;
  /** Key into Snapshot.configs. */
  config?: string;
  /** Why a file is not linted, in ESLint's own words when it gives them. */
  reason?: string;
  messages?: LintMessage[];
}

/** How ESLint was invoked for one unit, as CI would do it. */
export interface Invocation {
  /** Repo-relative working directory ("." for the root). */
  cwd: string;
  /** Arguments after `eslint`, as CI passes them (used to check the CLI accepts them). */
  args?: string[];
  patterns: string[];
  errorOnUnmatchedPattern?: boolean;
  extensions?: string[];
  configFile?: string;
  ignorePath?: string;
  noConfigLookup?: boolean;
  maxWarnings?: number;
  /** Feature flags passed with --flag or ESLINT_FLAGS. */
  flags: string[];
  /** NODE_OPTIONS for the lint process (from the script's env prefix or node flags). */
  nodeOptions?: string;
  /** ESLINT_USE_FLAT_CONFIG value from the script, if set. */
  useFlatConfigEnv?: string;
  /** Where the invocation came from ("package.json scripts.lint", "default", "--args"). */
  source: string;
  /** The raw command line, when it came from a script. */
  command?: string;
}

export interface UnitResult {
  invocation: Invocation;
  mode: ConfigMode | null;
  fatal?: { message: string };
  exitCode: 0 | 1 | 2;
  errorCount: number;
  warningCount: number;
  /** Node process warnings ESLint emitted (for example ESLintIgnoreWarning). */
  processWarnings: string[];
}

export interface Snapshot {
  tool: "eslint10-parity";
  schema: 1;
  label: string;
  /** Checkout path relative to where the tool ran. */
  root: string;
  /** eslint install relative to the checkout, or "pinned v10". */
  eslint: { version: string; path: string };
  /** Versions of packages that change behaviour, resolved from the checkout. */
  packages: Record<string, string>;
  units: UnitResult[];
  files: Record<string, FileRecord>;
  configs: Record<string, NormalConfig>;
  /** Rule meta.defaultOptions seen on this side (rule id -> defaults). */
  ruleDefaults: Record<string, unknown[]>;
}

/** Input to the worker process (one unit). */
export interface WorkerInput {
  root: string;
  eslintDir: string;
  invocation: Invocation;
  /** Repo-relative candidate files that live under the unit's cwd. */
  candidates: string[];
  outFile: string;
}

export interface WorkerOutput {
  eslintVersion: string;
  unit: UnitResult;
  files: Record<string, FileRecord>;
  configs: Record<string, NormalConfig>;
  ruleDefaults: Record<string, unknown[]>;
}
