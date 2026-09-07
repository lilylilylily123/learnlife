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
  // Overrides — does NOT extend — the default ignores of eslint-config-next,
  // so anything omitted here is linted even if Next would have skipped it.
  globalIgnores([
    // Default ignores of eslint-config-next, restated because of the above:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Cargo's output directory for the Tauri shell. Not source: it holds
    // generated JS assets emitted by tauri-codegen, some of them minified or
    // binary, which ESLint reports as "Invalid character" and "File appears
    // to be binary". It is gitignored, so CI lints a fresh checkout where the
    // directory does not exist and has always passed — but anyone who has run
    // a Tauri build locally got 90 errors from `pnpm lint`, which made the
    // repo's own quality command unusable on exactly the machines that build
    // the app.
    "src-tauri/**",
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
