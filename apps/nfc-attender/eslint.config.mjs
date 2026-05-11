import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // User-supplied content runs in a desktop WebView with PB auth in
      // window.__pb — never opt into raw HTML rendering.
      "react/no-danger": "error",
      "react/no-danger-with-children": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Dynamic records from PocketBase frequently surface as `any` at boundaries.
      // Surface these as warnings, not errors, so CI doesn't block on incremental typing.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
]);

export default eslintConfig;
