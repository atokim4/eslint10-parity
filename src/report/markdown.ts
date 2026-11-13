import type { ConfigGroup, CoverageChange, FindingGroup, ParityDiff, SideSummary } from "../diff.js";
import type { StaticFinding } from "../static/index.js";

const MAX_FILES = 15;

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const code = (s: string) => `\`${s.replace(/`/g, "'")}\``;

function fileList(files: string[], max = MAX_FILES): string {
  const shown = files.slice(0, max).map(code).join(", ");
  return files.length > max ? `${shown} and ${files.length - max} more` : shown;
}

function sideRow(name: string, s: SideSummary): string {
  const c = s.counts;
  return `| ${name} | ${s.eslintVersion || "?"} | ${s.modes.join(", ")} | ${c.linted} | ${c.ignored} | ${c.unmatched + c.outside} | ${c.fatal} | ${s.errors} | ${s.warnings} | ${s.exitCode} |`;
}

function coverageSection(title: string, changes: CoverageChange[]): string[] {
  if (!changes.length) return [];
  const byReason = new Map<string, CoverageChange[]>();
  for (const c of changes) {
    const key = `${c.after}|${c.reason}`;
    byReason.set(key, [...(byReason.get(key) ?? []), c]);
  }
  const lines = [`## ${title} (${changes.length})`, ""];
  for (const [key, group] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
    const [, reason] = key.split("|");
    const findings = group.reduce((n, c) => n + c.findings, 0);
    const first = group[0] as CoverageChange;
    lines.push(
      `- **${group.length} file${group.length === 1 ? "" : "s"}**: ${first.before} -> ${first.after}, ${esc(reason ?? "")}` +
        (findings ? ` (${findings} finding${findings === 1 ? "" : "s"} on the linted side)` : ""),
    );
    lines.push(`  ${fileList(group.map((c) => c.file))}`);
  }
  lines.push("");
  return lines;
}

function configSection(groups: ConfigGroup[]): string[] {
  if (!groups.length) return [];
  const lines = ["## Resolved config changes", "", "Files linted on both sides whose effective config differs, grouped by identical change set.", ""];
  for (const g of groups) {
    lines.push(`### ${g.impact.toUpperCase()}: ${g.files.length} file${g.files.length === 1 ? "" : "s"}`, "");
    lines.push(fileList(g.files), "");
    for (const item of g.items.slice(0, 40)) lines.push(`- [${item.impact}] ${esc(item.text)}`);
    if (g.items.length > 40) lines.push(`- ... ${g.items.length - 40} more changes`);
    lines.push("");
  }
  return lines;
}

function findingsSection(findings: FindingGroup[]): string[] {
  if (!findings.length) return [];
  const lines = [
    "## Findings that changed",
    "",
    "| Impact | Rule | Change | Count | Files | Cause | Example |",
    "| --- | --- | --- | ---: | ---: | --- | --- |",
  ];
  for (const f of findings) {
    const s = f.samples[0];
    const example = s ? `${code(`${s.file}:${s.line}:${s.column}`)} ${esc(s.message).slice(0, 90)}` : "";
    lines.push(
      `| ${f.expected ? "expected" : f.impact} | ${code(f.ruleId)} | ${f.direction} | ${f.count} | ${f.files} | ${esc(f.cause)} | ${example} |`,
    );
  }
  lines.push("");
  return lines;
}

function staticSection(findings: StaticFinding[]): string[] {
  if (!findings.length) return [];
  const lines = ["## Upgrade checks (static)", ""];
  for (const f of findings) {
    lines.push(`- **${f.severity}** ${code(f.id)} ${code(f.line ? `${f.file}:${f.line}` : f.file)}: ${f.message} ([docs](${f.docs}))`);
    if (f.fix) lines.push(`  Fix: ${f.fix}`);
  }
  lines.push("");
  return lines;
}

function unitsSection(d: ParityDiff): string[] {
  const lines = ["## How each side was linted", ""];
  for (const [name, side] of [["Before", d.before], ["After", d.after]] as const) {
    for (const u of side.units) {
      lines.push(`- ${name} ${code(u.cwd)}: ${esc(u.source)}, ${u.mode ?? "no"} config, exit ${u.exitCode}`);
      if (u.fatal) {
        lines.push(`  - crashed: ${esc(u.fatal).slice(0, 400)}`);
        const hint = u.hint;
        if (hint) lines.push(`  - likely cause: ${hint.cause} Fix: ${hint.fix}${hint.docs ? ` ([docs](${hint.docs}))` : ""}`);
      }
      for (const w of [...new Set(u.processWarnings)].slice(0, 5)) lines.push(`  - warning: ${esc(w).slice(0, 300)}`);
    }
  }
  const pkgNames = [...new Set([...Object.keys(d.before.packages), ...Object.keys(d.after.packages)])].sort();
  const changedPkgs = pkgNames.filter((n) => d.before.packages[n] !== d.after.packages[n]);
  if (changedPkgs.length) {
    lines.push("", "Package versions that changed:", "");
    for (const n of changedPkgs) lines.push(`- ${code(n)} ${d.before.packages[n] ?? "absent"} -> ${d.after.packages[n] ?? "absent"}`);
  }
  lines.push("");
  return lines;
}

export function renderMarkdown(d: ParityDiff, statics: StaticFinding[] = []): string {
  const v = d.verdict;
  const badges = { ok: "PARITY", broken: "BROKEN", inconclusive: "INCONCLUSIVE", changed: v.silent ? "SILENT CHANGE" : "CHANGED" };
  const badge = badges[v.status];
  const lines = [
    `# eslint10-parity: ${badge}`,
    "",
    v.headline,
    "",
    "| Side | ESLint | Config | Linted | Ignored | Not matched | Crashed | Errors | Warnings | Exit |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    sideRow("before", d.before),
    sideRow("after", d.after),
    "",
    `Changes: ${v.high} high, ${v.medium} medium, ${v.low} low or expected.`,
    "",
    ...coverageSection("Files that stopped being linted", d.stoppedLinting),
    ...coverageSection("Files that started being linted", d.startedLinting),
    ...configSection(d.configGroups),
    ...findingsSection(d.findings),
    ...staticSection(statics),
    ...unitsSection(d),
  ];
  if (d.onlyBefore.length || d.onlyAfter.length) {
    lines.push("## Files present on one side only", "");
    if (d.onlyBefore.length) lines.push(`- removed: ${fileList(d.onlyBefore)}`);
    if (d.onlyAfter.length) lines.push(`- added: ${fileList(d.onlyAfter)}`);
    lines.push("");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function renderStaticMarkdown(root: string, findings: StaticFinding[]): string {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return [
    `# eslint10-parity static checks: ${root}`,
    "",
    `${counts.error} errors, ${counts.warning} warnings, ${counts.info} notes.`,
    "",
    ...(findings.length ? staticSection(findings).slice(2) : ["Nothing found that ESLint 10 is known to change."]),
  ].join("\n").trimEnd() + "\n";
}
