import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** The collector spawns dist/worker.mjs, so tests always run against a fresh build. */
export default function setup(): void {
  const root = path.resolve(import.meta.dirname, "..");
  for (const engine of ["v9", "v10"]) {
    if (!existsSync(path.join(root, "engines", engine, "node_modules", "eslint"))) {
      throw new Error(`engines/${engine} is not installed: run \`npm run engines\` first`);
    }
  }
  execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: root, stdio: "inherit" });
}
