import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    "playwright-report/**",
    "test-results/**",
    "coverage/**",
  ]),
  {
    rules: {
      // Money must never be handled as floating point numbers; see src/lib/money.
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='Number'][property.name='parseFloat']",
          message: "Do not parse money as floats. Use src/lib/money.",
        },
      ],
      // Only repositories and the db module may import the generated Prisma client.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/generated/*", "**/generated/prisma/*"],
              message: "Import the database client only from src/lib/db or a module's repo/ layer.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/db/**", "src/modules/*/repo/**"],
    rules: { "no-restricted-imports": "off" },
  },
]);
