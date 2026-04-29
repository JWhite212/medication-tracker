import js from "@eslint/js";
import ts from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";

export default [
  {
    ignores: [
      "build/**",
      ".svelte-kit/**",
      ".vercel/**",
      "node_modules/**",
      "drizzle/**",
      "static/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "src/service-worker.ts",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs["flat/recommended"],
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "off",
      "svelte/no-navigation-without-resolve": "warn",
      "svelte/require-each-key": "warn",
      "svelte/prefer-svelte-reactivity": "warn",
      "svelte/no-at-html-tags": "warn",
    },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tsParser,
        extraFileExtensions: [".svelte"],
      },
    },
    rules: {
      // Template expressions like `{value ?? fallback}` look like
      // unused expressions to this rule. Disable for .svelte files.
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
];
