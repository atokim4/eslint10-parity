import js from "@eslint/js";
import globals from "globals";

export default [
  { files: ["**/*.{js,jsx}"], ...js.configs.recommended },
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
];
