import tsParser from "@typescript-eslint/parser";
import globals from "globals";

export default [
  {
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.browser } },
    rules: { "no-console": "warn", "no-unused-vars": "error", eqeqeq: "error" },
  },
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tsParser },
  },
];
