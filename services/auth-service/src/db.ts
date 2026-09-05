import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

// Shared database connection for the auth service. Only auth-owned tables
// are written (including AuthAdminLocalAccount) plus login audit rows in
// AuditLog (ADR-0012). The portal-owned LocalAccount table is never accessed.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// Advisory locks must never consume Prisma's query capacity. A separate,
// deliberately small pool bounds concurrent client mutations while leaving
// the main pool free for the Prisma work performed inside each lock.
const lockPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
  adapter,
  log: ['error', 'warn'],
});

/**
 * Non-expiring, cross-process operation lock held by one PostgreSQL session.
 * It spans Prisma transactions and Redis mirror work, which neither database
 * isolation nor a leased Redis mutex can safely serialize on its own.
 */
export async function withSessionAdvisoryLock<T>(
  key: string,
  work: () => Promise<T>
): Promise<T> {
  const client = await lockPool.connect();
  let locked = false;
  let releaseWithError = false;
  const deadline = Date.now() + 5_000;
  try {
    while (!locked) {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [key]
      );
      locked = result.rows[0]?.locked === true;
      if (!locked) {
        if (Date.now() >= deadline) throw new Error('Timed out waiting for client operation lock');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    return await work();
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]);
      } catch (error) {
        releaseWithError = true;
        console.error('[auth] failed to release database client operation lock', error);
      }
    }
    client.release(releaseWithError);
  }
}
