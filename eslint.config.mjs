import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // Allow `_unused` prefix for intentionally unused destructured vars.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // We lean on `unknown` + zod parsing at boundaries; allow ad-hoc cast in private code.
      "@typescript-eslint/no-explicit-any": "warn",
      // Empty `interface CliArgs extends ScrapeRunOptions {}` is a deliberate naming hook for the CLI.
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  {
    // JP regex literals legitimately contain ideographic whitespace (U+3000)
    // and other CJK whitespace that ESLint's "irregular" check flags.
    // Keep the check on globally; turn it off only where parsing JP card
    // text demands it.
    files: [
      "src/lib/mechanics.ts",
      "src/lib/normalize.ts",
      "src/scrapers/**/*.ts",
    ],
    rules: {
      "no-irregular-whitespace": "off",
      "no-useless-escape": "off",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "drizzle/**",
      "data/**",
      "**/*.d.ts",
    ],
  },
);
