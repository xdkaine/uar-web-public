declare const process: { env?: Record<string, string | undefined> };

type PrismaConfig = {
  schema: string;
  migrations: {
    path: string;
  };
  datasource: {
    url: string;
  };
};

// The auth service NEVER runs migrations from application code - its tables
// are applied by operators via the checked-in migrations in prisma/migrations
// (ADR-0012, refined by the portal de-merge: OidcClient is now service-owned).
// This config exists so the Prisma CLI can generate the client and so
// operators can run `prisma migrate deploy` with the checked-in migrations.
const databaseUrl =
  process.env?.DATABASE_URL ??
  "postgresql://placeholder:placeholder@placeholder:5432/placeholder";

const config: PrismaConfig = {
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
};

export default config;
