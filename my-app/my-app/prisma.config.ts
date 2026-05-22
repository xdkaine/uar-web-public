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

// Use placeholder URL during build if DATABASE_URL is not set
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
