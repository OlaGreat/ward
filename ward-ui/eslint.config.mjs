import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";

export default tseslint.config(
  { ignores: ["eslint.config.mjs", "dist/", "public/"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  reactPlugin.configs.flat.recommended,
  reactPlugin.configs.flat["jsx-runtime"],
  eslintPluginPrettierRecommended,
  {
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-floating-promises": "warn",
      "react/prop-types": "off",
      // Apostrophes in prose are fine; only flag characters that break JSX.
      "react/no-unescaped-entities": ["error", { forbid: [">", "}"] }],
    },
    settings: { react: { version: "detect" } },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
);
