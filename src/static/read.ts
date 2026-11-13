/** Node-only adapter: reads the files the static checks need from a checkout. */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { wantsFile, type RepoFiles } from "./index.js";

const SKIP = new Set(["node_modules", ".git", ".hg", ".svn"]);
const MAX_BYTES = 512 * 1024;

function listFiles(root: string): string[] {
  if (existsSync(path.join(root, ".git"))) {
    const out = execFileSync("git", ["ls-files", "-z", "-c", "-o", "--exclude-standard"], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
    return out.toString("utf8").split("\0").filter(Boolean);
  }
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(path.join(dir, e.name));
      } else if (e.isFile()) files.push(path.relative(root, path.join(dir, e.name)).split(path.sep).join("/"));
    }
  };
  walk(root);
  return files;
}

export function readRepoFiles(root: string): RepoFiles {
  const files: RepoFiles = {};
  for (const rel of listFiles(root)) {
    if (rel.split("/").some((p) => SKIP.has(p)) || !wantsFile(rel)) continue;
    const abs = path.join(root, rel);
    try {
      if (statSync(abs).size > MAX_BYTES) continue;
      files[rel] = readFileSync(abs, "utf8");
    } catch {
      // Deleted between listing and reading, or a broken symlink.
    }
  }
  return files;
}
