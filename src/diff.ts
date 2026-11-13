/**
 * Compares two Snapshots (before/after an ESLint upgrade) and explains every
 * change in coverage, resolved config and findings.
 */
import { crashHint, type CrashHint } from "./crash-hints.js";
import { mergeRuleOptions, stableStringify } from "./normalise.js";
import type { FileRecord, FileStatus, LintMessage, NormalConfig, NormalRule, Snapshot } from "./types.js";

export type Impact = "high" | "medium" | "low";

export interface SideSummary {
  label: string;
  eslintVersion: string;
  modes: string[];
  units: Array<{ cwd: string; source: string; mode: string | null; exitCode: number; fatal?: string; hint?: CrashHint; processWarnings: string[] }>;
  counts: Record<FileStatus, number>;
  errors: number;
  warnings: number;
  exitCode: number;
  configFiles: string[];
  packages: Record<string, string>;
}

export interface CoverageChange {
  file: string;
  before: FileStatus;
  after: FileStatus;
  reason: string;
  /** Findings the file had on the side where it was linted. */
  findings: number;
  configBefore: string | null;
  configAfter: string | null;
}

export interface ConfigItem {
  kind:
    | "config-file" | "rule-removed" | "rule-off" | "severity" | "options" | "rule-added" | "plugin-removed"
    | "plugin-added" | "parser" | "language" | "processor" | "ecmaVersion" | "sourceType" | "globals-added"
    | "globals-removed" | "parserOptions" | "settings" | "unused-directives";
  impact: Impact;
  text: string;
}

export interface ConfigGroup {
  impact: Impact;
  items: ConfigItem[];
  files: string[];
}

export interface FindingSample {
  file: string;
  line: number;
  column: number;
  message: string;
}

export interface FindingGroup {
  ruleId: string;
  direction: "vanished" | "appeared" | "severity";
  cause: string;
  /** true when the cause is a documented ESLint 10 behaviour change, so the change is expected. */
  expected: boolean;
  impact: Impact;
  count: number;
  files: number;
  samples: FindingSample[];
}

export interface ParityDiff {
  before: SideSummary;
  after: SideSummary;
  stoppedLinting: CoverageChange[];
  startedLinting: CoverageChange[];
  onlyBefore: string[];
  onlyAfter: string[];
  configGroups: ConfigGroup[];
  findings: FindingGroup[];
  verdict: Verdict;
}

export interface Verdict {
  /**
   * ok: same lint. changed: differences found. broken: the after run crashes.
   * inconclusive: the before run crashed or nothing was linted, so there is no baseline.
   */
  status: "ok" | "changed" | "broken" | "inconclusive";
  /** After exits like before (0/1 unchanged) while high-impact changes happened. */
  silent: boolean;
  high: number;
  medium: number;
  low: number;
  headline: string;
}

/** Rules ESLint 10 added to eslint:recommended (migrate-to-10.0.0, #19966). */
export const V10_NEW_RECOMMENDED = new Set(["no-unassigned-vars", "no-useless-assignment", "preserve-caught-error"]);

const JSX_FILE = /\.(jsx|tsx)$/;

/** JSX parsing switched on in the config (CRA-style JSX in .js files). */
function jsxEnabled(config: NormalConfig | undefined): boolean {
  const po = config?.parserOptions as { ecmaFeatures?: { jsx?: unknown } } | undefined;
  return po?.ecmaFeatures?.jsx === true;
}

function summarise(s: Snapshot): SideSummary {
  const counts: Record<FileStatus, number> = { linted: 0, ignored: 0, unmatched: 0, outside: 0, fatal: 0 };
  const configFiles = new Set<string>();
  for (const r of Object.values(s.files)) {
    counts[r.status]++;
    if (r.status === "linted" && r.configFile) configFiles.add(r.configFile);
  }
  return {
    label: s.label,
    eslintVersion: s.eslint.version,
    modes: [...new Set(s.units.map((u) => u.mode ?? "none"))],
    units: s.units.map((u) => ({
      cwd: u.invocation.cwd,
      source: u.invocation.command ? `${u.invocation.source}: ${u.invocation.command}` : u.invocation.source,
      mode: u.mode,
      exitCode: u.exitCode,
      ...(u.fatal ? { fatal: u.fatal.message } : {}),
      ...(u.fatal && crashHint(u.fatal.message) ? { hint: crashHint(u.fatal.message) } : {}),
      processWarnings: u.processWarnings,
    })),
    counts,
    errors: s.units.reduce((n, u) => n + u.errorCount, 0),
    warnings: s.units.reduce((n, u) => n + u.warningCount, 0),
    exitCode: Math.max(0, ...s.units.map((u) => u.exitCode)),
    configFiles: [...configFiles].sort(),
    packages: s.packages,
  };
}

const SEVERITY_NAME = ["off", "warn", "error"] as const;

function listNames(names: string[], max = 8): string {
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? `${shown} (+${names.length - max} more)` : shown;
}

function changedKeys(a: unknown, b: unknown): string[] {
  const ao = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
  const bo = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  return [...keys].filter((k) => stableStringify(ao[k]) !== stableStringify(bo[k])).sort();
}

/**
 * Rule options compared after filling in BOTH sides' defaultOptions, so a
 * default that ESLint 10 merely made explicit does not count as a change
 * while a changed default value does.
 */
function sameOptions(rule: string, a: NormalRule, b: NormalRule, before: Snapshot, after: Snapshot): boolean {
  const fill = (opts: unknown[]) => mergeRuleOptions(after.ruleDefaults[rule], mergeRuleOptions(before.ruleDefaults[rule], opts));
  return stableStringify(fill(a.options)) === stableStringify(fill(b.options));
}

export function compareConfigs(
  a: NormalConfig,
  b: NormalConfig,
  ruleSame: (rule: string, x: NormalRule, y: NormalRule) => boolean,
  afterMajor = 10,
  defaultsOnly?: (rule: string, x: NormalRule, y: NormalRule) => boolean,
): ConfigItem[] {
  const items: ConfigItem[] = [];
  const ruleIds = [...new Set([...Object.keys(a.rules), ...Object.keys(b.rules)])].sort();
  for (const id of ruleIds) {
    const x = a.rules[id];
    const y = b.rules[id];
    const xs = x?.severity ?? 0;
    const ys = y?.severity ?? 0;
    if (xs > 0 && !y) items.push({ kind: "rule-removed", impact: "high", text: `rule ${id} (${SEVERITY_NAME[xs]}) is no longer configured` });
    else if (xs > 0 && ys === 0) items.push({ kind: "rule-off", impact: "high", text: `rule ${id} turned off (was ${SEVERITY_NAME[xs]})` });
    else if (xs === 0 && ys > 0) {
      const recommended = V10_NEW_RECOMMENDED.has(id) && afterMajor >= 10;
      items.push({
        kind: "rule-added",
        impact: recommended ? "low" : "medium",
        text: `rule ${id} now ${SEVERITY_NAME[ys]}${recommended ? " (added to eslint:recommended in ESLint 10)" : ""}`,
      });
    }
    else if (xs !== ys) {
      items.push({
        kind: "severity",
        impact: ys < xs ? "high" : "medium",
        text: `rule ${id} severity ${SEVERITY_NAME[xs]} -> ${SEVERITY_NAME[ys]}`,
      });
    }
    if (x && y && xs > 0 && ys > 0 && !ruleSame(id, x, y)) {
      const defaultChange = defaultsOnly?.(id, x, y) ?? false;
      items.push({
        kind: "options",
        impact: defaultChange ? "low" : "medium",
        text: `rule ${id} options ${JSON.stringify(x.options)} -> ${JSON.stringify(y.options)}${defaultChange ? " (the rule's default options changed)" : ""}`,
      });
    }
  }
  const lostPlugins = a.plugins.filter((p) => !b.plugins.includes(p));
  const newPlugins = b.plugins.filter((p) => !a.plugins.includes(p));
  if (lostPlugins.length) items.push({ kind: "plugin-removed", impact: "high", text: `plugins no longer loaded: ${lostPlugins.join(", ")}` });
  if (newPlugins.length) items.push({ kind: "plugin-added", impact: "low", text: `plugins added: ${newPlugins.join(", ")}` });
  if (a.parser !== b.parser) items.push({ kind: "parser", impact: "high", text: `parser ${a.parser} -> ${b.parser}` });
  if (a.language !== b.language) items.push({ kind: "language", impact: "high", text: `language ${a.language} -> ${b.language}` });
  if (a.processor !== undefined && b.processor !== undefined && a.processor !== b.processor) {
    items.push({ kind: "processor", impact: "high", text: `processor ${a.processor ?? "none"} -> ${b.processor ?? "none"}` });
  }
  if (a.ecmaVersion !== b.ecmaVersion) items.push({ kind: "ecmaVersion", impact: "low", text: `ecmaVersion ${a.ecmaVersion} -> ${b.ecmaVersion}` });
  if (a.sourceType !== b.sourceType) items.push({ kind: "sourceType", impact: "medium", text: `sourceType ${a.sourceType} -> ${b.sourceType}` });
  const added = Object.keys(b.globals).filter((g) => !(g in a.globals) && b.globals[g] !== "off");
  const removed = Object.keys(a.globals).filter((g) => a.globals[g] !== "off" && (!(g in b.globals) || b.globals[g] === "off"));
  if (added.length) {
    // Low: a newer `globals` package adds hundreds of names; real no-undef effects show up in the findings diff.
    items.push({ kind: "globals-added", impact: "low", text: `${added.length} globals added (can hide no-undef): ${listNames(added)}` });
  }
  if (removed.length) {
    items.push({ kind: "globals-removed", impact: "low", text: `${removed.length} globals removed: ${listNames(removed)}` });
  }
  const po = changedKeys(a.parserOptions, b.parserOptions);
  if (po.length) items.push({ kind: "parserOptions", impact: "low", text: `parserOptions changed: ${po.join(", ")}` });
  const st = changedKeys(a.settings, b.settings);
  if (st.length) items.push({ kind: "settings", impact: "low", text: `settings changed: ${st.join(", ")}` });
  if (a.reportUnusedDisableDirectives !== b.reportUnusedDisableDirectives) {
    items.push({
      kind: "unused-directives",
      impact: "low",
      text: `unused disable directives reported as ${SEVERITY_NAME[a.reportUnusedDisableDirectives]} -> ${SEVERITY_NAME[b.reportUnusedDisableDirectives]}`,
    });
  }
  return items;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * True when options x (before) and y (after) differ only where x holds the
 * before-default and y the after-default, key by key inside object options.
 */
export function defaultDriven(x: unknown[], y: unknown[], dBefore: unknown[] | undefined, dAfter: unknown[] | undefined): boolean {
  if (!dBefore || !dAfter) return false;
  const same = (p: unknown, q: unknown) => stableStringify(p) === stableStringify(q);
  let differs = false;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const xv = x[i];
    const yv = y[i];
    if (same(xv, yv)) continue;
    differs = true;
    if (isObject(xv) && isObject(yv)) {
      const db = isObject(dBefore[i]) ? (dBefore[i] as Record<string, unknown>) : {};
      const da = isObject(dAfter[i]) ? (dAfter[i] as Record<string, unknown>) : {};
      for (const k of new Set([...Object.keys(xv), ...Object.keys(yv)])) {
        if (!same(xv[k], yv[k]) && !(same(xv[k], db[k]) && same(yv[k], da[k]))) return false;
      }
    } else if (!(same(xv, dBefore[i]) && same(yv, dAfter[i]))) return false;
  }
  return differs;
}

const keyOf = (m: LintMessage) => `${m.ruleId ?? "(core)"}|${m.line}|${m.column}`;

interface FindingEvent {
  direction: FindingGroup["direction"];
  ruleId: string;
  cause: string;
  expected: boolean;
  impact: Impact;
  sample: FindingSample;
}

function explain(
  direction: "vanished" | "appeared",
  m: LintMessage,
  file: string,
  a: NormalConfig | undefined,
  b: NormalConfig | undefined,
  afterMajor: number,
): Pick<FindingEvent, "cause" | "expected" | "impact"> {
  const rule = m.ruleId;
  if (rule === null) {
    if (/eslint-env/.test(m.message)) return { cause: "/* eslint-env */ comments are reported as errors in ESLint 10", expected: true, impact: "medium" };
    if (/Unused eslint-disable|unused eslint-disable/i.test(m.message)) {
      return { cause: "reporting of unused eslint-disable directives changed", expected: false, impact: "low" };
    }
    if (m.fatal) return { cause: direction === "appeared" ? "file no longer parses" : "parse error went away", expected: false, impact: "high" };
    return { cause: "core message changed", expected: false, impact: "medium" };
  }
  const was = a?.rules[rule]?.severity ?? 0;
  const now = b?.rules[rule]?.severity ?? 0;
  if (direction === "vanished" && was > 0 && now === 0) return { cause: "rule no longer enabled for this file", expected: false, impact: "high" };
  if (direction === "appeared" && was === 0 && now > 0) {
    if (V10_NEW_RECOMMENDED.has(rule)) return { cause: "rule added to eslint:recommended in ESLint 10", expected: true, impact: "medium" };
    return { cause: "rule newly enabled for this file", expected: false, impact: "medium" };
  }
  if (afterMajor >= 10 && (JSX_FILE.test(file) || jsxEnabled(b)) && ((direction === "vanished" && rule === "no-unused-vars") || (direction === "appeared" && rule === "no-undef"))) {
    return { cause: "ESLint 10 tracks JSX references (scope analysis fix)", expected: true, impact: "low" };
  }
  if (afterMajor >= 10 && rule === "no-shadow-restricted-names" && /globalThis/.test(m.message)) {
    return { cause: "no-shadow-restricted-names reports globalThis by default in ESLint 10", expected: true, impact: "medium" };
  }
  return {
    cause: direction === "vanished" ? "same rule, finding no longer reported" : "same rule, new finding",
    expected: false,
    impact: direction === "vanished" ? "high" : "medium",
  };
}

function diffMessages(
  file: string,
  before: LintMessage[],
  after: LintMessage[],
  a: NormalConfig | undefined,
  b: NormalConfig | undefined,
  afterMajor: number,
): FindingEvent[] {
  const pool = new Map<string, LintMessage[]>();
  for (const m of after) {
    const k = keyOf(m);
    pool.set(k, [...(pool.get(k) ?? []), m]);
  }
  const events: FindingEvent[] = [];
  const sample = (m: LintMessage): FindingSample => ({ file, line: m.line, column: m.column, message: m.message });
  const severityChange = (was: LintMessage, now: LintMessage) => {
    if (now.severity === was.severity) return;
    events.push({
      direction: "severity",
      ruleId: was.ruleId ?? "(core)",
      cause: `reported as ${SEVERITY_NAME[was.severity]} -> ${SEVERITY_NAME[now.severity]}`,
      expected: false,
      impact: now.severity < was.severity ? "high" : "medium",
      sample: sample(now),
    });
  };
  // Pass 1: same rule, line and column.
  const unmatched: LintMessage[] = [];
  for (const m of before) {
    const match = pool.get(keyOf(m))?.shift();
    if (match) severityChange(m, match);
    else unmatched.push(m);
  }
  // Pass 2: a finding that only moved (same rule and line, or same rule and message within a few lines) is not a change.
  const rest = [...pool.values()].flat();
  const take = (pred: (n: LintMessage) => boolean) => {
    const i = rest.findIndex(pred);
    return i === -1 ? undefined : rest.splice(i, 1)[0];
  };
  for (const m of unmatched) {
    const match = take((n) => n.ruleId === m.ruleId && n.line === m.line) ?? take((n) => n.ruleId === m.ruleId && n.message === m.message && Math.abs(n.line - m.line) <= MOVED_LINES);
    if (match) severityChange(m, match);
    else events.push({ direction: "vanished", ruleId: m.ruleId ?? "(core)", sample: sample(m), ...explain("vanished", m, file, a, b, afterMajor) });
  }
  pool.clear();
  if (rest.length) pool.set("rest", rest);
  for (const rest of pool.values()) {
    for (const m of rest) {
      events.push({ direction: "appeared", ruleId: m.ruleId ?? "(core)", sample: sample(m), ...explain("appeared", m, file, a, b, afterMajor) });
    }
  }
  return events;
}

/** How far a finding with the same rule and message may move and still count as the same finding. */
const MOVED_LINES = 5;

const isFlatFile = (f: string) => /(^|\/)eslint\.config\.[cm]?[jt]s$/.test(f);

const IMPACT_ORDER: Record<Impact, number> = { high: 0, medium: 1, low: 2 };
const LINTED_ELSEWHERE: FileStatus[] = ["ignored", "unmatched", "outside", "fatal"];

function coverageReason(r: FileRecord): string {
  if (r.status === "fatal") return "lint run crashed";
  return r.reason ?? r.status;
}

export function diffSnapshots(before: Snapshot, after: Snapshot): ParityDiff {
  const afterMajor = Number(after.eslint.version.split(".")[0]) || 0;
  const stoppedLinting: CoverageChange[] = [];
  const startedLinting: CoverageChange[] = [];
  const groups = new Map<string, ConfigGroup>();
  const events: FindingEvent[] = [];
  const ruleSame = (rule: string, x: NormalRule, y: NormalRule) => sameOptions(rule, x, y, before, after);
  // Every differing option value is just that side's own default: the rule's defaults changed, not the config.
  const defaultsOnly = (rule: string, x: NormalRule, y: NormalRule) =>
    defaultDriven(x.options, y.options, before.ruleDefaults[rule], after.ruleDefaults[rule]);

  const files = [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].sort();
  const onlyBefore = files.filter((f) => !after.files[f]);
  const onlyAfter = files.filter((f) => !before.files[f]);

  for (const file of files) {
    const x = before.files[file];
    const y = after.files[file];
    if (!x || !y) continue;
    /** `linted` is the side that linted the file, `other` explains why the other side did not. */
    const change = (linted: FileRecord, other: FileRecord): CoverageChange => ({
      file,
      before: x.status,
      after: y.status,
      reason: coverageReason(other),
      findings: linted.messages?.length ?? 0,
      configBefore: x.configFile ?? null,
      configAfter: y.configFile ?? null,
    });
    if (x.status === "linted" && LINTED_ELSEWHERE.includes(y.status)) {
      stoppedLinting.push(change(x, y));
      continue;
    }
    if (y.status === "linted" && LINTED_ELSEWHERE.includes(x.status)) {
      startedLinting.push(change(y, x));
      continue;
    }
    if (x.status !== "linted" || y.status !== "linted") continue;

    const ca = x.config ? before.configs[x.config] : undefined;
    const cb = y.config ? after.configs[y.config] : undefined;
    const items: ConfigItem[] = [];
    if (x.configFile && y.configFile && x.configFile !== y.configFile && isFlatFile(x.configFile) && isFlatFile(y.configFile)) {
      // eslintrc -> flat is the migration itself; flat -> another flat file is the v10 per-file lookup.
      items.push({ kind: "config-file", impact: "high", text: `config file ${x.configFile} -> ${y.configFile}` });
    }
    if (ca && cb) items.push(...compareConfigs(ca, cb, ruleSame, afterMajor, defaultsOnly));
    if (items.length) {
      const signature = items.map((i) => i.text).join("\n");
      const group = groups.get(signature) ?? {
        impact: items.reduce<Impact>((best, i) => (IMPACT_ORDER[i.impact] < IMPACT_ORDER[best] ? i.impact : best), "low"),
        items,
        files: [],
      };
      group.files.push(file);
      groups.set(signature, group);
    }
    events.push(...diffMessages(file, x.messages ?? [], y.messages ?? [], ca, cb, afterMajor));
  }

  const findingGroups = new Map<string, FindingGroup & { fileSet: Set<string> }>();
  for (const e of events) {
    const key = `${e.direction}|${e.ruleId}|${e.cause}`;
    const g = findingGroups.get(key) ?? {
      ruleId: e.ruleId,
      direction: e.direction,
      cause: e.cause,
      expected: e.expected,
      impact: e.impact,
      count: 0,
      files: 0,
      samples: [],
      fileSet: new Set<string>(),
    };
    g.count++;
    g.fileSet.add(e.sample.file);
    if (g.samples.length < 5) g.samples.push(e.sample);
    findingGroups.set(key, g);
  }
  const findings: FindingGroup[] = [...findingGroups.values()]
    .map(({ fileSet, ...g }) => ({ ...g, files: fileSet.size }))
    .sort((p, q) => IMPACT_ORDER[p.impact] - IMPACT_ORDER[q.impact] || q.count - p.count || p.ruleId.localeCompare(q.ruleId));
  const configGroups = [...groups.values()].sort(
    (p, q) => IMPACT_ORDER[p.impact] - IMPACT_ORDER[q.impact] || q.files.length - p.files.length,
  );

  const b = summarise(before);
  const a = summarise(after);
  const verdict = judge(b, a, stoppedLinting, startedLinting, configGroups, findings);
  return { before: b, after: a, stoppedLinting, startedLinting, onlyBefore, onlyAfter, configGroups, findings, verdict };
}

function judge(
  b: SideSummary,
  a: SideSummary,
  stopped: CoverageChange[],
  started: CoverageChange[],
  configGroups: ConfigGroup[],
  findings: FindingGroup[],
): Verdict {
  let high = stopped.length > 0 ? 1 : 0;
  let medium = started.length > 0 ? 1 : 0;
  let low = 0;
  for (const g of configGroups) for (const i of g.items) (i.impact === "high" ? high++ : i.impact === "medium" ? medium++ : low++);
  for (const f of findings) {
    if (f.expected) low++;
    else if (f.impact === "high") high++;
    else if (f.impact === "medium") medium++;
    else low++;
  }
  const beforeCrashed = b.units.some((u) => u.fatal);
  const crashed = a.units.some((u) => u.fatal) && !beforeCrashed;
  const noBaseline = beforeCrashed || (b.counts.linted === 0 && a.counts.linted === 0);
  const status: Verdict["status"] = noBaseline
    ? "inconclusive"
    : crashed
      ? "broken"
      : high + medium + low === 0
        ? "ok"
        : "changed";
  const silent = status === "changed" && high > 0 && a.exitCode <= b.exitCode;
  const parts: string[] = [];
  if (crashed) {
    const fatal = a.units.find((u) => u.fatal);
    parts.push(
      fatal?.hint?.notEslint
        ? `lint crashes after the bump (exit 2), caused by ${fatal.hint.cause.split(";")[0]}`
        : a.eslintVersion
          ? `ESLint ${a.eslintVersion} crashes on this repo (exit 2)`
          : "the after side has no ESLint installed, so nothing is linted (exit 2)",
    );
  }
  const turnedRed = !crashed && b.exitCode === 0 && a.exitCode === 1;
  if (turnedRed) {
    const added = Math.max(0, a.errors - b.errors);
    const newFindings = findings.filter((f) => f.direction !== "vanished");
    const allExpected = newFindings.length > 0 && newFindings.every((f) => f.expected) && started.every((c) => c.findings === 0);
    parts.push(
      `lint now fails (exit 0 -> 1)${added ? ` with ${added} new error${added === 1 ? "" : "s"}` : ""}${allExpected ? ", all from documented ESLint 10 changes" : ""}`,
    );
  }
  if (stopped.length) parts.push(`${stopped.length} file${stopped.length === 1 ? "" : "s"} stopped being linted`);
  const dropped = configGroups.reduce((n, g) => n + (g.items.some((i) => i.impact === "high") ? g.files.length : 0), 0);
  if (dropped) parts.push(`${dropped} file${dropped === 1 ? "" : "s"} now lint more weakly (rules dropped or downgraded, or plugin, parser or config file changed)`);
  const vanished = findings.filter((f) => f.direction === "vanished" && !f.expected && f.impact === "high").reduce((n, f) => n + f.count, 0);
  if (vanished) parts.push(`${vanished} finding${vanished === 1 ? "" : "s"} disappeared`);
  const downgraded = findings.filter((f) => f.direction === "severity" && f.impact === "high").reduce((n, f) => n + f.count, 0);
  if (downgraded) parts.push(`${downgraded} finding${downgraded === 1 ? "" : "s"} downgraded from error to warning`);
  if (started.length) parts.push(`${started.length} file${started.length === 1 ? "" : "s"} newly linted`);
  if (noBaseline) {
    const why = beforeCrashed
      ? `the before run crashed (${(b.units.find((u) => u.fatal)?.fatal ?? "").split("\n")[0]?.slice(0, 160)})`
      : "neither side linted any file";
    return { status, silent: false, high, medium, low, headline: `No baseline: ${why}. Fix the before side first; nothing can be compared.` };
  }
  const headline =
    status === "ok"
      ? `Parity: ESLint ${b.eslintVersion} and ${a.eslintVersion} lint the same files with the same config and findings.`
      : `${capitalise(parts.join("; ")) || (medium ? `${medium} medium-impact change${medium === 1 ? "" : "s"} (rules added or options changed, see below)` : "Only low-impact or expected ESLint 10 changes")}${silent ? `, and the lint exit code did not get worse (${b.exitCode} -> ${a.exitCode}), so CI would not notice.` : "."}`;
  return { status, silent, high, medium, low, headline };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const FAIL_LEVELS = ["high", "medium", "low", "never"];

/** Exit status for CI: 1 when the after run crashes or a change reaches the --fail-on level, 2 without a baseline. */
export function exitFor(diff: ParityDiff, failOn: string): 0 | 1 | 2 {
  if (diff.verdict.status === "inconclusive") return 2;
  if (failOn === "never") return 0;
  if (diff.verdict.status === "broken") return 1;
  const threshold = IMPACT_ORDER[failOn as Impact] ?? 0;
  const counts: Array<[Impact, number]> = [["high", diff.verdict.high], ["medium", diff.verdict.medium], ["low", diff.verdict.low]];
  return counts.some(([impact, n]) => IMPACT_ORDER[impact] <= threshold && n > 0) ? 1 : 0;
}
