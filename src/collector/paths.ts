/** Path helpers shared by the worker and the main process. No ESLint imports here. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ESLINTRC_NAMES = [".eslintrc.js", ".eslintrc.cjs", ".eslintrc.yaml", ".eslintrc.yml", ".eslintrc.json", ".eslintrc"];

function hasEslintConfigKey(pkgFile: string): boolean {
  try {
    return Object.hasOwn(JSON.parse(readFileSync(pkgFile, "utf8")) as object, "eslintConfig");
  } catch {
    return false;
  }
}

/**
 * The eslintrc files that cascade into `file`, outermost first, as
 * repo-relative paths. Stops at the repo root (eslintrc itself would keep
 * going up until `root: true`, which needs the config evaluated).
 */
export function eslintrcChain(file: string, _cwd: string, root: string): string[] {
  const chain: string[] = [];
  let dir = path.dirname(file);
  for (;;) {
    const name = ESLINTRC_NAMES.find((n) => existsSync(path.join(dir, n)));
    if (name) chain.unshift(path.relative(root, path.join(dir, name)).split(path.sep).join("/"));
    else if (existsSync(path.join(dir, "package.json")) && hasEslintConfigKey(path.join(dir, "package.json"))) {
      chain.unshift(path.relative(root, path.join(dir, "package.json")).split(path.sep).join("/") + "#eslintConfig");
    }
    if (dir === root || !dir.startsWith(root)) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return chain;
}

const GLOB_CHARS = /[*?{}[\]!]/;

/** Is `file` covered by the CLI patterns (directories, files or globs relative to cwd)? */
export function inPatternScope(file: string, cwd: string, patterns: string[]): boolean {
  const relToCwd = path.relative(cwd, file).split(path.sep).join("/");
  if (relToCwd.startsWith("..")) return false;
  return patterns.some((pattern) => {
    if (GLOB_CHARS.test(pattern)) {
      const matchesGlob = (path as { matchesGlob?: (p: string, g: string) => boolean }).matchesGlob;
      if (!matchesGlob) return true;
      const glob = pattern.replace(/^\.\//, "");
      return matchesGlob(relToCwd, glob) || matchesGlob(relToCwd, `${glob}/**`);
    }
    const target = path.resolve(cwd, pattern);
    return file === target || file.startsWith(target + path.sep);
  });
}

/** eslintrc plugin name -> package name (same rules as @eslint/eslintrc's naming.normalizePackageName). */
export function legacyPluginPackage(name: string): string {
  if (name.startsWith("@")) {
    const [scope, rest] = name.split("/");
    if (!rest) return `${scope}/eslint-plugin`;
    return rest.startsWith("eslint-plugin") ? name : `${scope}/eslint-plugin-${rest}`;
  }
  return name.startsWith("eslint-plugin-") ? name : `eslint-plugin-${name}`;
}
