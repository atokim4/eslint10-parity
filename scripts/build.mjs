import { chmodSync } from "node:fs";
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "warning",
};

await build({ ...common, entryPoints: ["src/cli.ts"], outfile: "dist/cli.mjs", banner: { js: "#!/usr/bin/env node" } });
await build({ ...common, entryPoints: ["src/collector/worker.ts"], outfile: "dist/worker.mjs" });
// No Node imports in the static engine, so this bundle also runs in a browser.
await build({ ...common, platform: "neutral", entryPoints: ["src/static/index.ts"], outfile: "dist/static.mjs" });

// The bin entry has to be executable for `npx github:` installs.
chmodSync("dist/cli.mjs", 0o755);
