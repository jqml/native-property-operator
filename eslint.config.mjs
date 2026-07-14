import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

const noisyTypeScriptRules = {
  "@typescript-eslint/await-thenable": "warn",
  "@typescript-eslint/no-base-to-string": "warn",
  "@typescript-eslint/no-confusing-void-expression": "warn",
  "@typescript-eslint/no-deprecated": "warn",
  "@typescript-eslint/no-explicit-any": "warn",
  "@typescript-eslint/no-floating-promises": "warn",
  "@typescript-eslint/no-implied-eval": "warn",
  "@typescript-eslint/no-misused-promises": "warn",
  "@typescript-eslint/no-redundant-type-constituents": "warn",
  "@typescript-eslint/no-unsafe-argument": "warn",
  "@typescript-eslint/no-unsafe-assignment": "warn",
  "@typescript-eslint/no-unsafe-call": "warn",
  "@typescript-eslint/no-unsafe-enum-comparison": "warn",
  "@typescript-eslint/no-unsafe-function-type": "warn",
  "@typescript-eslint/no-unsafe-member-access": "warn",
  "@typescript-eslint/no-unsafe-return": "warn",
  "@typescript-eslint/no-unsafe-type-assertion": "warn",
  "@typescript-eslint/only-throw-error": "warn",
  "@typescript-eslint/restrict-template-expressions": "warn",
  "@typescript-eslint/require-await": "warn",
  "@typescript-eslint/use-unknown-in-catch-callback-variable": "warn"
};

export default defineConfig([
  {
    ignores: [
      "main.js",
      "node_modules/**",
      "dist/**",
      "coverage/**"
    ]
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.mjs"]
        },
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: noisyTypeScriptRules
  },
  {
    files: ["*.mjs", "*.js"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.mjs", "*.js"]
        },
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      ...noisyTypeScriptRules,
      "@typescript-eslint/no-require-imports": "warn"
    }
  }
]);
