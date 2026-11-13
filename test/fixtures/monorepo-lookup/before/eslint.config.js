import globals from "globals";

export default [
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { "no-console": "error", "no-debugger": "error", "prefer-const": "error" },
  },
];
