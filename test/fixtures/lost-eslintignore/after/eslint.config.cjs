const globals = require("globals");

module.exports = [
  {
    languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: { ...globals.node } },
    rules: { "no-var": "error", "no-unused-vars": "error" },
  },
];
