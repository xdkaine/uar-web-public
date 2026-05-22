---
description: Format and lint the codebase
---

# Format Workflow

Run this workflow to format code and fix linting issues.

## Steps

// turbo-all

1. Run ESLint with auto-fix:
   ```bash
   cd my-app && npm run lint -- --fix
   ```

2. If Prettier is configured, format all files:
   ```bash
   npx prettier --write "**/*.{ts,tsx,js,jsx,json,css,md}"
   ```

3. To check for remaining issues without fixing:
   ```bash
   npm run lint
   ```

## Common Lint Fixes

| Issue | Fix |
|-------|-----|
| Unused imports | Remove the import or add `// eslint-disable-next-line @typescript-eslint/no-unused-vars` |
| Missing dependencies in useEffect | Add dependencies or use `// eslint-disable-next-line react-hooks/exhaustive-deps` with justification |
| Any type | Replace with proper type from `@/types` |
| Unescaped entities | Use `&apos;` for `'`, `&quot;` for `"` in JSX text |

## Pre-commit Checklist

- [ ] Run `npm run lint` - all checks pass
- [ ] Run `npm run build` - no TypeScript errors
- [ ] Check for console.log statements to remove
