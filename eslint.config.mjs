import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "next-env.d.ts",
      "public/sw.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
      "no-empty-pattern": "off",
      "no-unassigned-vars": "off",
      "no-unused-vars": "off",
      "no-useless-escape": "off",
      "prefer-const": "warn",
      "preserve-caught-error": "off",
    },
  },
  {
    // Ratchet: these files are free of `any`; keep them that way and extend the list as
    // other files are cleaned up.
    files: ["lib/transactions.ts", "lib/db-api.ts", "lib/db-storage.ts", "shared/*.mjs"],
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
);