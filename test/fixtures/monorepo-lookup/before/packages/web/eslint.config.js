// Left over from an editor experiment: only the browser globals.
import globals from "globals";

export default [{ languageOptions: { globals: { ...globals.browser } } }];
