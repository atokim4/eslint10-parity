import { describe, expect, it } from "vitest";
import { crashHint } from "../src/crash-hints.js";

// Messages as ESLint 10 printed them on census repos (paths shortened).
describe("crashHint", () => {
  it.each([
    ["Cannot find package '@eslint/js' imported from <root>/eslint.config.mjs", "undeclared-eslint-package"],
    ["Cannot find package '@eslint/eslintrc' imported from <root>/eslint-webpacked.config.mjs", "undeclared-eslint-package"],
    ["scopeManager.addGlobals is not a function", "parser-scope-manager"],
    ['sourceCode.isSpaceBetweenTokens is not a function Occurred while linting <root>/a.yml:5 Rule: "yml/flow-sequence-bracket-spacing"', "removed-rule-api"],
    ["Could not find config file.", "eslintrc-only"],
    ["Error while loading rule 'react/display-name': contextOrFilename.getFilename is not a function", "removed-rule-api"],
    ["Cannot find package 'globals' imported from <root>/eslint.config.mjs", "undeclared-eslint-package"],
    ["Error while loading rule 'import/no-default-export': Cannot use 'in' operator to search for 'sourceType' in undefined", "removed-rule-api"],
    ["Error while loading rule '@typescript-eslint/no-deprecated': Cannot destructure property 'jsDocParsingMode' of 'context.parserOptions' as it is undefined.", "removed-rule-api"],
    ["typescript-eslint does not support TS 7.0.", "typescript-eslint-ts-version"],
    ["Class extends value undefined is not a constructor or null", "typescript-eslint-legacy-eslint"],
  ])("%s", (message, id) => {
    expect(crashHint(message)?.id).toBe(id);
  });

  it("names the rule and the removed method", () => {
    const hint = crashHint('context.getScope is not a function Rule: "react/display-name"');
    expect(hint?.cause).toContain('(react/display-name) calls context.getScope()');
    expect(hint?.docs).toMatch(/#rule-context$/);
  });

  it("points eslint-plugin-import users at a replacement", () => {
    const hint = crashHint("Error while loading rule 'import/no-default-export': Cannot use 'in' operator to search for 'sourceType' in undefined");
    expect(hint?.cause).toContain("context.parserOptions");
    expect(hint?.fix).toContain("eslint-plugin-import-x");
  });

  it("leaves unknown crashes alone", () => {
    expect(crashHint("Unexpected token")).toBeUndefined();
  });
});
