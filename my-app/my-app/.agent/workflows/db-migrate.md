---
description: Run Prisma database migrations
---

# Database Migration Workflow

Run this workflow when making database schema changes.

## Steps

// turbo-all

1. **Before making changes**, ensure the database is running:
   ```bash
   docker-compose up -d postgres
   ```

2. **Edit the schema** at `my-app/prisma/schema.prisma`

3. **Create a migration** (this generates SQL and applies it):
   ```bash
   cd my-app && npx prisma migrate dev --name your_migration_name
   ```
   Use descriptive names like `add_user_preferences` or `add_vpn_expiry_column`.

4. **Regenerate the Prisma client**:
   ```bash
   npx prisma generate
   ```

5. **Verify the changes** using Prisma Studio:
   ```bash
   npx prisma studio
   ```

## Common Commands

| Command | Purpose |
|---------|---------|
| `npx prisma migrate dev` | Create and apply migration in dev |
| `npx prisma migrate reset` | Reset database and apply all migrations |
| `npx prisma db push` | Push schema changes without creating migration (dev only) |
| `npx prisma generate` | Regenerate Prisma client after schema changes |
| `npx prisma studio` | Open visual database browser |

## Troubleshooting

### Migration conflicts
If you have migration conflicts:
```bash
npx prisma migrate reset
```
⚠️ This will **delete all data** in the database.

### Client not updated
If types don't match after schema change:
```bash
npx prisma generate
```

### Connection issues
Check `.env` has correct `DATABASE_URL`:
```
DATABASE_URL=postgresql://user:pass@localhost:5432/uar?sslmode=require
```
