/**
 * Known ESLint 10 crash messages mapped to their cause and fix. Each entry was
 * seen on a real repo during the census (see the README) and checked against
 * the ESLint 10 sources or migration guide.
 */
export interface CrashHint {
  id: string;
  cause: string;
  fix: string;
  docs?: string;
  /** true when the crash comes from another package the PR bumped, not from ESLint 10 itself. */
  notEslint?: boolean;
}

const MIGRATE = "https://eslint.org/docs/latest/use/migrate-to-10.0.0";

const UNDECLARED_RANGE: Record<string, string> = {
  "@eslint/js": '"@eslint/js": "^10.0.0"',
  "@eslint/eslintrc": '"@eslint/eslintrc": "^3.3.7"',
  globals: '"globals": "^14.0.0"',
};

const HINTS: Array<{ test: RegExp; hint: (m: RegExpMatchArray, message: string) => CrashHint }> = [
  {
    test: /Cannot find (?:package|module) '(@eslint\/(?:js|eslintrc)|globals)'/,
    hint: (m) => ({
      id: "undeclared-eslint-package",
      cause: `the config imports ${m[1]} without declaring it. ESLint 9 installed it ${m[1] === "globals" ? "through @eslint/eslintrc" : "as its own dependency"}; ESLint 10 does not, so it is gone after the bump (the migration guide does not mention this).`,
      fix: `add ${UNDECLARED_RANGE[m[1] as string]} to devDependencies.`,
    }),
  },
  {
    // eslint-plugin-import 2.32.0 lib/core/sourceType.js: `'sourceType' in context.parserOptions`;
    // older @typescript-eslint rules destructure context.parserOptions. ESLint 10 removed that property.
    test: /Error while loading rule '([^']+)': (?:Cannot use 'in' operator to search for '\w+' in undefined|Cannot (?:destructure|read) propert(?:y|ies) .*parserOptions)/,
    hint: (m) => ({
      id: "removed-rule-api",
      cause: `the rule ${m[1]} reads context.parserOptions, which ESLint 10 removed (use context.languageOptions.parserOptions).`,
      fix: `upgrade the plugin that provides "${m[1]}" to a release that supports ESLint 10${m[1]?.startsWith("import/") ? " (eslint-plugin-import 2.32.0 has none; eslint-plugin-import-x supports ESLint 10)" : ""}, or turn the rule off until it exists.`,
      docs: `${MIGRATE}#rule-context`,
    }),
  },
  {
    test: /scopeManager\.addGlobals is not a function/,
    hint: () => ({
      id: "parser-scope-manager",
      cause: "the parser returns a ScopeManager without addGlobals(), which ESLint 10 requires from custom parsers.",
      fix: "upgrade the custom parser (for example @babel/eslint-parser or ember-eslint-parser) to a release that supports ESLint 10, or keep ESLint 9 until it exists.",
      docs: `${MIGRATE}#scope-manager`,
    }),
  },
  {
    // eslint-plugin-react 7.37.5 lib/util/version.js: contextOrFilename.getFilename() (react version "detect").
    test: /Error while loading rule '([^']+)': \w*\.(getFilename|getPhysicalFilename|getCwd|getSourceCode|getScope|getAncestors|markVariableAsUsed|getDeclaredVariables) is not a function/,
    hint: (m) => ({
      id: "removed-rule-api",
      cause: `the rule ${m[1]} calls context.${m[2]}(), which ESLint 10 removed.`,
      fix: `upgrade the plugin that provides "${m[1]}" to a release that supports ESLint 10${m[1]?.startsWith("react/") ? " (eslint-plugin-react 7.37.5, the latest, has none yet)" : ""}, or keep ESLint 9 until it exists.`,
      docs: `${MIGRATE}#rule-context`,
    }),
  },
  {
    test: /\b(sourceCode|context)\.(\w+) is not a function/,
    hint: (m, message) => {
      const rule = message.match(/Rule: "([^"]+)"/)?.[1];
      return {
        id: "removed-rule-api",
        cause: `a rule${rule ? ` (${rule})` : ""} calls ${m[1]}.${m[2]}(), which ESLint 10 removed.`,
        fix: `upgrade the plugin that provides ${rule ? `"${rule}"` : "the rule"} to a version that supports ESLint 10.`,
        docs: `${MIGRATE}#${m[1] === "context" ? "rule-context" : "sourcecode-methods-removed"}`,
      };
    },
  },
  {
    test: /typescript-eslint does not support TS ([\d.]+)/,
    hint: (m) => ({
      id: "typescript-eslint-ts-version",
      cause: `typescript-eslint refusing TypeScript ${m[1]}; the crash comes from the typescript-eslint version in this install, not from ESLint 10.`,
      fix: `keep TypeScript on a version typescript-eslint supports (see its peerDependencies) until it supports ${m[1]}.`,
      docs: "https://typescript-eslint.io/users/dependency-versions",
      notEslint: true,
    }),
  },
  {
    test: /Class extends value undefined is not a constructor or null/,
    hint: () => ({
      id: "typescript-eslint-legacy-eslint",
      cause: "most likely typescript-eslint older than 8.54.0, whose utils subclass LegacyESLint, a class ESLint 10 removed.",
      fix: "upgrade typescript-eslint (and @typescript-eslint/*) to ^8.56.0, the first release that supports ESLint 10.",
      docs: "https://typescript-eslint.io/users/dependency-versions",
    }),
  },
  {
    test: /Could not find config file|couldn't find an eslint\.config/i,
    hint: () => ({
      id: "eslintrc-only",
      cause: "ESLint 10 only reads eslint.config.* files, and this checkout has none.",
      fix: "port the eslintrc config to eslint.config.js (npx @eslint/migrate-config, then review it).",
      docs: `${MIGRATE}#remove-eslintrc`,
    }),
  },
];

export function crashHint(message: string): CrashHint | undefined {
  for (const { test, hint } of HINTS) {
    const m = message.match(test);
    if (m) return hint(m, message);
  }
  return undefined;
}
