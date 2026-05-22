---
description: Build the Next.js application and fix common issues
---

# Build Workflow

Run this workflow to build the production bundle and address common errors.

## Steps

// turbo-all

1. Navigate to the my-app directory and run the build:
   ```bash
   cd my-app && npm run build
   ```

2. If you see **Prisma errors** (e.g., `@prisma/client not found`):
   ```bash
   npx prisma generate
   ```
   Then re-run `npm run build`.

3. If you see **TypeScript import errors** for types:
   - Check that imports use `@/types` for shared types
   - Ensure `tsconfig.json` has `"@/*": ["./*"]` path mapping

4. If you see **ESLint errors**:
   ```bash
   npm run lint
   ```
   Fix the reported issues, then re-run build.

5. For **"Module not found"** errors:
   ```bash
   npm install
   ```
   Then re-run `npm run build`.

## Common Build Error Fixes

| Error | Fix |
|-------|-----|
| `Cannot find module '@prisma/client'` | Run `npx prisma generate` |
| Duplicate identifier | Check for duplicate imports or redeclared variables |
| Type 'X' is not assignable | Update type imports to use `@/types` |
| ESLint warnings as errors | Fix lint issues or use `// eslint-disable-next-line` |
