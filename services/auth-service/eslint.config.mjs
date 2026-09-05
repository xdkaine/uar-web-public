import tseslint from "typescript-eslint";

// Mirrors the portal's strict TypeScript posture (my-app/eslint.config.mjs)
// for a non-Next.js Node service: typescript-eslint recommended with
// no-explicit-any enforced as an error.
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "prisma/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
