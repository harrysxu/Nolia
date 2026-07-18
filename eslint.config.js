const js = require("@eslint/js");
const globals = require("globals");
const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const reactHooks = require("eslint-plugin-react-hooks");

module.exports = [
  {
    ignores: ["dist/**", "release/**", "node_modules/**"]
  },
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true }
      },
      globals: {
        ...globals.node
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooks
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "no-undef": "off",
      "react-hooks/set-state-in-effect": "off"
    }
  },
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    }
  },
  {
    files: ["src/renderer/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "../../App",
              message: "Feature modules must not depend on the renderer shell. Pass shell capabilities through typed props or feature services."
            },
            {
              name: "../../App.tsx",
              message: "Feature modules must not depend on the renderer shell. Pass shell capabilities through typed props or feature services."
            }
          ],
          patterns: [
            {
              group: ["**/AppShell", "**/AppShell.*"],
              message: "Feature modules must not depend on the renderer shell. Pass shell capabilities through typed props or feature services."
            }
          ]
        }
      ]
    }
  }
];
